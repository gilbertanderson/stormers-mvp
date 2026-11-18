// src/hud.js
// All DOM chrome for "The Two Ships": top bar, side column, bottom abilities + log
// and the end-of-raid overlay. update(game) only rewrites values and classes.

import { PALETTE, CLASSES, TOOLS, KEYMAP } from './contracts.js';

const SIDES = ['vikings', 'pirates'];
const SIDE_LABEL = { vikings: 'Vikings', pirates: 'Pirates' };
const ABILITIES = ['pry', 'axe', 'keg', 'smoke'];

// label/value rows of the SELECTED card, in display order.
const STAT_ROWS = [
  ['health', 'Health'],
  ['moveSpeed', 'Move speed'],
  ['turnSpeed', 'Turn speed'],
  ['reaction', 'Reaction'],
  ['attack', 'Attack'],
  ['attackRange', 'Attack range'],
  ['attackInterval', 'Attack interval'],
  ['accuracy', 'Accuracy'],
  ['accuracyAtMax', 'Acc. at max range'],
  ['chargeRange', 'Charge range'],
  ['block', 'Frontal block'],
];

const KIND_CLASS = {
  noise: 'k-noise',
  kill: 'k-kill',
  breach: 'k-breach',
  chest: 'k-chest',
  end: 'k-end',
  info: 'k-info',
};

const THEME = {
  '--water': PALETTE.water,
  '--deck': PALETTE.deck,
  '--text': PALETTE.text,
  '--dim': PALETTE.dim,
  '--panel': PALETTE.panel,
  '--panel-edge': PALETTE.panelEdge,
  '--good': PALETTE.good,
  '--bad': PALETTE.bad,
  '--chest': PALETTE.chest,
  '--viking': PALETTE.viking,
  '--pirate': PALETTE.pirate,
};

const trim2 = (v) => String(Math.round(Number(v) * 100) / 100);
const n1 = (v) => (Math.round(Number(v) * 10) / 10).toFixed(1);
const pct = (v) => Math.round(Number(v) * 100) + '%';

function keyLabel(name) {
  const tool = TOOLS[name] || {};
  if (tool.keycap) return String(tool.keycap);
  const code = KEYMAP[name] || '';
  return code.replace(/^Digit/, '').replace(/^Key/, '');
}

export function createHud(root, callbacks = {}) {
  const cb = callbacks || {};
  const doc = root && root.nodeType === 9 ? root : (root && root.ownerDocument) || globalThis.document;
  const appEl = (root && root.nodeType === 1 ? root : null) || doc.getElementById('app');
  const topEl = doc.getElementById('top');
  const sideEl = doc.getElementById('side');
  const bottomEl = doc.getElementById('bottom');
  const overlayEl = doc.getElementById('overlay');

  const mounted = [];

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function button(cls, text, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function mount(host, ...nodes) {
    if (!host) return;
    for (const n of nodes) {
      host.append(n);
      mounted.push(n);
    }
  }

  function setText(node, value) {
    if (!node) return;
    const v = value == null ? '' : String(value);
    if (node.__t !== v) {
      node.__t = v;
      node.textContent = v;
    }
  }

  function setClass(node, cls, on) {
    if (node) node.classList.toggle(cls, !!on);
  }

  function setAttr(node, name, value) {
    if (!node) return;
    const key = '__a' + name;
    if (node[key] === value) return;
    node[key] = value;
    if (value == null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }

  function renderPips(host, hp, maxHp) {
    if (!host) return;
    const max = Math.max(0, Math.round(maxHp) || 0);
    const cur = Math.max(0, Math.round(hp) || 0);
    const key = max + ':' + cur;
    if (host.__k === key) return;
    host.__k = key;
    if (host.__max !== max) {
      host.__max = max;
      host.replaceChildren();
      for (let i = 0; i < max; i++) host.append(el('i', 'pip'));
    }
    const kids = host.children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < cur);
  }

  if (appEl && appEl.style) {
    for (const k in THEME) appEl.style.setProperty(k, THEME[k]);
  }

  // ------------------------------------------------------------------- top
  let sideBtns = {};
  let pauseBtn = null;
  let tallyNums = {};

  if (topEl) {
    const brand = el('div', 'brand');
    brand.append(
      el('h1', 'title', 'THE TWO SHIPS'),
      el('p', 'subtitle', 'Click a raider, click the deck to move - 1-4 PRY/AXE/KEG/SMOKE - Space pauses'),
    );

    const controls = el('div', 'top-controls');

    const toggle = el('div', 'side-toggle');
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Choose side');
    for (const side of SIDES) {
      const b = button('side-btn ' + side, side.toUpperCase(), () => cb.onSide && cb.onSide(side));
      b.title = 'Play as the ' + SIDE_LABEL[side];
      sideBtns[side] = b;
      toggle.append(b);
    }

    pauseBtn = button('btn', 'Pause', () => cb.onPause && cb.onPause());
    pauseBtn.title = 'Pause / resume (Space)';
    const restartBtn = button('btn', 'Restart', () => cb.onRestart && cb.onRestart());
    restartBtn.title = 'Start the raid again';

    const tally = el('div', 'tally');
    for (const side of SIDES) {
      const wrap = el('span', 'tally-side ' + side);
      wrap.append(el('span', 'dot ' + side));
      wrap.append(el('span', 'tally-label', SIDE_LABEL[side].toUpperCase()));
      const num = el('b', 'tally-num', '0');
      wrap.append(num);
      tallyNums[side] = num;
      tally.append(wrap);
    }

    controls.append(toggle, pauseBtn, restartBtn, tally);
    mount(topEl, brand, controls);
  }

  // ------------------------------------------------------------------ side
  let selName = null;
  let selSide = null;
  let selSwatch = null;
  let selPips = null;
  const statNodes = {};
  const kitNodes = {};
  const unitRows = new Map(); // unitId -> { row, pips, tag, name }
  const squadHosts = {};

  if (sideEl) {
    // --- SELECTED card
    const card = el('section', 'card sel-card');
    const head = el('div', 'sel-head');
    selSwatch = el('span', 'swatch');
    const titles = el('div', 'sel-titles');
    selName = el('span', 'sel-name', 'No unit selected');
    selSide = el('span', 'sel-side', 'click one of your crew');
    titles.append(selName, selSide);
    head.append(selSwatch, titles);

    selPips = el('div', 'pips sel-pips');

    const list = el('div', 'stat-list');
    for (const [key, label] of STAT_ROWS) {
      const row = el('div', 'stat-row');
      const lab = el('span', 'stat-label', label);
      const val = el('span', 'stat-value', '-');
      row.append(lab, val);
      list.append(row);
      statNodes[key] = { row, val, label };
    }

    const kitLine = el('div', 'kit-line');
    for (const name of ABILITIES) {
      const item = el('span', 'kit-item');
      const nm = el('span', 'ki-name', TOOLS[name] ? TOOLS[name].label : name.toUpperCase());
      const vl = el('span', 'ki-val', '');
      item.append(nm, vl);
      kitLine.append(item);
      kitNodes[name] = { item, val: vl };
    }

    card.append(head, selPips, list, kitLine);

    // --- squads
    const squads = el('section', 'card squads-card');
    squads.append(el('h2', 'card-title', 'CREW'));
    for (const side of SIDES) {
      const group = el('div', 'squad-group');
      const gh = el('div', 'squad-head');
      gh.append(el('span', 'dot ' + side), el('span', null, SIDE_LABEL[side].toUpperCase()));
      const rows = el('div', 'squad-rows');
      group.append(gh, rows);
      squads.append(group);
      squadHosts[side] = rows;
    }

    // --- raid kit legend
    const legend = el('section', 'card legend-card');
    legend.append(el('h2', 'card-title', 'RAID KIT'));
    const legendRows = el('div', 'legend-rows');
    const legendSpec = [
      ['pry', TOOLS.pry.duration + ' s - silent'],
      ['axe', TOOLS.axe.duration + ' s - noise ' + TOOLS.axe.noise],
      ['keg', 'fuse ' + TOOLS.keg.fuse + ' s - noise ' + TOOLS.keg.noise],
      ['smoke', 'range ' + TOOLS.smoke.range + ' - stun ' + TOOLS.smoke.stun + ' s'],
    ];
    for (const [name, text] of legendSpec) {
      const row = el('div', 'legend-row');
      row.append(el('b', null, TOOLS[name] ? TOOLS[name].label : name.toUpperCase()), el('span', null, text));
      legendRows.append(row);
    }
    legend.append(legendRows);

    mount(sideEl, card, squads, legend);
  }

  // ---------------------------------------------------------------- bottom
  const abilityBtns = {};
  let logEl = null;
  let logSig = '';

  if (bottomEl) {
    const abilities = el('div', 'abilities');
    for (const name of ABILITIES) {
      const tool = TOOLS[name] || {};
      const b = button('ability', null, () => {
        if (b.disabled) return;
        if (cb.onAbility) cb.onAbility(name);
      });
      b.append(el('span', 'ab-label', tool.label || name.toUpperCase()));
      b.append(el('kbd', 'ab-key', keyLabel(name)));
      b.title = tool.hint || tool.label || name;
      abilityBtns[name] = b;
      abilities.append(b);
    }

    const wrap = el('div', 'log-wrap');
    wrap.append(el('div', 'log-head', 'EVENT LOG'));
    logEl = el('div', 'log');
    wrap.append(logEl);

    mount(bottomEl, abilities, wrap);
  }

  // --------------------------------------------------------------- overlay
  let overCard = null;
  let overTitle = null;
  let overSub = null;

  if (overlayEl) {
    overCard = el('div', 'overlay-card');
    overTitle = el('div', 'over-title', 'SHIP TAKEN');
    overSub = el('div', 'over-sub', '');
    const again = button('over-btn', 'PLAY AGAIN', () => cb.onRestart && cb.onRestart());
    overCard.append(overTitle, overSub, again);
    overlayEl.classList.add('hidden');
    mount(overlayEl, overCard);
  }

  // ---------------------------------------------------------------- runtime
  let current = null;

  function livingCount(units, side) {
    let n = 0;
    for (const u of units) if (u.side === side && u.alive !== false) n++;
    return n;
  }

  function hatchNear(unit, hatches) {
    if (!unit || !hatches || !hatches.length) return false;
    for (const h of hatches) {
      if (!h || h.open) continue;
      const dx = h.c + 0.5 - unit.x;
      const dy = h.r + 0.5 - unit.y;
      if (Math.hypot(dx, dy) <= 1.5) return true;
    }
    return false;
  }

  function abilityState(name, unit, game, hatches) {
    if (!unit || unit.alive === false) return { ok: false, why: 'select one of your crew' };
    if (unit.side !== game.side) return { ok: false, why: 'not your crew' };
    const cls = CLASSES[unit.cls] || {};
    const charges = unit.charges || {};
    const near = hatchNear(unit, hatches);
    if (name === 'pry' || name === 'axe') {
      return near ? { ok: true, why: 'breach the hatch beside you' } : { ok: false, why: 'no closed hatch in reach' };
    }
    if (name === 'keg') {
      if (!(Number(charges.keg) > 0)) return { ok: false, why: 'no keg left' };
      return near ? { ok: true, why: 'blow the hatch beside you' } : { ok: false, why: 'no closed hatch in reach' };
    }
    if (name === 'smoke') {
      if (!(Number(cls.throwables) > 0)) return { ok: false, why: 'not a thrower' };
      if (!(Number(charges.smoke) > 0)) return { ok: false, why: 'no smoke left' };
      return { ok: true, why: 'throw smoke up to ' + TOOLS.smoke.range + ' cells' };
    }
    return { ok: false, why: '' };
  }

  function unitRow(unit) {
    let rec = unitRows.get(unit.id);
    if (rec) return rec;
    const cls = CLASSES[unit.cls] || {};
    const row = el('div', 'unit-row');
    row.dataset.unit = unit.id;
    const dot = el('span', 'dot');
    dot.style.background = cls.colour || PALETTE.dim;
    const name = el('span', 'u-name', unit.name || cls.name || unit.cls || 'crew');
    const pips = el('span', 'pips u-pips');
    const tag = el('span', 'u-tag', '');
    row.append(dot, name, pips, tag);
    row.addEventListener('click', () => {
      const g = current;
      if (!g || !Array.isArray(g.units)) return;
      let live = null;
      for (const u of g.units) if (u && u.id === unit.id) live = u;
      if (live && live.side === g.side && cb.onSelect) cb.onSelect(unit.id);
    });
    row.addEventListener('mouseenter', () => {
      if (cb.onHover) cb.onHover(unit.id);
    });
    row.addEventListener('mouseleave', () => {
      if (cb.onHover) cb.onHover(null);
    });
    const host = squadHosts[unit.side] || squadHosts.vikings;
    if (host) host.append(row);
    rec = { row, pips, tag, name, dot };
    unitRows.set(unit.id, rec);
    return rec;
  }

  function renderLog(list) {
    if (!logEl || !Array.isArray(list)) return;
    const start = Math.max(0, list.length - 8);
    let sig = list.length + ':';
    for (let i = start; i < list.length; i++) {
      const e = list[i] || {};
      sig += (e.kind || '') + '|' + (Number(e.t) || 0) + '|' + (e.text || '') + '\n';
    }
    if (sig === logSig) return;
    logSig = sig;
    logEl.replaceChildren();
    for (let i = start; i < list.length; i++) {
      const e = list[i] || {};
      const row = el('div', 'log-row ' + (KIND_CLASS[e.kind] || 'k-info'));
      row.append(el('span', 'log-t', isFinite(Number(e.t)) ? Number(e.t).toFixed(1) + 's' : ''));
      row.append(el('span', 'log-x', e.text == null ? '' : String(e.text)));
      logEl.append(row);
    }
  }

  function contextLine(game, units) {
    const mine = game.side === 'pirates' ? 'pirates' : 'vikings';
    const foe = mine === 'vikings' ? 'pirates' : 'vikings';
    const foeWord = SIDE_LABEL[foe].toLowerCase();
    if (game.phase === 'won') {
      if (livingCount(units, foe) === 0) return 'No ' + foeWord + ' left standing.';
      return 'The ' + foeWord + "' chest is home in your hold.";
    }
    if (livingCount(units, mine) === 0) return 'Your crew fell to the last. ' + SIDE_LABEL[foe] + ' hold their ship.';
    return 'The ' + foeWord + ' crew carried your chest back to their own.';
  }

  function update(game) {
    if (!game) return;
    current = game;
    const units = Array.isArray(game.units) ? game.units : [];
    const byId = new Map();
    for (const u of units) {
      if (!u || u.id == null) continue;
      byId.set(u.id, u);
    }

    const hatches = (game.world && game.world.hatches) || game.hatches || [];

    // ---- top bar
    for (const side of SIDES) {
      const b = sideBtns[side];
      if (!b) continue;
      const on = game.side === side;
      setClass(b, 'active', on);
      setAttr(b, 'aria-pressed', on ? 'true' : 'false');
    }
    if (pauseBtn) {
      setText(pauseBtn, game.paused ? 'Resume' : 'Pause');
      setClass(pauseBtn, 'is-active', !!game.paused);
    }
    for (const side of SIDES) setText(tallyNums[side], livingCount(units, side));

    // ---- selected / hovered unit
    let sel = null;
    if (game.hoverId != null && byId.has(game.hoverId)) sel = byId.get(game.hoverId);
    else if (game.selected != null && byId.has(game.selected)) sel = byId.get(game.selected);

    const cls = sel ? CLASSES[sel.cls] || {} : null;
    setText(selName, sel ? cls.name || sel.name || sel.cls : 'No unit selected');
    if (sel) {
      const role = sel.role === 'raider' ? 'raider' : sel.role === 'guard' ? 'guard' : 'crew';
      const dead = sel.alive === false ? ' - fallen' : '';
      setText(selSide, (SIDE_LABEL[sel.side] || sel.side || 'crew') + ' - ' + role + dead);
      if (selSwatch) selSwatch.style.background = cls.colour || PALETTE.dim;
    } else {
      setText(selSide, 'click one of your crew');
      if (selSwatch) selSwatch.style.background = '#33424a';
    }
    renderPips(selPips, sel ? sel.hp : 0, sel ? sel.maxHp || cls.hp || 0 : 0);

    // stat rows
    const show = {};
    if (cls) {
      show.health = sel.hp + ' / ' + (sel.maxHp || cls.hp || 0);
      show.moveSpeed = n1(cls.moveSpeed) + ' cells/s';
      show.turnSpeed = Math.round(cls.turnSpeed) + ' deg/s';
      show.reaction = trim2(cls.reaction) + ' s';
      show.attack = cls.attack === 'ranged' ? (cls.loud ? 'Ranged - loud' : 'Ranged - quiet') : 'Melee';
      show.attackRange = trim2(cls.attackRange) + ' cells';
      show.attackInterval = trim2(cls.attackInterval) + ' s';
      if (cls.attack === 'ranged') {
        show.accuracy = pct(cls.accuracy);
        show.accuracyAtMax = pct(cls.accuracyAtMax);
      }
      if (cls.attack !== 'ranged' && cls.chargeRange != null) show.chargeRange = trim2(cls.chargeRange) + ' cells';
      if (cls.block != null) show.block = pct(cls.block);
    }
    for (const [key] of STAT_ROWS) {
      const node = statNodes[key];
      if (!node) continue;
      const value = show[key];
      node.row.classList.toggle('hidden', value == null);
      if (value != null) setText(node.val, value);
    }

    // raid kit availability
    for (const name of ABILITIES) {
      const node = kitNodes[name];
      if (!node) continue;
      const st = abilityState(name, sel, game, hatches);
      const charges = sel && sel.charges ? sel.charges : {};
      let text = '';
      if (name === 'keg') text = String(Math.max(0, Number(charges.keg) || 0));
      else if (name === 'smoke') text = String(Math.max(0, Number(charges.smoke) || 0));
      else text = st.ok ? 'ok' : '-';
      setText(node.val, text);
      setClass(node.item, 'off', !st.ok);
    }

    // ---- squads
    for (const u of units) {
      if (!u || u.id == null) continue;
      const rec = unitRow(u);
      const c = CLASSES[u.cls] || {};
      setText(rec.name, u.name || c.name || u.cls || 'crew');
      rec.dot.style.background = c.colour || PALETTE.dim;
      renderPips(rec.pips, u.hp, u.maxHp || c.hp || 1);
      setText(rec.tag, u.carrying ? 'carrying' : '');
      setClass(rec.row, 'is-dead', u.alive === false);
      setClass(rec.row, 'clickable', u.side === game.side);
      setClass(rec.row, 'is-selected', game.selected === u.id);
      setClass(rec.row, 'is-hover', game.hoverId === u.id);
    }
    for (const [id, rec] of Array.from(unitRows)) {
      if (byId.has(id)) continue;
      if (rec.row.parentNode) rec.row.parentNode.removeChild(rec.row);
      unitRows.delete(id);
    }

    // ---- abilities
    const canAct = game.phase === 'raid' || game.phase == null;
    for (const name of ABILITIES) {
      const b = abilityBtns[name];
      if (!b) continue;
      const st = canAct ? abilityState(name, sel, game, hatches) : { ok: false, why: 'the raid is over' };
      if (b.disabled !== !st.ok) b.disabled = !st.ok;
      setAttr(b, 'title', (TOOLS[name] && TOOLS[name].hint ? TOOLS[name].hint : name) + (st.ok ? '' : ' (' + st.why + ')'));
    }

    // ---- log
    renderLog(game.log || []);

    // ---- end screen
    if (overlayEl) {
      const over = game.phase === 'won' || game.phase === 'lost';
      overlayEl.classList.toggle('hidden', !over);
      if (over) {
        setText(overTitle, game.phase === 'won' ? 'SHIP TAKEN' : 'RAID FAILED');
        overTitle.className = 'over-title ' + (game.phase === 'won' ? 'win' : 'lose');
        setText(overSub, contextLine(game, units));
      }
    }
  }

  function dispose() {
    for (const n of mounted) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    mounted.length = 0;
    unitRows.clear();
    if (overlayEl) overlayEl.classList.add('hidden');
    current = null;
  }

  return { update, dispose };
}
