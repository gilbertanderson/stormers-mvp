// src/sim.js
// Real-time rules engine for "The Two Ships" (Stormers: Hull Raiders prototype).
// No DOM, no canvas, no module state: everything lives on the Game object.
import {
  COLS, ROWS, TILE, CLASSES, TOOLS, VISION, CARRIER_SPEED_MUL, PERSONAL_SPACE, PICKUP_RANGE, SIDE_LABEL,
  centerOf, cellOf, dist, angleTo, angleDiff, turnToward, clamp, lerp, makeRng,
} from './contracts.js';
import {
  createWorld, tileAt, isWalkable, hatchAt, openHatch, losClear, findPath, cellsWithin, cellKey,
} from './world.js';
import { aiUpdate } from './ai.js';

const ENEMY = { vikings: 'pirates', pirates: 'vikings' };
const RAIDER_ID = { vikings: 'vX', pirates: 'pC' };
const SIDES = ['vikings', 'pirates'];
// Guards watch the inner door / the corner between hatch and door, never the planks.
const SPAWN_FACING = { p: [20, 6], k: [8, 6], c: [9, 4], q: [18, 4], R: [8, 11], Y: [20, 11], S: [9, 12], X: [18, 12] };
const BLOCK_HALF = (70 * Math.PI) / 180;
const DEG = Math.PI / 180;
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0);

// ---------------------------------------------------------------- game setup

/** ({side, aiEnabled, seed}) => Game */
export function createGame(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const side = o.side === 'pirates' ? 'pirates' : 'vikings';
  const seed = Number.isFinite(o.seed) ? o.seed >>> 0 : 1;
  const world = createWorld();
  const game = {
    side,
    phase: 'raid',
    paused: false,
    aiEnabled: o.aiEnabled !== false,
    time: 0,
    seed,
    rng: makeRng(seed || 1),
    world,
    units: [],
    chests: {
      pirates: { state: 'home', c: 0, r: 0, carrier: null },
      vikings: { state: 'home', c: 0, r: 0, carrier: null },
    },
    smokes: [],
    fx: [],
    log: [],
    selected: null,
    hoverId: null,
    aimMode: null,
    aimCell: null,
    pending: [],
  };
  const wc = (world && world.chests) || {};
  for (const s of SIDES) {
    const home = wc[s];
    if (home && Number.isFinite(home.c) && Number.isFinite(home.r)) {
      game.chests[s].c = home.c;
      game.chests[s].r = home.r;
    }
  }
  for (const sp of (world && world.spawns) || []) {
    const u = makeUnit(sp);
    if (u) game.units.push(u);
  }
  for (const u of game.units) u.role = RAIDER_ID[u.side] === u.id ? 'raider' : 'guard';
  const mine = game.units.filter((u) => u.side === side);
  game.selected = mine.length ? mine[0].id : null;
  return game;
}

function makeUnit(sp) {
  const cls = CLASSES[sp.cls];
  if (!cls) return null;
  const side = sp.side === 'pirates' ? 'pirates' : 'vikings';
  const ch = String(sp.ch || '?');
  const id = (side === 'vikings' ? 'v' : 'p') + ch.toUpperCase();
  const cen = centerOf(sp.c, sp.r);
  const f = SPAWN_FACING[ch];
  const facing = f
    ? angleTo(cen.x, cen.y, f[0] + 0.5, f[1] + 0.5)
    : side === 'vikings' ? -Math.PI / 2 : Math.PI / 2;
  return {
    id, side, cls: sp.cls, name: cls.name,
    x: cen.x, y: cen.y, facing,
    hp: cls.hp, maxHp: cls.hp, alive: true,
    path: [], target: null, order: null,
    cooldown: 0, stun: 0, alert: false, reactTimer: 0,
    breach: null, charging: null,
    role: 'guard',
    charges: Object.assign({}, cls.charges || {}),
    carrying: null, speedMul: 1,
    homeC: sp.c, homeR: sp.r, postFacing: facing,
    thinkT: 0, repathT: 0, repathTried: false,
  };
}

// ---------------------------------------------------------------- main step

/** (game, dt) => void */
export function step(game, dt) {
  if (!game || !Array.isArray(game.units)) return;
  const d = Number(dt);
  if (!Number.isFinite(d) || d <= 0) return;
  if (!Array.isArray(game.pending)) game.pending = [];
  if (!Array.isArray(game.smokes)) game.smokes = [];
  if (!Array.isArray(game.fx)) game.fx = [];
  if (!Array.isArray(game.log)) game.log = [];
  if (game.phase !== 'raid') { updateFx(game, Math.min(d, 0.1)); return; }
  if (game.paused) return;
  let left = Math.min(d, 0.25);
  let guard = 0;
  while (left > 1e-9 && guard++ < 40) {
    const h = Math.min(0.05, left);
    left -= h;
    substep(game, h);
    if (game.phase !== 'raid') break;
  }
  if (game.phase !== 'raid') updateFx(game, 0);
}

function substep(game, dt) {
  game.time += dt;
  if (game.aiEnabled && !game.paused) aiUpdate(game, dt);
  updatePending(game, dt);
  updateSmokes(game, dt);
  for (const u of game.units) {
    if (!u.alive) continue;
    updateUnit(game, u, dt);
    if (game.phase !== 'raid') break;
  }
  updateChests(game);
  updateFx(game, dt);
  checkEnd(game);
}

// ---------------------------------------------------------------- unit update

function updateUnit(game, u, dt) {
  if (u.dormant) return; // test hook: a dormant crew never reacts
  if (u.cooldown > 0) u.cooldown = Math.max(0, u.cooldown - dt);
  if (u.reactTimer > 0) {
    u.reactTimer -= dt;
    if (u.reactTimer <= 0) { u.reactTimer = 0; u.alert = true; }
  }
  u.speedMul = u.carrying ? CARRIER_SPEED_MUL : 1;
  if (u.stun > 0) { u.stun = Math.max(0, u.stun - dt); u.charging = null; return; }
  scanVision(game, u);
  if (u.breach) { tickBreach(game, u, dt); return; }
  if (u.charging) { tickCharge(game, u, dt); return; }
  // A unit with a move/carry order obeys it: it does not break off to chase a
  // sighting (that is what makes player orders reliable). Idle units fight.
  const ordered = !!(u.order && (u.order.type === 'move' || u.order.type === 'carry'));
  if (!ordered) {
    const tgt = resolveTarget(game, u);
    if (tgt) {
      if (inAttackReach(game, u, tgt)) {
        u.path.length = 0;
        attack(game, u, tgt);
        return;
      }
      if (wantsChase(game, u, tgt)) { chase(game, u, tgt, dt); return; }
    }
  }
  moveAlongPath(game, u, dt);
}

/** True when `u` can currently see `t` (range + cone + LOS + smoke). */
export function canSee(game, u, t) {
  if (!game || !u || !t || !u.alive || !t.alive) return false;
  if (u.side === t.side) return false;
  if (inSmoke(game, u) || inSmoke(game, t)) return false;
  const d = dist(u.x, u.y, t.x, t.y);
  if (d > VISION.range) return false;
  if (Math.abs(angleDiff(u.facing, angleTo(u.x, u.y, t.x, t.y))) > VISION.halfAngle) return false;
  return losClear(game.world, u.x, u.y, t.x, t.y);
}

/** True when the unit sits inside a live smoke cloud. */
export function inSmoke(game, u) {
  if (!game || !u || !Array.isArray(game.smokes)) return false;
  for (const s of game.smokes) {
    if (!s || s.life <= 0) continue;
    if (dist(u.x, u.y, s.x, s.y) <= s.radius) return true;
  }
  return false;
}

/** (game, id) => Unit|null */
export function unitById(game, id) {
  if (!game || !Array.isArray(game.units) || id == null) return null;
  for (const u of game.units) if (u.id === id) return u;
  return null;
}

function scanVision(game, u) {
  if (u.reactTimer > 0 || u.alert) return;
  for (const o of game.units) {
    if (!o.alive || o.side === u.side) continue;
    if (canSee(game, u, o)) { u.reactTimer = CLASSES[u.cls].reaction; return; }
  }
}

function resolveTarget(game, u) {
  let t = u.target ? unitById(game, u.target) : null;
  if (t && (!t.alive || t.side === u.side)) { t = null; u.target = null; }
  if (t) return t;
  if (!u.alert) return null;
  let best = null;
  let bd = Infinity;
  for (const o of game.units) {
    if (!o.alive || o.side === u.side) continue;
    if (!canSee(game, u, o)) continue;
    const d = dist(u.x, u.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) u.target = best.id;
  return best;
}

function inAttackReach(game, u, t) {
  const cls = CLASSES[u.cls];
  const d = dist(u.x, u.y, t.x, t.y);
  if (d > cls.attackRange) return false;
  if (cls.attack === 'ranged') return losClear(game.world, u.x, u.y, t.x, t.y) && !inSmoke(game, t);
  return true;
}

function wantsChase(game, u, t) {
  if (u.order && u.order.type === 'attack' && u.order.id === t.id) return true;
  if (u.carrying) return false;
  if (!u.alert) return false;
  if (CLASSES[u.cls].attack !== 'melee') return false;
  return canSee(game, u, t);
}

// ---------------------------------------------------------------- movement

function moveAlongPath(game, u, dt) {
  if (!Array.isArray(u.path) || !u.path.length) {
    if (u.order && (u.order.type === 'move' || u.order.type === 'carry')) u.order = null;
    return;
  }
  const cls = CLASSES[u.cls];
  const speed = Math.max(0.1, cls.moveSpeed * (u.speedMul || 1));
  let budget = speed * dt;
  const turnStep = cls.turnSpeed * DEG * dt;
  let guard = 0;
  while (budget > 1e-6 && u.path.length && guard++ < 12) {
    const wp = u.path[0];
    const wc = centerOf(wp.c, wp.r);
    const dx = wc.x - u.x;
    const dy = wc.y - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) { u.path.shift(); continue; }
    u.facing = turnToward(u.facing, Math.atan2(dy, dx), turnStep);
    if (!canEnter(game, u, wp.c, wp.r)) {
      const door = hatchAt(game.world, wp.c, wp.r);
      if (door && !door.open) {
        // A barred hatch in the way: hold here facing it. PRY / AXE / KEG opens
        // the route and the same path carries on.
        u.facing = turnToward(u.facing, Math.atan2(dy, dx), turnStep);
        return;
      }
      blockedRepath(game, u);
      return;
    }
    const travel = Math.min(budget, d);
    const nx = u.x + (dx / d) * travel;
    const ny = u.y + (dy / d) * travel;
    if (!freeSpot(game, u, nx, ny)) { blockedRepath(game, u); return; }
    u.x = nx; u.y = ny;
    budget -= travel;
    if (travel >= d - 1e-6) { u.path.shift(); u.repathTried = false; }
  }
  if (!u.path.length && u.order && (u.order.type === 'move' || u.order.type === 'carry')) u.order = null;
}

function canEnter(game, u, c, r) {
  if (!Number.isFinite(c) || !Number.isFinite(r)) return false;
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  if (!isWalkable(game.world, c, r)) return false;
  if (isChestHome(game, c, r)) return false;
  for (const o of game.units) {
    if (o === u || !o.alive) continue;
    const oc = cellOf(o.x, o.y);
    if (oc.c === c && oc.r === r) return false;
  }
  return true;
}

function freeSpot(game, u, nx, ny) {
  for (const o of game.units) {
    if (o === u || !o.alive) continue;
    const dNew = dist(nx, ny, o.x, o.y);
    if (dNew >= PERSONAL_SPACE) continue;
    if (dNew >= dist(u.x, u.y, o.x, o.y)) return false;
  }
  return true;
}

function blockedCells(game, u) {
  const out = [];
  for (const o of game.units) {
    if (o === u || !o.alive) continue;
    const c = cellOf(o.x, o.y);
    out.push(cellKey(c.c, c.r));
  }
  const wc = (game.world && game.world.chests) || {};
  for (const s of SIDES) {
    const h = wc[s];
    if (h && Number.isFinite(h.c)) out.push(cellKey(h.c, h.r));
  }
  return out;
}

function isChestHome(game, c, r) {
  const wc = (game.world && game.world.chests) || {};
  for (const s of SIDES) {
    const h = wc[s];
    if (h && h.c === c && h.r === r) return true;
  }
  return false;
}

function blockedRepath(game, u) {
  const goal = u.path && u.path.length ? u.path[u.path.length - 1] : null;
  if (!u.repathTried && goal) {
    u.repathTried = true;
    const cur = cellOf(u.x, u.y);
    const p = findPath(game.world, cur, goal, { allowClosedHatch: true, blocked: blockedCells(game, u) });
    u.path = Array.isArray(p) ? p.slice() : [];
    return;
  }
  u.path = [];
  if (u.order && (u.order.type === 'move' || u.order.type === 'carry')) u.order = null;
}

function chase(game, u, t, dt) {
  const reach = CLASSES[u.cls].attackRange;
  const d = dist(u.x, u.y, t.x, t.y);
  if (d <= reach * 1.15) {
    // close enough to strike: step straight in
    const ang = angleTo(u.x, u.y, t.x, t.y);
    u.facing = ang;
    const stepLen = Math.min(CLASSES[u.cls].moveSpeed * dt, Math.max(0, d - reach * 0.7));
    if (stepLen > 1e-4) {
      const nx = u.x + Math.cos(ang) * stepLen;
      const ny = u.y + Math.sin(ang) * stepLen;
      const cell = cellOf(nx, ny);
      if (isWalkable(game.world, cell.c, cell.r) && !isChestHome(game, cell.c, cell.r) && freeSpot(game, u, nx, ny)) {
        u.x = nx; u.y = ny;
      }
    }
    return;
  }
  u.repathT -= dt;
  const goal = cellOf(t.x, t.y);
  const last = u.path && u.path.length ? u.path[u.path.length - 1] : null;
  if (!last || last.c !== goal.c || last.r !== goal.r || !u.path.length) {
    if (u.repathT <= 0) {
      const p = findPath(game.world, cellOf(u.x, u.y), goal, { allowClosedHatch: true, blocked: blockedCells(game, u) });
      u.path = Array.isArray(p) ? p.slice() : [];
      u.repathT = 0.4;
    }
  }
  moveAlongPath(game, u, dt);
}

// ---------------------------------------------------------------- combat

function attack(game, u, t) {
  const cls = CLASSES[u.cls];
  if (!t || !t.alive || u.cooldown > 0) return false;
  u.cooldown = cls.attackInterval;
  const ang = angleTo(u.x, u.y, t.x, t.y);
  u.facing = ang;
  if (cls.attack === 'ranged') {
    const d = dist(u.x, u.y, t.x, t.y);
    const chance = lerp(cls.accuracy || 0, cls.accuracyAtMax || 0, clamp(d / cls.attackRange, 0, 1));
    const hit = game.rng() <= chance;
    pushFx(game, { kind: 'shot', x0: u.x, y0: u.y, x1: t.x, y1: t.y, life: 0.25, colour: cls.colour });
    if (cls.loud) emitNoise(game, u.x, u.y, cls.noiseRadius || 8, `${cls.name} shot`, { side: u.side });
    if (hit) {
      hitTarget(game, u, t, 1, true);
    } else {
      pushFx(game, { kind: 'text', x: t.x, y: t.y, text: 'miss', life: 0.8, colour: '#c9cfd4' });
    }
    return true;
  }
  pushFx(game, { kind: 'hit', x: t.x, y: t.y, life: 0.22, colour: cls.colour });
  hitTarget(game, u, t, 1, false);
  return true;
}

function hitTarget(game, src, t, amount, ranged) {
  let dmg = amount;
  if (ranged && t.cls === 'shield' && src) {
    const toSrc = angleTo(t.x, t.y, src.x, src.y);
    if (Math.abs(angleDiff(t.facing, toSrc)) <= BLOCK_HALF) {
      dmg *= 1 - (CLASSES.shield.block || 0);
      pushFx(game, { kind: 'text', x: t.x, y: t.y, text: 'block', life: 0.8, colour: '#9fb2bd' });
    }
  }
  t.hp -= dmg;
  if (t.hp <= 1e-6) {
    t.hp = 0;
    killUnit(game, t, src);
    return;
  }
  if (!t.alert && t.reactTimer <= 0) t.reactTimer = CLASSES[t.cls].reaction;
}

function killUnit(game, u, src) {
  if (!u || !u.alive) return;
  u.alive = false;
  u.hp = 0;
  u.path = [];
  u.target = null;
  u.order = null;
  u.breach = null;
  u.charging = null;
  if (u.carrying) {
    const ch = game.chests[u.carrying];
    if (ch) {
      const cell = cellOf(u.x, u.y);
      ch.state = 'dropped';
      ch.c = cell.c;
      ch.r = cell.r;
      ch.carrier = null;
      pushLog(game, 'chest', `${u.name} fell - ${SIDE_LABEL[u.carrying]} chest dropped`);
    }
    u.carrying = null;
  }
  pushFx(game, { kind: 'text', x: u.x, y: u.y, text: 'down', life: 1, colour: '#e0574a' });
  pushLog(game, 'kill', `${u.name} (${SIDE_LABEL[u.side]}) is down${src ? ` - ${src.name}` : ''}`);
  if (game.selected === u.id) game.selected = null;
}

function tickCharge(game, u, dt) {
  const c = u.charging;
  if (!c) return;
  const t = unitById(game, c.id);
  if (!t || !t.alive) { u.charging = null; u.order = null; return; }
  const cls = CLASSES[u.cls];
  const reach = cls.attackRange;
  c.t += dt;
  const ang = angleTo(u.x, u.y, t.x, t.y);
  u.facing = ang;
  const d = dist(u.x, u.y, t.x, t.y);
  const speed = Math.max(1.5, c.dist / Math.max(0.05, c.dur));
  const travel = Math.min(speed * dt, Math.max(0, d - reach * 0.7));
  if (travel > 1e-4) {
    const nx = u.x + Math.cos(ang) * travel;
    const ny = u.y + Math.sin(ang) * travel;
    const cell = cellOf(nx, ny);
    if (isWalkable(game.world, cell.c, cell.r) && !isChestHome(game, cell.c, cell.r)) { u.x = nx; u.y = ny; }
    else { u.charging = null; u.order = null; return; }
  }
  if (c.t >= c.dur || dist(u.x, u.y, t.x, t.y) <= reach) {
    u.charging = null;
    u.cooldown = 0;
    attack(game, u, t);
    if (u.order && u.order.type === 'attack') u.order = null;
  }
}

// ---------------------------------------------------------------- breaching

function tickBreach(game, u, dt) {
  const b = u.breach;
  if (!b) return;
  const h = hatchAt(game.world, b.c, b.r);
  if (!h || h.open) { u.breach = null; return; }
  const cx = b.c + 0.5;
  const cy = b.r + 0.5;
  if (dist(u.x, u.y, cx, cy) > 2.2) { u.breach = null; return; }
  const cls = CLASSES[u.cls];
  u.facing = turnToward(u.facing, angleTo(u.x, u.y, cx, cy), cls.turnSpeed * DEG * dt);
  b.progress += dt;
  if (b.progress >= b.duration) {
    openHatch(game.world, b.c, b.r);
    if (b.tool === 'axe') {
      pushLog(game, 'noise', 'AXE breach - noise 7');
      emitNoise(game, cx, cy, TOOLS.axe.noise || 7, 'AXE breach', { side: u.side, silent: true });
      pushFx(game, { kind: 'text', x: cx, y: cy, text: 'BREACH', life: 1, colour: '#e9b93c' });
    } else {
      pushLog(game, 'breach', 'PRY opened a hatch');
      pushFx(game, { kind: 'text', x: cx, y: cy, text: 'PRY', life: 1, colour: '#e9b93c' });
    }
    u.breach = null;
    if (u.order && u.order.type === 'breach') u.order = null;
  }
}

// ---------------------------------------------------------------- noise

/** emitNoise(game, x, y, radius, kind, opts) - alerts hostile units in radius. */
export function emitNoise(game, x, y, radius, kind = 'noise', opts = {}) {
  if (!game || !Array.isArray(game.units)) return;
  const r = Number.isFinite(radius) ? radius : 0;
  const label = typeof kind === 'string' && kind ? kind : 'noise';
  const o = opts && typeof opts === 'object' ? opts : {};
  if (!o.silent) pushLog(game, 'noise', `${label} - noise ${Math.round(r)}`);
  for (const u of game.units) {
    if (!u.alive) continue;
    if (o.side && u.side === o.side) continue;
    if (dist(x, y, u.x, u.y) > r) continue;
    if (!u.alert && u.reactTimer <= 0) u.reactTimer = CLASSES[u.cls].reaction;
  }
}

// ---------------------------------------------------------------- pending (keg / smoke)

function updatePending(game, dt) {
  const list = game.pending || (game.pending = []);
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.t += dt;
    if (p.kind === 'smoke') {
      if (p.t >= (TOOLS.smoke.delay || 1)) {
        game.smokes.push({
          x: p.x, y: p.y,
          radius: TOOLS.smoke.radius || 2.4,
          stun: TOOLS.smoke.stun || 4,
          life: TOOLS.smoke.life || 9,
          hit: {},
        });
        emitNoise(game, p.x, p.y, TOOLS.smoke.noise || 5, 'SMOKE pot', { side: p.side });
        pushLog(game, 'info', 'SMOKE cloud - blocks sight');
        list.splice(i, 1);
      }
    } else if (p.kind === 'keg') {
      if (p.t >= (TOOLS.keg.place || 1) + (TOOLS.keg.fuse || 2)) {
        explodeKeg(game, p);
        list.splice(i, 1);
      }
    } else {
      list.splice(i, 1);
    }
  }
}

function explodeKeg(game, p) {
  const cx = p.c + 0.5;
  const cy = p.r + 0.5;
  openHatch(game.world, p.c, p.r);
  pushFx(game, {
    kind: 'blast', x: cx, y: cy,
    radius: TOOLS.keg.blastRadius || 3.2,
    life: 0.7, colour: '#ffb066',
  });
  pushLog(game, 'breach', 'KEG blast opened a hatch');
  for (const u of game.units) {
    if (!u.alive) continue;
    const d = dist(cx, cy, u.x, u.y);
    if (d <= (TOOLS.keg.lethalRadius || 1.4)) killUnit(game, u, null);
    else if (d <= (TOOLS.keg.blastRadius || 3.2)) u.stun = Math.max(u.stun, TOOLS.keg.stun || 4);
  }
  emitNoise(game, cx, cy, TOOLS.keg.noise || 14, 'KEG blast', { side: p.side });
}

function updateSmokes(game, dt) {
  const list = game.smokes || (game.smokes = []);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (!s.hit) s.hit = {};
    s.life -= dt;
    for (const u of game.units) {
      if (!u.alive || u.stun > 0 || s.hit[u.id]) continue;
      if (dist(u.x, u.y, s.x, s.y) <= s.radius) {
        u.stun = Math.max(u.stun, s.stun || 4);
        s.hit[u.id] = 1;
      }
    }
    if (s.life <= 0) list.splice(i, 1);
  }
}

function updateFx(game, dt) {
  const list = game.fx || (game.fx = []);
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    f.life -= d;
    if (f.life <= 0) list.splice(i, 1);
  }
}

function pushFx(game, f) {
  const list = game.fx || (game.fx = []);
  list.push(f);
  if (list.length > 90) list.splice(0, list.length - 90);
}

// ---------------------------------------------------------------- chests

function updateChests(game) {
  for (const u of game.units) {
    if (!u.alive) continue;
    const own = game.chests[u.side];
    const foe = game.chests[ENEMY[u.side]];
    if (!own || !foe) continue;
    if (u.carrying) {
      const ch = game.chests[u.carrying];
      if (ch) {
        const cell = cellOf(u.x, u.y);
        ch.state = 'carried';
        ch.carrier = u.id;
        ch.c = cell.c;
        ch.r = cell.r;
      }
      continue;
    }
    if (own.state === 'dropped' && dist(u.x, u.y, own.c + 0.5, own.r + 0.5) <= PICKUP_RANGE) {
      const home = chestHome(game, u.side);
      own.state = 'home';
      own.c = home.c;
      own.r = home.r;
      own.carrier = null;
      pushLog(game, 'chest', `${u.name} hauled the ${SIDE_LABEL[u.side]} chest home`);
    }
    if (foe.state !== 'carried' && dist(u.x, u.y, foe.c + 0.5, foe.r + 0.5) <= PICKUP_RANGE) {
      foe.state = 'carried';
      foe.carrier = u.id;
      u.carrying = ENEMY[u.side];
      u.speedMul = CARRIER_SPEED_MUL;
      u.path = [];
      u.order = null;
      pushLog(game, 'chest', `${u.name} took the ${SIDE_LABEL[ENEMY[u.side]]} chest`);
    }
  }
}

function chestHome(game, side) {
  const wc = (game.world && game.world.chests) || {};
  const h = wc[side];
  if (h && Number.isFinite(h.c)) return { c: h.c, r: h.r };
  const ch = game.chests[side];
  return { c: ch ? ch.c : 0, r: ch ? ch.r : 0 };
}

// ---------------------------------------------------------------- end states

function checkEnd(game) {
  if (!game || game.phase !== 'raid') return;
  for (const u of game.units) {
    if (!u.alive || !u.carrying) continue;
    if (u.carrying !== ENEMY[u.side]) continue;
    const own = game.chests[u.side];
    if (!own || own.state !== 'home') continue;
    if (dist(u.x, u.y, own.c + 0.5, own.r + 0.5) <= PICKUP_RANGE) {
      endGame(game, u.side);
      return;
    }
  }
  let vAlive = 0;
  let pAlive = 0;
  for (const u of game.units) {
    if (!u.alive) continue;
    if (u.side === 'vikings') vAlive++;
    else pAlive++;
  }
  if (pAlive === 0 && vAlive === 0) return;
  if (pAlive === 0) endGame(game, 'vikings');
  else if (vAlive === 0) endGame(game, 'pirates');
}

function endGame(game, winner) {
  if (game.phase !== 'raid') return;
  game.phase = winner === game.side ? 'won' : 'lost';
  pushLog(game, 'end', winner === game.side ? 'SHIP TAKEN' : 'RAID FAILED');
}

/** Debug/test hook: kill every unit of `side` through the normal death path. */
export function eliminateSide(game, side) {
  if (!game || !Array.isArray(game.units)) return;
  for (const u of game.units) {
    if (u.side === side && u.alive) killUnit(game, u, null);
  }
  updateChests(game);
  checkEnd(game);
}

/**
 * Debug/test hook: a dormant crew stands still and never reacts, so a single
 * mechanic (crossing, pickup, carrying) can be played out in isolation.
 */
export function setDormant(game, side, on) {
  if (!game || !Array.isArray(game.units)) return 0;
  let n = 0;
  for (const u of game.units) {
    if (u.side !== side) continue;
    u.dormant = !!on;
    if (on) {
      u.path = [];
      if (u.order && u.order.type === 'move') u.order = null;
    }
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- logging

function pushLog(game, kind, text) {
  const list = game.log || (game.log = []);
  list.push({ t: Math.round(game.time * 100) / 100, kind, text: String(text) });
  if (list.length > 200) list.splice(0, list.length - 200);
}

// ---------------------------------------------------------------- orders

/** (game, unitId, c, r) => boolean */
export function orderMove(game, unitId, c, r) {
  const u = unitById(game, unitId);
  if (!u || !u.alive) return false;
  if (game.phase !== 'raid') return false;
  const cc = Math.trunc(Number(c));
  const rr = Math.trunc(Number(r));
  if (!Number.isFinite(cc) || !Number.isFinite(rr)) return false;
  if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS) return false;
  if (isChestHome(game, cc, rr)) return false;
  // Prefer a route that needs no breaching; only fall back to a barred hatch
  // (the unit then stops at it until a tool opens the way).
  const from = cellOf(u.x, u.y);
  const blocked = blockedCells(game, u);
  let p = findPath(game.world, from, { c: cc, r: rr }, { allowClosedHatch: false, blocked });
  if (!Array.isArray(p)) {
    p = findPath(game.world, from, { c: cc, r: rr }, { allowClosedHatch: true, blocked });
  }
  if (!Array.isArray(p)) return false;
  u.path = p.slice();
  u.order = { type: 'move', c: cc, r: rr };
  u.target = null;
  u.breach = null;
  u.repathTried = false;
  u.repathT = 0;
  if (!game.selected && u.side === game.side) game.selected = u.id;
  return true;
}

/** (game, unitId, targetId) => boolean */
export function orderAttack(game, unitId, targetId) {
  const u = unitById(game, unitId);
  const t = unitById(game, targetId);
  if (!u || !t || !u.alive || !t.alive) return false;
  if (u.side === t.side) return false;
  if (game.phase !== 'raid') return false;
  const cls = CLASSES[u.cls];
  const d = dist(u.x, u.y, t.x, t.y);
  u.order = { type: 'attack', id: t.id, c: cellOf(t.x, t.y).c, r: cellOf(t.x, t.y).r };
  u.target = t.id;
  u.breach = null;
  u.repathTried = false;
  u.repathT = 0;
  if (cls.attack === 'melee' && u.charges && u.charges.charge > 0 && d > cls.attackRange && d <= cls.chargeRange) {
    u.charges.charge -= 1;
    u.charging = { id: t.id, t: 0, dur: 0.25, dist: d };
    u.path = [];
    pushFx(game, { kind: 'text', x: u.x, y: u.y, text: 'CHARGE', life: 0.8, colour: cls.colour });
    return true;
  }
  if (d > cls.attackRange) {
    const p = findPath(game.world, cellOf(u.x, u.y), cellOf(t.x, t.y), {
      allowClosedHatch: true,
      blocked: blockedCells(game, u),
    });
    u.path = Array.isArray(p) ? p.slice() : [];
  } else {
    u.path = [];
  }
  return true;
}

/** (game, unitId, ability, target) => boolean */
export function useAbility(game, unitId, ability, target) {
  const u = unitById(game, unitId);
  if (!u || !u.alive) return false;
  if (game.phase !== 'raid') return false;
  if (u.stun > 0) return false;
  if (ability === 'charge') {
    if (!u.charges || !(u.charges.charge > 0)) return false;
    const t = unitById(game, target && target.id);
    if (!t || !t.alive || t.side === u.side) return false;
    return orderAttack(game, u.id, t.id);
  }
  const cell = targetCell(target);
  if (!cell) return false;
  if (cell.c < 0 || cell.r < 0 || cell.c >= COLS || cell.r >= ROWS) return false;
  const cx = cell.c + 0.5;
  const cy = cell.r + 0.5;
  const label = (TOOLS[ability] && TOOLS[ability].label) || String(ability).toUpperCase();

  if (ability === 'pry' || ability === 'axe') {
    if (u.breach) return false;
    const h = hatchAt(game.world, cell.c, cell.r);
    if (!h || h.open) return false;
    if (dist(u.x, u.y, cx, cy) > 1.5) return false;
    const tool = TOOLS[ability];
    u.breach = { c: cell.c, r: cell.r, progress: 0, duration: tool.duration, tool: ability };
    u.order = { type: 'breach', c: cell.c, r: cell.r, tool: ability };
    u.path = [];
    u.charging = null;
    pushLog(game, 'breach', `${u.name} starts ${label} on hatch ${cell.c},${cell.r}`);
    return true;
  }

  if (ability === 'keg') {
    if (!u.charges || !(u.charges.keg > 0)) return false;
    const h = hatchAt(game.world, cell.c, cell.r);
    if (!h || h.open) return false;
    if (dist(u.x, u.y, cx, cy) > 1.5) return false;
    if (!Array.isArray(game.pending)) game.pending = [];
    if (game.pending.some((p) => p.kind === 'keg' && p.c === cell.c && p.r === cell.r)) return false;
    u.charges.keg -= 1;
    game.pending.push({ kind: 'keg', c: cell.c, r: cell.r, t: 0, side: u.side, owner: u.id });
    pushLog(game, 'breach', `${u.name} set a KEG on hatch ${cell.c},${cell.r} - fuse 2 s`);
    pushFx(game, { kind: 'text', x: cx, y: cy, text: 'KEG', life: 1.2, colour: '#ffb066' });
    clearAim(game, ability);
    return true;
  }

  if (ability === 'smoke') {
    if (!u.charges || !(u.charges.smoke > 0)) return false;
    if (dist(u.x, u.y, cx, cy) > (TOOLS.smoke.range || 6)) return false;
    u.charges.smoke -= 1;
    game.pending.push({ kind: 'smoke', x: cx, y: cy, c: cell.c, r: cell.r, t: 0, side: u.side, owner: u.id });
    pushLog(game, 'info', `${u.name} lobbed a SMOKE pot`);
    pushFx(game, { kind: 'text', x: cx, y: cy, text: 'smoke', life: 0.9, colour: '#c9cfd4' });
    clearAim(game, ability);
    return true;
  }

  return false;
}

function clearAim(game, ability) {
  if (game.aimMode === ability) {
    game.aimMode = null;
    game.aimCell = null;
  }
}

function targetCell(target) {
  if (!target || typeof target !== 'object') return null;
  const c = Number(target.c);
  const r = Number(target.r);
  if (Number.isFinite(c) && Number.isFinite(r)) return { c: Math.trunc(c), r: Math.trunc(r) };
  const x = Number(target.x);
  const y = Number(target.y);
  if (Number.isFinite(x) && Number.isFinite(y)) return cellOf(x, y);
  return null;
}

/** (game, unitId) => void */
export function selectUnit(game, unitId) {
  if (!game) return;
  const u = unitById(game, unitId);
  game.selected = u ? u.id : null;
  game.aimMode = null;
  game.aimCell = null;
}

// ---------------------------------------------------------------- snapshot

/** (game) => object - JSON safe, never a live reference. */
export function snapshot(game) {
  if (!game) return { side: 'vikings', phase: 'raid', paused: false, aiEnabled: false, time: 0, selected: null, chests: {}, smokes: [], hatches: [], units: [], log: [] };
  const w = game.world || {};
  const hatches = Array.isArray(w.hatches)
    ? w.hatches.map((h) => ({ c: h.c, r: h.r, side: h.side, open: !!h.open }))
    : [];
  return {
    side: game.side,
    phase: game.phase,
    paused: !!game.paused,
    aiEnabled: !!game.aiEnabled,
    time: r3(game.time),
    selected: game.selected || null,
    chests: {
      pirates: chestSnap(game.chests && game.chests.pirates),
      vikings: chestSnap(game.chests && game.chests.vikings),
    },
    smokes: (game.smokes || []).map((s) => ({ x: r3(s.x), y: r3(s.y), radius: r3(s.radius), life: r3(Math.max(0, s.life)) })),
    hatches,
    units: (game.units || []).map((u) => ({
      id: u.id,
      side: u.side,
      cls: u.cls,
      name: u.name,
      hp: r3(u.hp),
      maxHp: u.maxHp,
      x: r3(u.x),
      y: r3(u.y),
      facing: r3(u.facing),
      alive: !!u.alive,
      alert: !!u.alert,
      stun: r3(u.stun),
      carrying: u.carrying || null,
      charges: {
        keg: (u.charges && u.charges.keg) || 0,
        smoke: (u.charges && u.charges.smoke) || 0,
        charge: (u.charges && u.charges.charge) || 0,
      },
      role: u.role,
      target: u.target || null,
    })),
    log: (game.log || []).slice(-20).map((e) => ({ t: e.t, kind: e.kind, text: e.text })),
  };
}

function chestSnap(c) {
  if (!c) return { state: 'home', c: 0, r: 0, carrier: null };
  return { state: c.state, c: c.c, r: c.r, carrier: c.carrier || null };
}
