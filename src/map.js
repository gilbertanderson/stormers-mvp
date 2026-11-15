// The Two Ships — deck plan, roster and palette.
//
// Ported cell for cell from the Unity game, so the browser build plays the same map, from the
// same spawns, with the same numbers:
//   Assets/HullRaiders/Scripts/HullRaidersLevels.cs   (TheTwoShips)
//   Assets/HullRaiders/Scripts/HullRaidersClasses.cs  (the four role slots, both sides)
//
// Map key:  # hull   . deck   D hatch   ~ water
//           $ your chest (Pirates)      % the other crew's chest (Vikings)
//           p q c k pirates, S X Y R vikings

const Sea = (n) => '~'.repeat(n);
const Deck = (n) => '.'.repeat(n);
const Wall = (n) => '#'.repeat(n);

// 2 of sea, the port hull (18), the channel (4), the starboard hull (18), 2 of sea.
// A plank row lays deck across both hull walls and the channel: three ways across.
const Row = (port, starboard, plank) =>
  '~~' + port + (plank ? '....' : Sea(4)) + starboard + '~~';

export const MAP = {
  title: 'The Two Ships',
  subtitle: 'Stormers: Hull Raiders — Destroyer vs Cruiser',
  objective: "Carry the other crew's chest back to your own, or leave none of them standing.",
  squadName: 'Pirates',
  hostileName: 'Vikings',
  winText: 'SHIP TAKEN',
  loseText: 'RAID FAILED',
  // Off straight-down, so bulkheads and figures read as solids.
  cameraTilt: 22,
  rows: [
    Row(Sea(7) + Wall(4) + Sea(7), Sea(7) + Wall(4) + Sea(7), false), // bow tips
    Row(Sea(5) + '#' + Deck(6) + '#' + Sea(5), Sea(5) + '#' + Deck(6) + '#' + Sea(5), false),
    Row(Sea(3) + '#' + Deck(10) + '#' + Sea(3), Sea(3) + '#' + Deck(10) + '#' + Sea(3), false),
    Row(Sea(2) + '#' + Deck(12) + '#' + Sea(2), Sea(2) + '#' + Deck(12) + '#' + Sea(2), false),
    Row(Sea(1) + '#' + Deck(14) + '#' + Sea(1), Sea(1) + '#' + Deck(14) + '#' + Sea(1), false),
    Row('#' + Deck(16) + '#', '#' + Deck(16) + '#', false),
    Row('#' + Deck(4) + 'k' + Deck(11) + '.', '.' + Deck(16) + '#', true), // fore cabins, bow plank
    Row('#' + Deck(16) + '#', '#' + Deck(16) + '#', false),
    Row('#' + Wall(7) + 'D' + Wall(8) + '#', '#' + Wall(7) + 'D' + Wall(8) + '#', false), // fore hatches
    Row('#' + Deck(16) + '#', '#' + Deck(16) + '#', false),
    Row('#' + Deck(3) + 'q' + Deck(12) + '.', '.' + Deck(3) + 'S' + Deck(12) + '#', true), // waist plank
    Row('#' + Deck(16) + '#', '#' + Deck(16) + '#', false),
    Row('#' + Deck(11) + 'c' + Deck(4) + '#', '#' + Deck(11) + 'Y' + Deck(4) + '#', false),
    Row('#' + Deck(16) + '.', '.' + Deck(7) + 'X' + Deck(8) + '#', true), // aft plank
    Row(Sea(1) + '#' + Deck(14) + '#' + Sea(1), Sea(1) + '#' + Deck(14) + '#' + Sea(1), false),
    Row(Sea(1) + '#' + Wall(6) + 'D' + Wall(7) + '#' + Sea(1),
      Sea(1) + '#' + Wall(6) + 'D' + Wall(7) + '#' + Sea(1), false), // aft cabin hatches
    Row(Sea(2) + '#' + Deck(12) + '#' + Sea(2), Sea(2) + '#' + Deck(12) + '#' + Sea(2), false),
    Row(Sea(3) + '#' + Deck(10) + '#' + Sea(3), Sea(3) + '#' + Deck(10) + '#' + Sea(3), false),
    Row(Sea(4) + '#' + Deck(3) + 'p' + Deck(4) + '#' + Sea(4),
      Sea(4) + '#' + Deck(3) + 'R' + Deck(4) + '#' + Sea(4), false),
    Row(Sea(5) + '#' + Deck(2) + '$' + Deck(3) + '#' + Sea(5),
      Sea(5) + '#' + Deck(2) + '%' + Deck(3) + '#' + Sea(5), false),
    Row(Sea(6) + '#' + Deck(4) + '#' + Sea(6), Sea(6) + '#' + Deck(4) + '#' + Sea(6), false),
    Row(Sea(7) + Wall(4) + Sea(7), Sea(7) + Wall(4) + Sea(7), false), // transoms
  ],
};

// The mission's own colours, as authored on the definition (0-1 floats -> hex).
export const COLORS = {
  background: 0x0d2940, // 0.05, 0.16, 0.25
  water: 0x123d5c, // 0.07, 0.24, 0.36
  deck: 0xa8804f, // 0.66, 0.50, 0.32
  plank: 0xc09763,
  wall: 0x543621, // 0.33, 0.21, 0.13
  hatch: 0xe6ad3d, // 0.90, 0.68, 0.24
  squadChest: 0xf0c04a,
  hostileChest: 0xa9d4ff,
  squad: 0x6fe8c4,
  hostile: 0xff7a6b,
  fog: 0x040d16,
};

// Four role slots, each with a block per side. Names and colours are theme; the numbers are
// the mechanics and are the title's first pass, meant to be tuned by playing.
export const CLASSES = {
  pistoleer: {
    name: 'Pistoleer', slot: 'Ranger', color: 0xe64d40,
    hp: 1, move: 2.4, reaction: 0.6, range: 7, interval: 2.6,
    accuracy: 0.9, accuracyMax: 0.4, loud: true, noise: 8,
    view: 9, viewAngle: 110,
  },
  cutlass: {
    name: 'Cutlass', slot: 'Bruiser', color: 0xf28c33,
    hp: 1, move: 2.7, reaction: 0.5, range: 0.95, interval: 0.7,
    view: 9, viewAngle: 110,
  },
  spearman: {
    name: 'Spearman', slot: 'Guard', color: 0x73ccb3,
    hp: 2, move: 2.4, reaction: 0.4, range: 1.6, interval: 0.85,
    block: 0.35, view: 9, viewAngle: 110,
  },
  archer: {
    name: 'Archer', slot: 'Ranger', color: 0xf2d959,
    hp: 1, move: 2.6, reaction: 0.4, range: 8, interval: 1.4,
    accuracy: 0.9, accuracyMax: 0.5, view: 9, viewAngle: 110,
  },
  axeman: {
    name: 'Axeman', slot: 'Bruiser', color: 0x4dd98c,
    hp: 1, move: 3.0, reaction: 0.25, range: 0.95, interval: 0.6,
    charge: 4.5, view: 9, viewAngle: 110,
  },
};

const FACE = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// Who starts where, and which way they are looking. The chest guards face the hatch behind
// them, so a chest cannot be walked off for free.
export const SPAWNS = {
  p: { team: 'squad', cls: 'pistoleer', face: FACE.up },
  q: { team: 'squad', cls: 'pistoleer', face: FACE.down },
  c: { team: 'squad', cls: 'cutlass', face: FACE.down },
  k: { team: 'squad', cls: 'cutlass', face: FACE.down },
  S: { team: 'hostile', cls: 'spearman', face: FACE.up },
  X: { team: 'hostile', cls: 'axeman', face: FACE.up },
  Y: { team: 'hostile', cls: 'axeman', face: FACE.up },
  R: { team: 'hostile', cls: 'archer', face: FACE.up },
};

export const CHESTS = { $: 'squad', '%': 'hostile' };

const DECK_CHARS = new Set(['.', 'D']);

/// Turns the ASCII rows into cells the game can ask questions of.
export function parseMap(map = MAP) {
  const rows = map.rows.length;
  const cols = map.rows[0].length;
  map.rows.forEach((row, i) => {
    if (row.length !== cols) {
      throw new Error(`map row ${i} is ${row.length} cells wide, expected ${cols}`);
    }
  });

  const chars = map.rows.map((row) => row.split(''));
  const spawns = [];
  const chests = [];

  const at = (x, y) =>
    x < 0 || y < 0 || x >= cols || y >= rows ? '~' : chars[y][x];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = chars[y][x];
      if (SPAWNS[ch]) {
        spawns.push({ x, y, ...SPAWNS[ch], face: { ...SPAWNS[ch].face } });
      }
      if (CHESTS[ch]) {
        chests.push({ x, y, team: CHESTS[ch] });
      }
    }
  }

  // The channel between the hulls is columns 20-23. Where a plank row lays deck across it,
  // those cells are the boarding planks.
  const isPlank = (x, y) => x >= 20 && x <= 23 && at(x, y) === '.';

  return {
    cols,
    rows,
    at,
    spawns,
    chests,
    walkable: (x, y) => {
      const ch = at(x, y);
      return DECK_CHARS.has(ch) || ch === '$' || ch === '%' || Boolean(SPAWNS[ch]);
    },
    // Walls stop a line of sight; the map edge is open water, which does not.
    blocksSight: (x, y) => at(x, y) === '#',
    isPlank,
    surface: (x, y) => {
      const ch = at(x, y);
      if (ch === '#') return 'wall';
      if (ch === 'D') return 'hatch';
      if (!(DECK_CHARS.has(ch) || ch === '$' || ch === '%' || SPAWNS[ch])) return 'water';
      return isPlank(x, y) ? 'plank' : 'deck';
    },
  };
}
