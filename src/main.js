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

let panning = null;

canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 1) {
    panning = { x: event.clientX, y: event.clientY };
    event.preventDefault();
    return;
  }

  const cell = view.pickCell(event.clientX, event.clientY);

  if (event.button === 2) {
    game.popWaypoint();
    return;
  }
  if (event.button !== 0 || !cell) return;

  const unit = unitAt(cell.x, cell.y);
  if (unit) {
    game.select(unit);
    return;
  }
  if (game.phase === PHASE.PLAN) game.addWaypoint(cell.x, cell.y);
});

canvas.addEventListener('pointermove', (event) => {
  if (!panning) return;
  view.panBy(event.clientX - panning.x, event.clientY - panning.y);
  panning = { x: event.clientX, y: event.clientY };
});

const endPan = () => {
  panning = null;
};
canvas.addEventListener('pointerup', endPan);
canvas.addEventListener('pointerleave', endPan);

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    view.zoomBy(1 + event.deltaY * 0.0012);
  },
  { passive: false }
);

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (key === ' ') {
    event.preventDefault();
    game.togglePause();
  } else if (key === 'r') {
    restart();
  } else if (key === 'h') {
    game.toggleHold();
  } else if (key === 'f') {
    game.revealAll = !game.revealAll;
    game.dirtyVision = true;
  } else if (key === 'tab') {
    event.preventDefault();
    game.selectNext();
  } else if (key === 'backspace') {
    event.preventDefault();
    game.popWaypoint();
  } else if (key === 'escape') {
    game.clearPath();
  }
  if (key === 'w' || key === 'a' || key === 's' || key === 'd') view.keys.add(key);
});

window.addEventListener('keyup', (event) => view.keys.delete(event.key.toLowerCase()));

function restart() {
  game.reset();
  view.resetFor();
}

// ------------------------------------------------------------------------ HUD

let lastSignature = '';

function syncHud() {
  const phase = game.outcome ? 'over' : game.phase;
  phaseEl.className = 'phase ' + (phase === 'run' ? 'run' : phase === 'over' ? 'over' : 'plan');
  phaseEl.textContent = game.outcome
    ? 'MISSION OVER'
    : game.phase === PHASE.RUN
      ? 'RUNNING — SPACE TO PAUSE'
      : 'PLANNING — SPACE TO RUN';

  const signature = game.units
    .map((u) => `${u.id}${u.alive ? 1 : 0}${u.hp}${u.plan.length}${u.carrying ? 1 : 0}`)
    .join('|') + `#${game.selected ? game.selected.id : -1}`;

  if (signature !== lastSignature) {
    lastSignature = signature;
    crewList.innerHTML = '';
    for (const unit of game.squad) {
      const row = document.createElement('li');
      row.className =
        (unit.alive ? '' : 'dead ') + (game.selected === unit ? 'selected' : '');
      const left = document.createElement('span');
      left.innerHTML = `${unit.cls.name} <span class="role">${unit.cls.slot}</span>`;
      const right = document.createElement('span');
      if (unit.carrying) right.innerHTML = '<span class="carry">chest</span>';
      else right.innerHTML = `<span class="pips">${'●'.repeat(Math.max(0, unit.hp))}</span>`;
      row.append(left, right);
      crewList.append(row);
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
