// src/view.js
// Canvas 2D renderer for the 28 x 17 deck. Flat, readable, no DOM, no assets.
// Everything is painted in cell units inside a letterboxed, centred board transform.
import { COLS, ROWS, TILE, PALETTE, CLASSES, clamp } from './contracts.js';
import { tileAt } from './world.js';

const TAU = Math.PI * 2;
const MARGIN = 6; // css px of water around the board
const MAX_DPR = 2;
const UNIT_R = 0.32;
const VISION_RANGE = 8; // contracts.VISION.range (kept literal: no extra import)
const VISION_HALF = Math.PI / 3;
const SMOKE_RANGE = 6; // contracts.TOOLS.smoke.range
const FACE = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const INK = 'rgba(8, 14, 18, 0.85)';
const GOLD = PALETTE.chest;

// ------------------------------------------------------------------ helpers

function num(obj, keys, dflt = NaN) {
  if (!obj) return dflt;
  for (let i = 0; i < keys.length; i++) {
    const v = obj[keys[i]];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return dflt;
}

function colourOf(unit) {
  const cls = unit && CLASSES ? CLASSES[unit.cls] : null;
  if (cls && cls.colour) return cls.colour;
  return unit && unit.side === 'vikings' ? PALETTE.viking : PALETTE.pirate;
}

function kindOf(e) {
  return String((e && (e.kind || e.type || e.name)) || '').toLowerCase();
}

// Countdown style fx (life drops to 0) and count-up style fx (t rises to duration)
// both resolve to a 0..1 progress with a fair amount of tolerance.
function fxMax(e) {
  return num(e, ['maxLife', 'lifeMax', 'life0', 'duration', 'total', 'max'], NaN);
}

function fxT(e) {
  const max = fxMax(e);
  const life = num(e, ['life', 'ttl', 'remaining'], NaN);
  if (Number.isFinite(max) && max > 0 && Number.isFinite(life)) {
    return clamp(1 - life / max, 0, 1);
  }
  if (Number.isFinite(max) && max > 0) {
    return clamp(num(e, ['age', 't', 'elapsed', 'time'], 0) / max, 0, 1);
  }
  if (Number.isFinite(life)) return clamp(1 - life / 0.6, 0, 1);
  return clamp(num(e, ['age', 't', 'elapsed', 'time'], 0) / 0.6, 0, 1);
}

function fxAlpha(e) {
  const max = fxMax(e);
  const life = num(e, ['life', 'ttl', 'remaining'], NaN);
  if (Number.isFinite(life)) {
    if (Number.isFinite(max) && max > 0) return clamp(life / max, 0, 1);
    return clamp(life / 0.45, 0, 1);
  }
  const age = num(e, ['age', 't', 'elapsed', 'time'], NaN);
  if (Number.isFinite(age)) {
    const d = Number.isFinite(max) && max > 0 ? max : 0.45;
    return clamp(1 - age / d, 0, 1);
  }
  return 1;
}

function fxPoint(e, which) {
  const obj = which === 'from' ? e.from || e.start || e.a : e.to || e.end || e.b;
  if (obj && typeof obj === 'object') {
    const x = num(obj, ['x'], NaN);
    const y = num(obj, ['y'], NaN);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  const x = num(e, which === 'from' ? ['x0', 'sx', 'fromX', 'x'] : ['x1', 'ex', 'toX', 'tx', 'x'], 0);
  const y = num(e, which === 'from' ? ['y0', 'sy', 'fromY', 'y'] : ['y1', 'ey', 'toY', 'ty', 'y'], 0);
  return { x, y };
}

// --------------------------------------------------------------------- view

export function createView(canvas) {
  const ctx = canvas.getContext('2d');

  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let time = 0;
  let waves = [];

  // ------------------------------------------------------------- transform

  function buildWaves() {
    waves = [];
    if (cssW < 8 || cssH < 8) return;
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const count = clamp(Math.round(cssH / 30), 6, 28);
    for (let i = 0; i < count; i++) {
      const band = (i + 0.5) / count;
      const y = 5 + band * (cssH - 10) + (rnd() - 0.5) * 8;
      const w = 22 + rnd() * Math.min(120, cssW * 0.22);
      const x = rnd() * Math.max(1, cssW - w - 8) + 4;
      waves.push({ x, y, w, bend: (rnd() - 0.5) * 5, a: 0.28 + rnd() * 0.42 });
    }
  }

  function resize(w, h, rd) {
    const cw = Math.max(1, Math.round(Number.isFinite(w) && w > 0 ? w : canvas.clientWidth || 640));
    const ch = Math.max(1, Math.round(Number.isFinite(h) && h > 0 ? h : canvas.clientHeight || 420));
    const nd = clamp(Number.isFinite(rd) && rd > 0 ? rd : globalThis.devicePixelRatio || 1, 1, MAX_DPR);
    cssW = cw;
    cssH = ch;
    dpr = nd;
    const bw = Math.max(1, Math.round(cw * nd));
    const bh = Math.max(1, Math.round(ch * nd));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const availW = Math.max(16, cw - MARGIN * 2);
    const availH = Math.max(16, ch - MARGIN * 2);
    scale = Math.max(2, Math.min(availW / COLS, availH / ROWS));
    ox = (cw - scale * COLS) / 2;
    oy = (ch - scale * ROWS) / 2;
    buildWaves();
    return { scale, ox, oy, dpr };
  }

  function toCell(px, py) {
    return { x: (px - ox) / scale, y: (py - oy) / scale };
  }

  function cellAt(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const p = toCell(px, py);
    const c = Math.floor(p.x);
    const r = Math.floor(p.y);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
    return { c, r };
  }

  function unitAt(game, px, py) {
    if (!game || !Array.isArray(game.units) || !Number.isFinite(px) || !Number.isFinite(py)) return null;
    const p = toCell(px, py);
    let bestId = null;
    let bestD = 0.45;
    for (let i = 0; i < game.units.length; i++) {
      const u = game.units[i];
      if (!u || !u.alive) continue;
      const d = Math.hypot((u.x || 0) - p.x, (u.y || 0) - p.y);
      if (d <= bestD) {
        bestD = d;
        bestId = u.id;
      }
    }
    return bestId;
  }

  // ---------------------------------------------------------------- waves

  function drawWaves() {
    if (!waves.length) return;
    ctx.save();
    ctx.strokeStyle = PALETTE.waterLine;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let i = 0; i < waves.length; i++) {
      const wv = waves[i];
      ctx.globalAlpha = wv.a;
      ctx.beginPath();
      ctx.moveTo(wv.x, wv.y);
      ctx.quadraticCurveTo(wv.x + wv.w * 0.5, wv.y + wv.bend, wv.x + wv.w, wv.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- tiles

  function drawHull(c, r) {
    ctx.fillStyle = PALETTE.hull;
    ctx.fillRect(c + 0.06, r + 0.06, 0.88, 0.88);
    ctx.fillStyle = PALETTE.hullEdge;
    ctx.fillRect(c + 0.06, r + 0.06, 0.88, 0.12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(c + 0.06, r + 0.85, 0.88, 0.09);
  }

  function drawDeck(c, r) {
    ctx.fillStyle = (c + r) % 2 === 0 ? PALETTE.deck : PALETTE.deckAlt;
    ctx.fillRect(c, r, 1, 1);
    ctx.globalAlpha = 0.13;
    ctx.strokeStyle = PALETTE.deckLine;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    const off = (c * 5 + r * 3) % 4 === 0 ? 0.5 : 0.32;
    ctx.moveTo(c + 0.04, r + off);
    ctx.lineTo(c + 0.96, r + off);
    ctx.moveTo(c + 0.04, r + 1 - off);
    ctx.lineTo(c + 0.96, r + 1 - off);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawDoor(c, r) {
    ctx.fillStyle = PALETTE.deck;
    ctx.fillRect(c, r, 1, 1);
    ctx.fillStyle = 'rgba(233, 185, 60, 0.18)';
    ctx.fillRect(c + 0.14, r + 0.14, 0.72, 0.72);
    ctx.strokeStyle = PALETTE.door;
    ctx.lineWidth = 0.1;
    ctx.strokeRect(c + 0.14, r + 0.14, 0.72, 0.72);
  }

  function drawPlank(c, r) {
    ctx.fillStyle = PALETTE.plank;
    ctx.fillRect(c + 0.24, r, 0.52, 1);
    ctx.fillStyle = PALETTE.plankEdge;
    ctx.fillRect(c + 0.24, r, 0.08, 1);
    ctx.fillRect(c + 0.68, r, 0.08, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    for (let i = 0; i < 3; i++) ctx.fillRect(c + 0.32, r + 0.16 + i * 0.3, 0.36, 0.045);
  }

  function hatchIsOpen(world, c, r) {
    const list = (world && world.hatches) || null;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h && h.c === c && h.r === r) return h.open === true;
    }
    return false;
  }

  function drawHatch(c, r, units, world) {
    const open = hatchIsOpen(world, c, r);
    if (open) {
      ctx.fillStyle = PALETTE.hatchDark;
      ctx.fillRect(c + 0.06, r + 0.06, 0.88, 0.88);
      ctx.fillStyle = '#f7dc96';
      ctx.fillRect(c + 0.18, r + 0.18, 0.64, 0.64);
      ctx.strokeStyle = PALETTE.door;
      ctx.lineWidth = 0.08;
      ctx.strokeRect(c + 0.06, r + 0.06, 0.88, 0.88);
    } else {
      ctx.fillStyle = PALETTE.hatch;
      ctx.fillRect(c + 0.06, r + 0.06, 0.88, 0.88);
      ctx.fillStyle = PALETTE.hatchDark;
      ctx.fillRect(c + 0.12, r + 0.3, 0.76, 0.11);
      ctx.fillRect(c + 0.12, r + 0.59, 0.76, 0.11);
    }
    let breach = null;
    for (let i = 0; i < units.length; i++) {
      const b = units[i] && units[i].breach;
      if (b && b.c === c && b.r === r) {
        breach = b;
        break;
      }
    }
    if (!breach) return;
    const dur = Math.max(0.001, num(breach, ['duration'], 3));
    const p = clamp(num(breach, ['progress'], 0) / dur, 0, 1);
    ctx.beginPath();
    ctx.arc(c + 0.5, r + 0.5, 0.44, -Math.PI / 2, -Math.PI / 2 + p * TAU);
    ctx.strokeStyle = open ? '#ffe9a8' : GOLD;
    ctx.lineWidth = 0.13;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }

  function drawTiles(game) {
    const world = game.world;
    const units = Array.isArray(game.units) ? game.units : [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = tileAt(world, c, r);
        if (t === TILE.HULL) drawHull(c, r);
        else if (t === TILE.DECK) drawDeck(c, r);
        else if (t === TILE.DOOR) drawDoor(c, r);
        else if (t === TILE.PLANK) drawPlank(c, r);
        else if (t === TILE.HATCH) drawHatch(c, r, units, world);
        // TILE.WATER: the water base and wave strokes show through
      }
    }
  }

  // --------------------------------------------------------------- chests

  function drawChestBox(cx, cy, size, alpha, mini) {
    const w = size;
    const h = size * 0.78;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.fillStyle = GOLD;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    if (!mini) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.05;
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      ctx.fillStyle = PALETTE.chestDark;
      ctx.fillRect(cx - w / 2, cy - h * 0.18, w, 0.07);
      ctx.beginPath();
      ctx.arc(cx, cy + h * 0.16, Math.min(0.07, w * 0.14), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawChests(game) {
    const chests = game.chests;
    if (!chests) return;
    const units = Array.isArray(game.units) ? game.units : [];
    const sides = ['pirates', 'vikings'];
    for (let s = 0; s < sides.length; s++) {
      const ch = chests[sides[s]];
      if (!ch) continue;
      const state = ch.state || 'home';
      if (state === 'carried') {
        let carrier = null;
        for (let i = 0; i < units.length; i++) {
          if (units[i] && units[i].id === ch.carrier && units[i].alive) carrier = units[i];
        }
        if (carrier) drawChestBox(carrier.x, carrier.y - UNIT_R - 0.18, 0.34, 1, true);
        continue;
      }
      const c = num(ch, ['c'], NaN);
      const r = num(ch, ['r'], NaN);
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      if (state === 'dropped') {
        ctx.fillStyle = 'rgba(10, 20, 26, 0.28)';
        ctx.beginPath();
        ctx.arc(c + 0.5, r + 0.5, 0.46, 0, TAU);
        ctx.fill();
      }
      drawChestBox(c + 0.5, r + 0.5, 0.56, state === 'dropped' ? 0.92 : 1, false);
    }
  }

  // ---------------------------------------------------------------- units

  function drawUnit(game, u) {
    const x = num(u, ['x'], 0.5);
    const y = num(u, ['y'], 0.5);
    const R = UNIT_R;
    const col = colourOf(u);
    const stun = num(u, ['stun'], 0);
    const selected = game.selected != null && game.selected === u.id;

    // thin red ring while alert
    if (u.alert) {
      ctx.beginPath();
      ctx.arc(x, y, R + 0.06, 0, TAU);
      ctx.strokeStyle = 'rgba(224, 87, 74, 0.8)';
      ctx.lineWidth = 0.035;
      ctx.stroke();
    }

    // gold selection ring, gently pulsing
    if (selected) {
      const pulse = 0.62 + 0.38 * Math.sin(time * 5);
      ctx.beginPath();
      ctx.arc(x, y, R + 0.14, 0, TAU);
      ctx.strokeStyle = GOLD;
      ctx.globalAlpha = 0.55 + 0.4 * pulse;
      ctx.lineWidth = 0.07;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // stun ring
    if (stun > 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * 2.4);
      ctx.strokeStyle = 'rgba(206, 228, 252, 0.9)';
      ctx.lineWidth = 0.05;
      ctx.setLineDash([0.12, 0.1]);
      ctx.beginPath();
      ctx.arc(0, 0, R + 0.28, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // body
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.055;
    ctx.stroke();

    // side marker
    if (u.side === 'vikings') {
      ctx.beginPath();
      ctx.arc(x, y, 0.17, 0, TAU);
      ctx.strokeStyle = 'rgba(238, 246, 250, 0.78)';
      ctx.lineWidth = 0.045;
      ctx.stroke();
    } else {
      const tab = 0.09;
      ctx.fillStyle = 'rgba(12, 18, 22, 0.82)';
      ctx.fillRect(x - tab / 2, y - R - tab * 0.85, tab, tab);
      ctx.fillRect(x - tab / 2, y + R - tab * 0.15, tab, tab);
      ctx.fillRect(x - R - tab * 0.85, y - tab / 2, tab, tab);
      ctx.fillRect(x + R - tab * 0.15, y - tab / 2, tab, tab);
    }

    // facing wedge
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(num(u, ['facing'], 0));
    ctx.beginPath();
    ctx.moveTo(R + 0.04, 0);
    ctx.lineTo(R - 0.17, -0.15);
    ctx.lineTo(R - 0.17, 0.15);
    ctx.closePath();
    ctx.fillStyle = 'rgba(250, 244, 228, 0.94)';
    ctx.fill();
    ctx.restore();

    // hp pips
    const n = Math.max(1, Math.round(num(u, ['maxHp'], 1)));
    const hp = Math.max(0, Math.round(num(u, ['hp'], 1)));
    const pw = 0.11;
    const gap = 0.05;
    const total = n * pw + (n - 1) * gap;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i < hp ? PALETTE.good : 'rgba(10, 18, 22, 0.8)';
      ctx.fillRect(x - total / 2 + i * (pw + gap), y + R + 0.09, pw, 0.055);
    }

    // chest carried marker
    if (u.carrying) {
      ctx.fillStyle = GOLD;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.04;
      ctx.fillRect(x - 0.08, y - R - 0.22, 0.16, 0.16);
      ctx.strokeRect(x - 0.08, y - R - 0.22, 0.16, 0.16);
    }
  }

  function drawUnits(game) {
    const units = Array.isArray(game.units) ? game.units : [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u && u.alive) drawUnit(game, u);
    }
  }

  // ---------------------------------------------------------------- smoke

  function drawSmoke(game) {
    const list = Array.isArray(game.smokes) ? game.smokes : [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s) continue;
      const r = Math.max(0.4, num(s, ['radius'], 2.4));
      const life = num(s, ['life'], 1);
      const a = clamp(life / 1.4, 0, 1) * 0.3;
      if (a <= 0.004) continue;
      ctx.fillStyle = PALETTE.smoke;
      for (let k = 0; k < 3; k++) {
        const dx = (k - 1) * r * 0.3;
        const dy = (k % 2 === 0 ? -1 : 1) * r * 0.12;
        ctx.globalAlpha = a * (0.62 + 0.16 * k);
        ctx.beginPath();
        ctx.arc(num(s, ['x'], 0) + dx, num(s, ['y'], 0) + dy, r * (0.6 + 0.09 * k), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------- fx

  function drawFloatText(e, kind, label, a) {
    const p = fxT(e);
    const x = num(e, ['x', 'cx'], 0);
    const y = num(e, ['y', 'cy'], 0) - 0.42 - p * 0.5;
    let text = typeof label === 'string' ? label : '';
    if (!text) text = /miss/.test(kind) ? 'MISS' : /kill|down/.test(kind) ? 'DOWN' : 'HIT';
    const col = /miss/.test(kind) ? PALETTE.dim : /kill|down/.test(kind) ? PALETTE.bad : PALETTE.text;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = `700 0.42px ${FACE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 0.11;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6, 12, 16, 0.9)';
    ctx.strokeText(text, x, y, 2.6);
    ctx.fillStyle = col;
    ctx.fillText(text, x, y, 2.6);
    ctx.restore();
  }

  function drawTracer(e, a) {
    const p0 = fxPoint(e, 'from');
    const p1 = fxPoint(e, 'to');
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.strokeStyle = '#ffe7ae';
    ctx.lineWidth = 0.06;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p0.x, p0.y, 0.1, 0, TAU);
    ctx.fillStyle = PALETTE.blast;
    ctx.fill();
    ctx.restore();
  }

  function drawBlast(e, a) {
    const x = num(e, ['x', 'cx'], 0);
    const y = num(e, ['y', 'cy'], 0);
    const r = Math.max(0.4, num(e, ['radius', 'blastRadius', 'r'], 2));
    const p = fxT(e);
    const rr = r * (0.32 + 0.68 * p);
    ctx.save();
    ctx.globalAlpha = clamp(a * 0.45, 0, 1);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.fillStyle = PALETTE.blast;
    ctx.fill();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.lineWidth = 0.09;
    ctx.strokeStyle = PALETTE.blast;
    ctx.stroke();
    ctx.restore();
  }

  function drawFlash(e, a) {
    const x = num(e, ['x', 'cx'], 0);
    const y = num(e, ['y', 'cy'], 0);
    const r = Math.max(0.05, num(e, ['radius', 'r'], 0.14));
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = PALETTE.blast;
    ctx.fill();
    ctx.restore();
  }

  function drawFx(game) {
    const fx = game.fx;
    if (!Array.isArray(fx) || !fx.length) return;
    const start = Math.max(0, fx.length - 240);
    for (let i = start; i < fx.length; i++) {
      const e = fx[i];
      if (!e) continue;
      const a = fxAlpha(e);
      if (a <= 0.01) continue;
      const kind = kindOf(e);
      const label = e.text != null ? e.text : e.label != null ? e.label : e.msg;
      if (typeof label === 'string' || /text|float|hit|miss|kill|down/.test(kind)) {
        drawFloatText(e, kind, label, a);
      } else if (/blast|explo|keg/.test(kind)) {
        drawBlast(e, a);
      } else if (/shot|tracer|line|bullet/.test(kind)) {
        drawTracer(e, a);
      } else {
        drawFlash(e, a);
      }
    }
  }

  // -------------------------------------------------------------- overlay

  function drawOverlay(game) {
    const units = Array.isArray(game.units) ? game.units : [];
    let sel = null;
    for (let i = 0; i < units.length; i++) {
      if (units[i] && units[i].alive && game.selected != null && units[i].id === game.selected) sel = units[i];
    }

    if (sel) {
      const x = num(sel, ['x'], 0.5);
      const y = num(sel, ['y'], 0.5);
      const facing = num(sel, ['facing'], 0);

      // faint vision cone
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.translate(x, y);
      ctx.rotate(facing);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, VISION_RANGE, -VISION_HALF, VISION_HALF);
      ctx.closePath();
      ctx.fillStyle = PALETTE.text;
      ctx.fill();
      ctx.restore();

      // remaining path dots
      const path = Array.isArray(sel.path) ? sel.path : [];
      if (path.length) {
        ctx.fillStyle = 'rgba(242, 231, 213, 0.7)';
        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.c + 0.5, p.r + 0.5, 0.07, 0, TAU);
          ctx.fill();
        }
      }

      // smoke aiming
      if (game.aimMode === 'smoke') {
        ctx.save();
        ctx.strokeStyle = 'rgba(242, 193, 78, 0.55)';
        ctx.lineWidth = 0.05;
        ctx.setLineDash([0.22, 0.16]);
        ctx.beginPath();
        ctx.arc(x, y, SMOKE_RANGE, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    const aim = game.aimCell;
    if (game.aimMode === 'smoke' && aim) {
      ctx.fillStyle = 'rgba(242, 193, 78, 0.22)';
      ctx.fillRect(aim.c, aim.r, 1, 1);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 0.07;
      ctx.strokeRect(aim.c + 0.03, aim.r + 0.03, 0.94, 0.94);
    }

    // hovered unit outline
    let hov = null;
    for (let i = 0; i < units.length; i++) {
      if (units[i] && units[i].alive && game.hoverId != null && units[i].id === game.hoverId) hov = units[i];
    }
    if (hov) {
      ctx.save();
      ctx.strokeStyle = 'rgba(244, 250, 252, 0.9)';
      ctx.lineWidth = 0.045;
      ctx.setLineDash([0.12, 0.1]);
      ctx.beginPath();
      ctx.arc(num(hov, ['x'], 0.5), num(hov, ['y'], 0.5), UNIT_R + 0.2, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // ----------------------------------------------------------------- draw

  function draw(game, dt) {
    time += clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    if (cssW < 1 || cssH < 1) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(0, 0, cssW, cssH);
    drawWaves();

    if (!game || !game.world) return;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    ctx.lineWidth = 0.05;
    ctx.font = `600 0.36px ${FACE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    drawTiles(game);
    drawChests(game);
    drawUnits(game);
    drawSmoke(game);
    drawFx(game);
    drawOverlay(game);

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }

  return { resize, draw, cellAt, unitAt };
}
