// src/ai.js
// The other crew: guards hold their post and shoot; raiders take the planks,
// breach a hatch with the axe, carry the chest home. Driven by sim.step().
import { CLASSES, cellOf, dist, turnToward } from './contracts.js';
import { hatchAt, isWalkable } from './world.js';
import { orderMove, orderAttack, useAbility, unitById, canSee } from './sim.js';

const OTHER = { vikings: 'pirates', pirates: 'vikings' };
const RAIDER_ID = { vikings: 'vX', pirates: 'pC' };
const SIDES = ['vikings', 'pirates'];
const DEG = Math.PI / 180;

/** (game, dt) => void */
export function aiUpdate(game, dt) {
  if (!game || !Array.isArray(game.units)) return;
  const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
  assignRoles(game);
  const side = OTHER[game.side];
  if (!side) return;
  for (const u of game.units) {
    if (!u.alive || u.side !== side) continue;
    if (u.breach || u.charging) continue;
    u.thinkT = (Number.isFinite(u.thinkT) ? u.thinkT : 0) - d;
    if (u.thinkT <= 0) {
      u.thinkT = 0.25;
      think(game, u);
    } else if (!u.path || !u.path.length) {
      turnToPost(u, d);
    }
  }
}

// One raider per side (the cutlass on the pirates' main deck, an axeman for the
// vikings); everyone else guards. A raider that dies is replaced.
function assignRoles(game) {
  for (const u of game.units) {
    if (!u || !u.alive) continue;
    if (u.role !== 'raider' && u.role !== 'guard') {
      u.role = RAIDER_ID[u.side] === u.id ? 'raider' : 'guard';
    }
  }
  for (const s of SIDES) {
    const mine = game.units.filter((u) => u.alive && u.side === s);
    if (!mine.length) continue;
    if (mine.some((u) => u.role === 'raider')) continue;
    const pick = mine.find((u) => u.id === RAIDER_ID[s]) || mine[0];
    pick.role = 'raider';
  }
}

function think(game, u) {
  if (!u.alive || u.stun > 0 || u.breach || u.charging) return;
  const cls = CLASSES[u.cls];
  if (!cls) return;
  dropStaleOrder(game, u);

  // 1. Our chest is being carried away: hunt the carrier down.
  const own = game.chests && game.chests[u.side];
  if (own && own.state === 'carried' && own.carrier) {
    const carrier = unitById(game, own.carrier);
    if (carrier && carrier.alive) {
      if (canSee(game, u, carrier) && dist(u.x, u.y, carrier.x, carrier.y) <= cls.attackRange) {
        orderAttack(game, u.id, carrier.id);
        return;
      }
      const cell = cellOf(carrier.x, carrier.y);
      if (goTo(game, u, cell.c, cell.r, 'carry')) return;
    }
  }

  // 2. Fight what we can see.
  const tgt = nearestVisible(game, u);
  if (tgt) {
    const d = dist(u.x, u.y, tgt.x, tgt.y);
    if (d <= cls.attackRange) {
      orderAttack(game, u.id, tgt.id);
      return;
    }
    if (cls.attack === 'melee') {
      const far = u.role === 'guard' && d > Math.max(cls.chargeRange || 0, 3.5);
      if (!far) {
        orderAttack(game, u.id, tgt.id);
        return;
      }
    } else if (u.role === 'raider' && u.alert) {
      orderAttack(game, u.id, tgt.id);
      return;
    }
  }

  // 3. Raiders go for the other crew's chest.
  if (u.role === 'raider') {
    if (raiderStep(game, u)) return;
  }

  // 4. Guards hold their post and watch their door.
  const post = postOf(u);
  const cur = cellOf(u.x, u.y);
  if (cur.c !== post.c || cur.r !== post.r) {
    if (u.order && u.order.type === 'attack') { u.order = null; u.target = null; }
    if (!u.path || !u.path.length) goAdjacent(game, u, post.c, post.r, 'move', 1);
  } else if (u.order && u.order.type === 'attack') {
    u.order = null;
    u.target = null;
  }
}

function raiderStep(game, u) {
  const chests = game.chests || {};
  const foe = chests[OTHER[u.side]];
  if (!foe) return false;
  if (u.carrying) {
    const home = chestHome(game, u.side);
    return goAdjacent(game, u, home.c, home.r, 'carry', 1);
  }
  if (foe.state === 'carried') return false;
  if (breachStep(game, u)) return true;
  // head for the chest; if a closed hatch is the next step, break it open
  return goAdjacent(game, u, foe.c, foe.r, 'move', 1);
}

function breachStep(game, u) {
  const w = game.world;
  const cells = [];
  if (u.path && u.path[0]) cells.push(u.path[0]);
  if (w && Array.isArray(w.hatches)) {
    for (const h of w.hatches) {
      if (!h || h.open) continue;
      if (dist(u.x, u.y, h.c + 0.5, h.r + 0.5) <= 1.6) cells.push({ c: h.c, r: h.r });
    }
  }
  for (const cell of cells) {
    const h = hatchAt(game.world, cell.c, cell.r);
    if (!h || h.open) continue;
    if (dist(u.x, u.y, cell.c + 0.5, cell.r + 0.5) > 1.5) continue;
    if (enemyNear(game, u, 3)) return false;
    if (u.breach) return true;
    return useAbility(game, u.id, 'axe', { c: cell.c, r: cell.r });
  }
  return false;
}

function dropStaleOrder(game, u) {
  if (!u.order || u.order.type !== 'attack') return;
  const t = unitById(game, u.order.id);
  const reach = CLASSES[u.cls] ? CLASSES[u.cls].attackRange : 1;
  if (!t || !t.alive) {
    u.order = null;
    u.target = null;
    u.path = [];
    return;
  }
  const d = dist(u.x, u.y, t.x, t.y);
  if (d > reach && !canSee(game, u, t)) {
    u.order = null;
    u.target = null;
    u.path = [];
  }
}

function nearestVisible(game, u) {
  let best = null;
  let bd = Infinity;
  for (const o of game.units) {
    if (!o.alive || o.side === u.side) continue;
    if (!canSee(game, u, o)) continue;
    const d = dist(u.x, u.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function enemyNear(game, u, radius) {
  for (const o of game.units) {
    if (!o.alive || o.side === u.side) continue;
    if (dist(u.x, u.y, o.x, o.y) <= radius) return o;
  }
  return null;
}

function postOf(u) {
  if (Number.isFinite(u.homeC) && Number.isFinite(u.homeR)) return { c: u.homeC, r: u.homeR, facing: u.postFacing };
  const cell = cellOf(u.x, u.y);
  return { c: cell.c, r: cell.r, facing: u.facing };
}

function turnToPost(u, dt) {
  if (u.role !== 'guard') return;
  if (u.target || u.breach || u.charging || u.stun > 0) return;
  const face = u.postFacing;
  if (!Number.isFinite(face) || !CLASSES[u.cls]) return;
  const rate = CLASSES[u.cls].turnSpeed * DEG * Math.max(dt, 0.016);
  u.facing = turnToward(u.facing, face, rate);
}

function chestHome(game, side) {
  const wc = (game.world && game.world.chests) || {};
  const h = wc[side];
  if (h && Number.isFinite(h.c)) return { c: h.c, r: h.r };
  const ch = game.chests && game.chests[side];
  return { c: ch ? ch.c : 0, r: ch ? ch.r : 0 };
}

// Move toward a goal cell; returns true when an order was issued or already held.
function goTo(game, u, c, r, type) {
  if (!Number.isFinite(c) || !Number.isFinite(r)) return false;
  const cur = cellOf(u.x, u.y);
  if (cur.c === c && cur.r === r) { u.path = []; return true; }
  const o = u.order;
  if (o && o.type === type && o.c === c && o.r === r && u.path && u.path.length) return true;
  const ok = orderMove(game, u.id, c, r);
  if (!ok) return false;
  u.order = { type, c, r };
  return true;
}

// Try the cells around (c,r), nearest first, until one is reachable.
function goAdjacent(game, u, c, r, type, span) {
  const cells = [];
  for (let dc = -span; dc <= span; dc++) {
    for (let dr = -span; dr <= span; dr++) {
      if (!dc && !dr) continue;
      const cc = c + dc;
      const rr = r + dr;
      if (!isWalkable(game.world, cc, rr)) continue;
      cells.push({ c: cc, r: rr, d: dist(u.x, u.y, cc + 0.5, rr + 0.5) });
    }
  }
  cells.sort((a, b) => a.d - b.d || a.c - b.c || a.r - b.r);
  for (const cell of cells) {
    if (goTo(game, u, cell.c, cell.r, type)) return true;
  }
  return false;
}
