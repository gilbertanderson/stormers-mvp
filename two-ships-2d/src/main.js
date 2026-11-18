// src/main.js
// Wiring only: one game, one canvas view, one DOM HUD, input, the frame loop and
// the values/actions the playtests read. All rules live in sim.js / ai.js.
import { createGame, step, orderMove, orderAttack, useAbility, selectUnit, snapshot, eliminateSide, setDormant } from './sim.js';
import { createView } from './view.js';
import { createHud } from './hud.js';
import { KEYMAP, dist } from './contracts.js';
import { hatchAt } from './world.js';

const stageEl = document.getElementById('stage');
const canvasEl = document.getElementById('board');
const appEl = document.getElementById('app');

let side = 'vikings';
let game = createGame({ side, aiEnabled: true, seed: 7 });

const view = createView(canvasEl);
const hud = createHud(appEl, {
  onSide(next) {
    side = next === 'pirates' ? 'pirates' : 'vikings';
    restart();
  },
  onPause() {
    game.paused = !game.paused;
  },
  onRestart() {
    restart();
  },
  onAbility(name) {
    fireAbility(name);
  },
  onSelect(id) {
    pickUnit(id);
  },
  onHover(id) {
    game.hoverId = id;
  },
});

function restart() {
  game = createGame({ side, aiEnabled: true, seed: 7 });
  hud.update(game);
}

// ------------------------------------------------------------------ helpers

function selectedUnit() {
  if (!game.selected) return null;
  for (const u of game.units) {
    if (u.id === game.selected && u.alive && u.side === game.side) return u;
  }
  return null;
}

function pickUnit(id) {
  for (const u of game.units) {
    if (u.id === id && u.alive && u.side === game.side) {
      selectUnit(game, id);
      hud.update(game);
      return true;
    }
  }
  return false;
}

function nearestClosedHatch(unit) {
  if (!unit || !game.world) return null;
  let best = null;
  let bd = 1.51;
  for (const h of game.world.hatches) {
    if (!h || h.open) continue;
    const d = dist(unit.x, unit.y, h.c + 0.5, h.r + 0.5);
    if (d <= bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

function fireAbility(name) {
  const u = selectedUnit();
  if (!u || game.phase !== 'raid') return false;
  if (name === 'smoke') {
    if (!(u.charges.smoke > 0)) return false;
    game.aimMode = game.aimMode === 'smoke' ? null : 'smoke';
    game.aimCell = null;
    hud.update(game);
    return true;
  }
  if (name === 'pry' || name === 'axe' || name === 'keg') {
    const h = nearestClosedHatch(u);
    if (!h) {
      game.aimMode = null;
      return false;
    }
    const ok = useAbility(game, u.id, name, { c: h.c, r: h.r });
    hud.update(game);
    return ok;
  }
  return false;
}

// ------------------------------------------------------------------- input

function localPoint(ev) {
  const r = canvasEl.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

function handleClick(p) {
  const hitId = view.unitAt(game, p.x, p.y);
  const cell = view.cellAt(p.x, p.y);
  if (game.phase !== 'raid') return;
  const sel = selectedUnit();

  if (game.aimMode === 'smoke') {
    if (sel && cell) useAbility(game, sel.id, 'smoke', cell);
    game.aimMode = null;
    game.aimCell = null;
    hud.update(game);
    return;
  }

  if (hitId) {
    const other = game.units.find((u) => u.id === hitId);
    if (other && other.alive) {
      if (other.side === game.side) {
        pickUnit(other.id);
        return;
      }
      if (sel) {
        orderAttack(game, sel.id, other.id);
        hud.update(game);
        return;
      }
    }
  }

  if (cell && sel) {
    const h = hatchAt(game.world, cell.c, cell.r);
    if (h && !h.open) {
      // Walk onto the hatch: the unit stops beside it, then PRY / AXE / KEG.
      orderMove(game, sel.id, cell.c, cell.r);
      hud.update(game);
      return;
    }
    orderMove(game, sel.id, cell.c, cell.r);
    hud.update(game);
  }
}

canvasEl.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  handleClick(localPoint(ev));
});

canvasEl.addEventListener('pointermove', (ev) => {
  const p = localPoint(ev);
  game.hoverId = view.unitAt(game, p.x, p.y);
  if (game.aimMode === 'smoke') game.aimCell = view.cellAt(p.x, p.y);
  canvasEl.style.cursor = game.hoverId ? 'pointer' : game.aimMode === 'smoke' ? 'crosshair' : 'default';
});

canvasEl.addEventListener('pointerleave', () => {
  game.hoverId = null;
});

window.addEventListener('keydown', (ev) => {
  const code = ev.code;
  if (code === KEYMAP.pause) {
    ev.preventDefault();
    game.paused = !game.paused;
    hud.update(game);
    return;
  }
  if (code === KEYMAP.cancel) {
    game.aimMode = null;
    game.aimCell = null;
    return;
  }
  if (code === KEYMAP.pry) fireAbility('pry');
  else if (code === KEYMAP.axe) fireAbility('axe');
  else if (code === KEYMAP.keg) fireAbility('keg');
  else if (code === KEYMAP.smoke) fireAbility('smoke');
});

// -------------------------------------------------------------------- loop

function fit() {
  const r = stageEl.getBoundingClientRect();
  view.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1));
}

if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(stageEl);
window.addEventListener('resize', fit);
fit();
view.resize(stageEl.clientWidth, stageEl.clientHeight, Math.min(2, window.devicePixelRatio || 1));
view.draw(game, 0);
hud.update(game);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  step(game, dt);
  view.draw(game, dt);
  hud.update(game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------- playtest hooks

const bridge = typeof AuraSlice !== 'undefined' ? AuraSlice : null;

function expose(name, fn) {
  try {
    if (bridge && bridge.expose) bridge.expose(name, fn);
  } catch (err) {
    /* the harness is optional */
  }
}

function exposeAction(name, fn) {
  try {
    if (bridge && bridge.exposeAction) bridge.exposeAction(name, fn);
  } catch (err) {
    /* the harness is optional */
  }
}

function advance(seconds) {
  const total = Math.max(0, Math.min(120, Number(seconds) || 0));
  const wasPaused = game.paused;
  game.paused = false;
  const n = Math.ceil(total / (1 / 60));
  for (let i = 0; i < n; i++) step(game, 1 / 60);
  game.paused = wasPaused;
  return { phase: game.phase, time: Math.round(game.time * 100) / 100 };
}

expose('phase', () => game.phase);
expose('side', () => game.side);
expose('time', () => Math.round(game.time * 100) / 100);
expose('selected', () => game.selected);
expose('units', () => snapshot(game).units);
expose('chests', () => snapshot(game).chests);
expose('hatches', () => snapshot(game).hatches);
expose('log', () => snapshot(game).log);
expose('smokes', () => snapshot(game).smokes);
expose('nav', () => game.units.map((u) => ({ id: u.id, x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10, path: u.path ? u.path.length : 0, order: u.order ? u.order.type : null, breach: u.breach ? u.breach.c + ',' + u.breach.r : null, alive: u.alive, carrying: u.carrying || null })));
expose('endText', () => {
  const t = document.querySelector('#overlay .over-title');
  const ov = document.getElementById('overlay');
  return {
    title: t ? t.textContent : '',
    hidden: ov ? ov.classList.contains('hidden') : true,
  };
});

exposeAction('advance', (seconds) => advance(seconds));
exposeAction('move', (unitId, c, r) => orderMove(game, unitId, c, r));
exposeAction('attack', (unitId, targetId) => orderAttack(game, unitId, targetId));
exposeAction('ability', (unitId, name, target) => useAbility(game, unitId, name, target));
exposeAction('select', (unitId) => pickUnit(unitId));
exposeAction('useSelected', (name) => fireAbility(name));
exposeAction('eliminate', (who) => {
  eliminateSide(game, who === 'pirates' ? 'pirates' : 'vikings');
  hud.update(game);
});
exposeAction('dormant', (who, on) => setDormant(game, who === 'pirates' ? 'pirates' : 'vikings', on !== false));
exposeAction('ai', (on) => {
  game.aiEnabled = !!on;
  return game.aiEnabled;
});
exposeAction('playside', (next) => {
  side = next === 'pirates' ? 'pirates' : 'vikings';
  restart();
  return game.side;
});
exposeAction('restart', () => {
  restart();
  return game.phase;
});
// Deterministic start for playtests: a fresh board, optionally with the AI off,
// held frozen so only advance() moves time.
exposeAction('fresh', (opts) => {
  const o = opts && typeof opts === 'object' ? opts : {};
  if (o.side === 'vikings' || o.side === 'pirates') side = o.side;
  game = createGame({ side, aiEnabled: !!o.ai, seed: Number.isFinite(o.seed) ? o.seed : 7 });
  game.aiEnabled = !!o.ai;
  game.paused = true;
  hud.update(game);
  return { side: game.side, phase: game.phase, paused: game.paused, ai: game.aiEnabled };
});
