// Glue: one canvas, one game, the browser's input, and the small HTML HUD.

import { Game, PHASE } from './game.js';
import { View } from './view.js';
import { MAP } from './map.js';

const canvas = document.getElementById('view');
const game = new Game();
const view = new View(canvas, game);
view.keys = new Set();

const phaseEl = document.getElementById('phase');
const crewList = document.getElementById('crewList');
const overlay = document.getElementById('overlay');
const outcomeText = document.getElementById('outcomeText');
const starsEl = document.getElementById('stars');

document.getElementById('objective').textContent = MAP.objective;
document.getElementById('crewTitle').textContent = `${MAP.squadName} — boarding party`;

// ------------------------------------------------------------------------ input

const unitAt = (x, y) => game.squad.find((u) => u.alive && u.cellX === x && u.cellY === y);

// A tap or left-click on the deck: select a raider, or plot the selected raider's next waypoint
function tapAt(clientX, clientY) {
  const cell = view.pickCell(clientX, clientY);
  if (!cell) return;
  const unit = unitAt(cell.x, cell.y);
  if (unit) {
    game.select(unit);
    return;
  }
  if (game.phase === PHASE.PLAN) game.addWaypoint(cell.x, cell.y);
}

// The same actions from buttons, keys and the crew list
const ACTIONS = {
  run: () => game.togglePause(),
  back: () => game.popWaypoint(),
  hold: () => game.toggleHold(),
  next: () => game.selectNext(),
  clear: () => game.clearPath(),
  reveal: () => {
    game.revealAll = !game.revealAll;
    game.dirtyVision = true;
  },
  restart: () => restart(),
};

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button && ACTIONS[button.dataset.action]) ACTIONS[button.dataset.action]();
  const raider = event.target.closest('button[data-unit]');
  if (raider) game.select(game.squad.find((u) => String(u.id) === raider.dataset.unit));
});
phaseEl.addEventListener('click', () => ACTIONS.run());

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

// Mouse keeps its original controls. Touch and pen: tap selects or plots, one finger drags to
// pan, two fingers pinch to zoom and pan together.
const pointers = new Map();
let panning = null;
let gesture = null;
const TAP_SLOP = 10;

const twoFinger = () => {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse') {
    if (event.button === 1) {
      panning = { x: event.clientX, y: event.clientY };
      event.preventDefault();
    } else if (event.button === 2) {
      game.popWaypoint();
    } else if (event.button === 0) {
      tapAt(event.clientX, event.clientY);
    }
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
  gesture = pointers.size === 2 ? { pinch: twoFinger(), moved: true } : pointers.size === 1 ? { moved: false } : gesture;
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse') {
    if (!panning) return;
    view.panBy(event.clientX - panning.x, event.clientY - panning.y);
    panning = { x: event.clientX, y: event.clientY };
    return;
  }
  const p = pointers.get(event.pointerId);
  if (!p) return;
  const dx = event.clientX - p.x, dy = event.clientY - p.y;
  p.x = event.clientX;
  p.y = event.clientY;
  if (pointers.size >= 2 && gesture && gesture.pinch) {
    const now = twoFinger();
    view.zoomBy(gesture.pinch.dist / now.dist);   // fingers apart = closer in
    view.panBy(now.x - gesture.pinch.x, now.y - gesture.pinch.y);
    gesture.pinch = now;
  } else if (pointers.size === 1 && gesture) {
    if (!gesture.moved && Math.hypot(event.clientX - p.startX, event.clientY - p.startY) > TAP_SLOP) gesture.moved = true;
    if (gesture.moved) view.panBy(dx, dy);
  }
});

const endPointer = (event) => {
  if (event.pointerType === 'mouse') {
    panning = null;
    return;
  }
  const p = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  if (event.type === 'pointerup' && p && pointers.size === 0 && gesture && !gesture.moved) tapAt(event.clientX, event.clientY);
  if (pointers.size === 0) gesture = null;
  else if (pointers.size === 1) gesture = { moved: true };   // lifting one finger of a pinch shouldn't tap
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') panning = null; });

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    view.zoomBy(1 + event.deltaY * 0.0012);
  },
  { passive: false }
);

// Shortcuts work anywhere except while a button or field has focus (there, Space and Enter
// press the button, and Tab moves focus as usual).
const KEYS = { ' ': 'run', r: 'restart', h: 'hold', f: 'reveal', n: 'next', backspace: 'back', escape: 'clear' };
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  const onControl = event.target.closest && event.target.closest('button, a, input, select, textarea');
  if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
    view.keys.add(key);
    return;
  }
  if (onControl && (key === ' ' || key === 'enter')) return;
  if (key === 'tab') return;
  const action = KEYS[key];
  if (!action) return;
  event.preventDefault();
  ACTIONS[action]();
});

window.addEventListener('keyup', (event) => view.keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => view.keys.clear());

function restart() {
  game.reset();
  view.resetFor();
}

// ------------------------------------------------------------------------ HUD

let lastSignature = '';
let lastMessage = '';
let lastPhase = '';
const messageEl = document.getElementById('message');
const runBtn = document.getElementById('runBtn');
const revealBtn = document.querySelector('[data-action="reveal"]');

function syncHud() {
  const phase = game.outcome ? 'over' : game.phase;
  phaseEl.className = 'phase ' + (phase === 'run' ? 'run' : phase === 'over' ? 'over' : 'plan');
  phaseEl.textContent = game.outcome
    ? 'MISSION OVER — REPLAY'
    : game.phase === PHASE.RUN
      ? 'RUNNING — PAUSE'
      : 'PLANNING — RUN';
  runBtn.firstChild.textContent = game.phase === PHASE.RUN && !game.outcome ? 'Pause ' : 'Run ';
  runBtn.disabled = Boolean(game.outcome);
  revealBtn.setAttribute('aria-pressed', String(game.revealAll));

  // Messages are shown and read aloud; phase changes are announced too
  const phaseWord = game.outcome ? '' : game.phase === PHASE.RUN ? 'Running.' : 'Planning. Paused.';
  if (phase !== lastPhase) {
    lastPhase = phase;
    if (phase === 'plan') lastMessage = game.message;   // after a restart, old messages stay quiet
    messageEl.textContent = game.outcome
      ? (game.outcome.result === 'win' ? MAP.winText : MAP.loseText)
      : phaseWord;
  }
  if (game.message && game.message !== lastMessage) {
    lastMessage = game.message;
    messageEl.textContent = game.message;
  }

  const signature = game.units
    .map((u) => `${u.id}${u.alive ? 1 : 0}${u.hp}${u.plan.length}${u.carrying ? 1 : 0}`)
    .join('|') + `#${game.selected ? game.selected.id : -1}`;

  if (signature !== lastSignature) {
    lastSignature = signature;
    const hadFocus = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.unit;
    crewList.replaceChildren();
    for (const unit of game.squad) {
      const row = document.createElement('li');
      row.className = (unit.alive ? '' : 'dead ') + (game.selected === unit ? 'selected' : '');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.unit = String(unit.id);
      button.disabled = !unit.alive;
      button.setAttribute('aria-pressed', String(game.selected === unit));
      const left = document.createElement('span');
      left.append(unit.cls.name + ' ');
      const role = document.createElement('span');
      role.className = 'role';
      role.textContent = unit.cls.slot;
      left.append(role);
      const right = document.createElement('span');
      if (!unit.alive) right.textContent = 'down';
      else if (unit.carrying) { right.className = 'carry'; right.textContent = 'chest'; }
      else {
        right.className = 'pips';
        right.textContent = '●'.repeat(Math.max(0, unit.hp));
        right.setAttribute('aria-label', `health ${unit.hp}`);
      }
      button.append(left, right);
      row.append(button);
      crewList.append(row);
    }
    if (hadFocus) {
      const again = crewList.querySelector(`[data-unit="${hadFocus}"]`);
      if (again && !again.disabled) again.focus();
    }
  }

  if (game.outcome) {
    overlay.classList.remove('hidden');
    overlay.classList.toggle('win', game.outcome.result === 'win');
    overlay.classList.toggle('lose', game.outcome.result === 'lose');
    outcomeText.textContent =
      game.outcome.result === 'win' ? MAP.winText : MAP.loseText;
    starsEl.textContent =
      game.outcome.result === 'win'
        ? '★'.repeat(game.stars) + '☆'.repeat(3 - game.stars)
        : '';
    starsEl.setAttribute('aria-label', game.outcome.result === 'win' ? `${game.stars} of 3 stars` : '');
  } else {
    overlay.classList.add('hidden');
  }
}

// ------------------------------------------------------------------------ loop

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  game.update(dt);
  view.update(dt);
  syncHud();
  requestAnimationFrame(frame);
}

syncHud();
requestAnimationFrame(frame);

// Handy for poking at the slice from the console.
window.stormers = { game, view };
