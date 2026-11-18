// src/world.js
// Map parsing, grid queries and pathfinding for "The Two Ships".
// Pure data + pure functions: no DOM, no canvas, no module state.
// Everything here is derived from MAP_ROWS in ./contracts.js.

import { COLS, ROWS, TILE, MAP_ROWS, centerOf, cellOf } from './contracts.js';

// Rows 7 and 9 are the outer hull rows: a 'D' there is a closed, breachable
// cabin hatch rather than a walkable doorway.
const HATCH_ROW_PIRATES = 7;
const HATCH_ROW_VIKINGS = 9;
const PLANK_ROW = 8;

// Map letters -> unit class key.
const CLASS_BY_LETTER = {
  p: 'pistol',
  q: 'pistol',
  c: 'cutlass',
  k: 'cutlass',
  S: 'shield',
  X: 'axe',
  Y: 'axe',
  R: 'archer',
};

const SIDE_BY_LETTER = {
  p: 'pirates',
  q: 'pirates',
  c: 'pirates',
  k: 'pirates',
  S: 'vikings',
  X: 'vikings',
  Y: 'vikings',
  R: 'vikings',
};

// ------------------------------------------------------------------ world

export function createWorld() {
  const cols = COLS;
  const rows = ROWS;
  const tiles = new Uint8Array(cols * rows);
  const spawns = [];
  const hatches = [];
  const planks = [];
  const chests = { pirates: null, vikings: null };

  for (let r = 0; r < rows; r++) {
    const srcRow = typeof MAP_ROWS[r] === 'string' ? MAP_ROWS[r] : '';
    for (let c = 0; c < cols; c++) {
      // Defensive: a short row pads with open water, a long one is trimmed by
      // the loop bound, so the grid is always COLS x ROWS.
      const ch = c < srcRow.length ? srcRow.charAt(c) : '~';
      let tile = TILE.WATER;

      if (ch === '#') {
        tile = TILE.HULL;
      } else if (ch === '.' || ch === '$' || ch === '%') {
        tile = r === PLANK_ROW ? TILE.PLANK : TILE.DECK;
        if (tile === TILE.PLANK) planks.push({ c, r });
        if (ch === '$') chests.pirates = { c, r };
        if (ch === '%') chests.vikings = { c, r };
      } else if (ch === 'D') {
        if (r === HATCH_ROW_PIRATES || r === HATCH_ROW_VIKINGS) {
          tile = TILE.HATCH;
          hatches.push({
            c,
            r,
            side: r === HATCH_ROW_PIRATES ? 'pirates' : 'vikings',
            open: false,
          });
        } else {
          tile = TILE.DOOR;
        }
      } else if (ch === '~') {
        tile = TILE.WATER;
      } else if (CLASS_BY_LETTER[ch]) {
        tile = TILE.DECK;
        spawns.push({ ch, c, r, side: SIDE_BY_LETTER[ch], cls: CLASS_BY_LETTER[ch] });
      } else {
        tile = TILE.WATER;
      }

      tiles[r * cols + c] = tile;
    }
  }

  if (!chests.pirates) chests.pirates = { c: cols - 2, r: 2 };
  if (!chests.vikings) chests.vikings = { c: 1, r: rows - 3 };

  return { cols, rows, tiles, spawns, chests, hatches, planks };
}

// ------------------------------------------------------------------ queries

export function cellKey(c, r) {
  return c + ',' + r;
}

function inBounds(world, c, r) {
  return !!world && c >= 0 && r >= 0 && c < world.cols && r < world.rows;
}

export function tileAt(world, c, r) {
  if (!inBounds(world, c, r)) return TILE.HULL;
  return world.tiles[r * world.cols + c];
}

export function hatchAt(world, c, r) {
  if (!world || !world.hatches) return null;
  for (let i = 0; i < world.hatches.length; i++) {
    const h = world.hatches[i];
    if (h.c === c && h.r === r) return h;
  }
  return null;
}

export function isWalkable(world, c, r) {
  if (!inBounds(world, c, r)) return false;
  const t = world.tiles[r * world.cols + c];
  if (t === TILE.DECK || t === TILE.DOOR || t === TILE.PLANK) return true;
  if (t === TILE.HATCH) {
    const h = hatchAt(world, c, r);
    return !!(h && h.open === true);
  }
  return false;
}

export function openHatch(world, c, r) {
  const h = hatchAt(world, c, r);
  if (!h) return false;
  h.open = true;
  return true;
}

// ------------------------------------------------------------------ sight

/** True when nothing solid sits between the two points (cell space). */
export function losClear(world, x0, y0, x1, y1) {
  if (!world) return false;
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return false;
  }

  const blocks = (c, r) => {
    const t = tileAt(world, c, r);
    if (t === TILE.HULL) return true;
    if (t === TILE.HATCH) {
      const h = hatchAt(world, c, r);
      return !(h && h.open === true);
    }
    return false; // WATER, DECK, DOOR and PLANK do not block sight
  };

  const a = cellOf(x0, y0);
  const b = cellOf(x1, y1);
  if (blocks(a.c, a.r) || blocks(b.c, b.r)) return false;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p = cellOf(x0 + dx * t, y0 + dy * t);
    if (blocks(p.c, p.r)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ paths

const DIRS = [
  { c: 0, r: -1 }, // N
  { c: 1, r: 0 }, // E
  { c: 0, r: 1 }, // S
  { c: -1, r: 0 }, // W
];

/**
 * BFS over 4-neighbours in the fixed order N, E, S, W (deterministic).
 * Returns [{c,r}, ...] from the first step to `to`, [] when the cells match,
 * null when there is no route.
 * opts: { allowClosedHatch = false, blocked = null (array of 'c,r' strings) }
 */
export function findPath(world, from, to, opts) {
  if (!world || !from || !to) return null;
  const options = opts || {};
  const allowClosedHatch = options.allowClosedHatch === true;
  const blockedSet = options.blocked ? new Set(options.blocked) : null;

  const cols = world.cols;
  const rows = world.rows;
  const sc = Math.floor(from.c);
  const sr = Math.floor(from.r);
  const tc = Math.floor(to.c);
  const tr = Math.floor(to.r);

  if (!inBounds(world, sc, sr) || !inBounds(world, tc, tr)) return null;
  if (sc === tc && sr === tr) return [];

  const targetKey = cellKey(tc, tr);

  const passable = (c, r) => {
    const t = tileAt(world, c, r);
    if (t === TILE.DECK || t === TILE.DOOR || t === TILE.PLANK) return true;
    if (t === TILE.HATCH) {
      if (allowClosedHatch) return true;
      const h = hatchAt(world, c, r);
      return !!(h && h.open === true);
    }
    return false;
  };

  const startIdx = sr * cols + sc;
  const visited = new Uint8Array(cols * rows);
  const parent = new Int32Array(cols * rows).fill(-1);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;

  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  while (head < tail) {
    const idx = queue[head++];
    const c = idx % cols;
    const r = (idx - c) / cols;

    for (let d = 0; d < DIRS.length; d++) {
      const nc = c + DIRS[d].c;
      const nr = r + DIRS[d].r;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (visited[nIdx]) continue;

      const key = cellKey(nc, nr);
      const isTarget = key === targetKey;
      // Terrain must always be passable; a `blocked` (occupied) cell is never
      // entered, except as the final step of the path.
      if (!passable(nc, nr)) continue;
      if (!isTarget && blockedSet && blockedSet.has(key)) continue;

      visited[nIdx] = 1;
      parent[nIdx] = idx;
      if (isTarget) {
        // Reconstruct without touching the queue.
        const steps = [];
        let cur = nIdx;
        while (cur !== startIdx && cur >= 0) {
          const cc = cur % cols;
          const rr = (cur - cc) / cols;
          steps.push({ c: cc, r: rr });
          cur = parent[cur];
        }
        steps.reverse();
        return steps;
      }
      queue[tail++] = nIdx;
    }
  }

  return null;
}

// ------------------------------------------------------------------ areas

/** Every cell whose centre lies within `radius` of the point (cell space). */
export function cellsWithin(x, y, radius) {
  const out = [];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) {
    return out;
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = centerOf(c, r);
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= radius * radius) out.push({ c, r });
    }
  }
  return out;
}
