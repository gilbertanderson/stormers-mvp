// src/contracts.js
// Shared vocabulary for "The Two Ships" (Stormers: Hull Raiders mission prototype).
// Every part imports from here. Nothing else in the Slice may redefine the map,
// the class numbers or the palette.

export const COLS = 28;
export const ROWS = 17;

export const TILE = {
  WATER: 0,
  HULL: 1,
  DECK: 2,
  DOOR: 3,
  HATCH: 4,
  PLANK: 5,
};

export const PALETTE = {
  water: '#0b2430',
  waterLine: '#123a4a',
  deck: '#c6a171',
  deckAlt: '#bd9768',
  deckLine: '#a8814f',
  hull: '#43301f',
  hullEdge: '#5d4329',
  door: '#e9b93c',
  hatch: '#e0a92f',
  hatchDark: '#7d5312',
  plank: '#a97c47',
  plankEdge: '#7f5a31',
  chest: '#f2c14e',
  chestDark: '#7d5a12',
  viking: '#5b8fd6',
  pirate: '#d9483c',
  smoke: '#c9cfd4',
  blast: '#ffb066',
  text: '#f2e7d5',
  dim: '#9fb2bd',
  panel: '#0f2129',
  panelEdge: '#22485a',
  good: '#6ed07a',
  bad: '#e0574a',
};

// The deck layout, top to bottom. 28 x 17.
// Top ship = pirates ($ chest, letter spawns p q c k), bottom ship = vikings
// (% chest, letter spawns S X Y R). Row 8 is open water with three planks
// (columns 6, 13-14 and 21). The 'D' on row 7 (col 21) and row 9 (col 6) sit in
// the outer hull: they are the closed cabin hatches the raiders have to breach.
export const MAP_ROWS = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~##########################~',
  '~#.......#........#.....$.#~',
  '~#...#...#........#....p..#~',
  '~#....k..D...##...D...#...#~',
  '~#.......#.c....q.#.......#~',
  '~#.......#........#.......#~',
  '~#####.######..######D#####~',
  '~~~~~~.~~~~~~..~~~~~~.~~~~~~',
  '~#####D######..######.#####~',
  '~#.......#........#.......#~',
  '~#.......#.S....X.#.......#~',
  '~#...#...D...##...D..Y....#~',
  '~#..R....#........#...#...#~',
  '~#.%.....#........#.......#~',
  '~##########################~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
];

// Unit classes: the first-pass numbers from the Unity project. Keep them.
// hp / moveSpeed (cells per second) / turnSpeed (deg per s) / reaction (s).
export const CLASSES = {
  shield: {
    key: 'shield',
    name: 'Shield-bearer',
    side: 'vikings',
    label: 'SHIELD',
    colour: '#5b8fd6',
    hp: 2,
    moveSpeed: 2.0,
    turnSpeed: 300,
    reaction: 0.35,
    attack: 'melee',
    attackRange: 0.95,
    attackInterval: 0.9,
    chargeRange: 2.5,
    block: 0.9,
    throwables: 1,
    charges: { keg: 1, smoke: 1, charge: 1 },
    notes: 'Slow but stops most shots from the front - send them through the door first.',
  },
  axe: {
    key: 'axe',
    name: 'Axeman',
    side: 'vikings',
    label: 'AXE',
    colour: '#57c26a',
    hp: 1,
    moveSpeed: 3.0,
    turnSpeed: 480,
    reaction: 0.25,
    attack: 'melee',
    attackRange: 0.95,
    attackInterval: 0.6,
    chargeRange: 4.5,
    throwables: 0,
    charges: { keg: 1, smoke: 0, charge: 1 },
    notes: 'Fast and lethal in reach - rushes any enemy it sees nearby.',
  },
  archer: {
    key: 'archer',
    name: 'Archer',
    side: 'vikings',
    label: 'ARCHER',
    colour: '#f0d24b',
    hp: 1,
    moveSpeed: 2.6,
    turnSpeed: 420,
    reaction: 0.4,
    attack: 'ranged',
    attackRange: 8,
    attackInterval: 1.4,
    accuracy: 0.9,
    accuracyAtMax: 0.5,
    loud: false,
    throwables: 1,
    charges: { keg: 1, smoke: 1, charge: 0 },
    notes: 'The only reach, and quiet - a kill does not wake the ship.',
  },
  pistol: {
    key: 'pistol',
    name: 'Pistoleer',
    side: 'pirates',
    label: 'PISTOL',
    colour: '#d9483c',
    hp: 1,
    moveSpeed: 2.4,
    turnSpeed: 300,
    reaction: 0.6,
    attack: 'ranged',
    attackRange: 7,
    attackInterval: 2.6,
    accuracy: 0.9,
    accuracyAtMax: 0.4,
    loud: true,
    noiseRadius: 8,
    throwables: 1,
    charges: { keg: 1, smoke: 1, charge: 0 },
    notes: 'One loud shot then a long reload - deadly down a clear line.',
  },
  cutlass: {
    key: 'cutlass',
    name: 'Cutlass',
    side: 'pirates',
    label: 'CUTLASS',
    colour: '#e8893a',
    hp: 1,
    moveSpeed: 2.7,
    turnSpeed: 360,
    reaction: 0.5,
    attack: 'melee',
    attackRange: 0.95,
    attackInterval: 0.7,
    chargeRange: 5,
    throwables: 0,
    charges: { keg: 1, smoke: 0, charge: 1 },
    notes: 'Charges whoever it sees - slower to react than an axeman.',
  },
};

// Raiding tools: the same kit on both ships.
export const TOOLS = {
  pry: { key: 'pry', label: 'PRY', keycap: '1', duration: 3, noise: 0, hint: '3 s to open, silent' },
  axe: { key: 'axe', label: 'AXE', keycap: '2', duration: 1.2, noise: 7, hint: '1.2 s to open, noise 7' },
  keg: {
    key: 'keg',
    label: 'KEG',
    keycap: '3',
    place: 1,
    fuse: 2,
    noise: 14,
    blastRadius: 3.2,
    lethalRadius: 1.4,
    stun: 4,
    hint: '1 s to place, 2 s fuse, noise 14',
  },
  smoke: {
    key: 'smoke',
    label: 'SMOKE',
    keycap: '4',
    range: 6,
    delay: 1,
    radius: 2.4,
    stun: 4,
    noise: 5,
    life: 9,
    hint: 'range 6, 1 s delay, stun 4 s',
  },
};

export const SIDES = ['vikings', 'pirates'];
export const SIDE_LABEL = { vikings: 'Vikings', pirates: 'Pirates' };

export const VISION = { range: 8, halfAngle: Math.PI / 3 };
export const CARRIER_SPEED_MUL = 0.6;
export const PERSONAL_SPACE = 0.45;
export const PICKUP_RANGE = 1.5;

export const KEYMAP = {
  pry: 'Digit1',
  axe: 'Digit2',
  keg: 'Digit3',
  smoke: 'Digit4',
  pause: 'Space',
  cancel: 'Escape',
};

// ---------------------------------------------------------------- math helpers

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

/** Shortest signed difference b - a, in (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotate `cur` toward `target` by at most maxStep radians. */
export function turnToward(cur, target, maxStep) {
  const d = angleDiff(cur, target);
  if (Math.abs(d) <= maxStep) return cur + d;
  return cur + Math.sign(d) * maxStep;
}

export const centerOf = (c, r) => ({ x: c + 0.5, y: r + 0.5 });

export const cellOf = (x, y) => ({ c: Math.floor(x), r: Math.floor(y) });

/** Small deterministic PRNG (mulberry32) so combat rolls repeat for a seed. */
export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
