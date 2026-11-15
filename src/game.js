// The rules of the slice, with no rendering in it.
//
// The Unity game splits these across Stormers.Core (planning, stepping, vision, scoring) and
// the Hull Raiders title. The browser build keeps the same shape in one file: a plan is a list
// of waypoints, Space runs it, units fight whoever they can see, and noise wakes the deck.

import { MAP, CLASSES, parseMap } from './map.js';

export const PHASE = { PLAN: 'plan', RUN: 'run' };

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.map = parseMap(MAP);
    this.units = [];
    this.chests = this.map.chests.map((c) => ({ ...c, carrier: null }));
    this.noise = [];
    this.tracers = [];
    this.blasts = [];
    this.time = 0;
    this.phase = PHASE.PLAN;
    this.outcome = null;
    this.stars = 0;
    this.lost = 0;
    this.revealAll = false;
    this.dirtyPaths = true;
    this.dirtyVision = true;
    this.message = '';

    let id = 0;
    for (const spawn of this.map.spawns) {
      const cls = CLASSES[spawn.cls];
      this.units.push({
        id: id++,
        team: spawn.team,
        cls,
        key: spawn.cls,
        x: spawn.x,
        y: spawn.y,
        cellX: spawn.x,
        cellY: spawn.y,
        face: { ...spawn.face },
        aim: { ...spawn.face },
        hp: cls.hp,
        maxHp: cls.hp,
        plan: [],
        route: [],
        routeAt: 0,
        hold: 0,
        attackCd: 0,
        chaseCd: 0,
        aware: 0,
        alert: 0,
        target: null,
        carrying: null,
        alive: true,
        hurt: 0,
        bob: Math.random() * Math.PI * 2,
      });
    }

    this.selected = this.squad[0] || null;
    this.tick = 0;
  }

  get squad() {
    return this.units.filter((u) => u.team === 'squad');
  }

  get hostiles() {
    return this.units.filter((u) => u.team === 'hostile');
  }

  get living() {
    return this.units.filter((u) => u.alive);
  }

  ownChest(team) {
    return this.chests.find((c) => c.team === team);
  }

  enemyChest(team) {
    return this.chests.find((c) => c.team !== team);
  }

  // ------------------------------------------------------------------ pathfinding

  /// Breadth-first over the deck, four ways, so a plan always takes the shortest way through
  /// the hulls and their hatches. Returns the cells after the start, or null if unreachable.
  findPath(fromX, fromY, toX, toY) {
    const { cols } = this.map;
    if (!this.map.walkable(toX, toY)) return null;
    const start = fromY * cols + fromX;
    const goal = toY * cols + toX;
    if (start === goal) return [];

    const prev = new Map();
    const seen = new Set([start]);
    const queue = [start];
    let head = 0;

    while (head < queue.length) {
      const cell = queue[head++];
      if (cell === goal) break;
      const cx = cell % cols;
      const cy = (cell - cx) / cols;
      const next = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of next) {
        if (!this.map.walkable(nx, ny)) continue;
        const key = ny * cols + nx;
        if (seen.has(key)) continue;
        seen.add(key);
        prev.set(key, cell);
        queue.push(key);
      }
    }

    if (!seen.has(goal)) return null;
    const cells = [];
    let cell = goal;
    while (cell !== start) {
      const cx = cell % cols;
      cells.push({ x: cx, y: (cell - cx) / cols });
      cell = prev.get(cell);
    }
    return cells.reverse();
  }

  /// Walks a plan into one cell route, carrying each waypoint's hold with the cell it ends on.
  routeFor(unit) {
    const cells = [];
    let fromX = unit.cellX;
    let fromY = unit.cellY;
    for (const waypoint of unit.plan) {
      const leg = this.findPath(fromX, fromY, waypoint.x, waypoint.y);
      if (!leg) continue;
      for (const cell of leg) cells.push({ x: cell.x, y: cell.y, hold: 0 });
      if (waypoint.hold > 0 && cells.length) cells[cells.length - 1].hold = waypoint.hold;
      if (waypoint.look && cells.length) cells[cells.length - 1].look = waypoint.look;
      fromX = waypoint.x;
      fromY = waypoint.y;
    }
    return cells;
  }

  // ------------------------------------------------------------------ planning

  select(unit) {
    if (!unit || !unit.alive || unit.team !== 'squad') return;
    this.selected = unit;
  }

  selectNext() {
    const squad = this.squad.filter((u) => u.alive);
    if (!squad.length) return;
    const at = squad.indexOf(this.selected);
    this.select(squad[(at + 1) % squad.length]);
  }

  addWaypoint(x, y) {
    const unit = this.selected;
    if (!unit || !unit.alive) return false;
    if (!this.map.walkable(x, y)) return false;
    const last = unit.plan.length
      ? unit.plan[unit.plan.length - 1]
      : { x: unit.cellX, y: unit.cellY };
    if (!this.findPath(last.x, last.y, x, y)) return false;
    unit.plan.push({ x, y, hold: 0, look: null });
    this.dirtyPaths = true;
    return true;
  }

  popWaypoint() {
    const unit = this.selected;
    if (!unit || !unit.plan.length) return;
    unit.plan.pop();
    this.dirtyPaths = true;
  }

  clearPath() {
    if (!this.selected) return;
    this.selected.plan.length = 0;
    this.dirtyPaths = true;
  }

  toggleHold() {
    const unit = this.selected;
    if (!unit || !unit.plan.length) return;
    const waypoint = unit.plan[unit.plan.length - 1];
    waypoint.hold = waypoint.hold > 0 ? 0 : 2;
    this.dirtyPaths = true;
  }

  // ------------------------------------------------------------------ running

  togglePause() {
    if (this.outcome) return;
    if (this.phase === PHASE.PLAN) {
      this.phase = PHASE.RUN;
      for (const unit of this.squad) {
        unit.route = this.routeFor(unit);
        unit.routeAt = 0;
        unit.hold = 0;
        unit.attackCd = 0;
      }
      this.dirtyPaths = true;
    } else {
      this.phase = PHASE.PLAN;
      for (const unit of this.units) {
        unit.route = [];
        unit.routeAt = 0;
        unit.hold = 0;
      }
      this.dirtyPaths = true;
    }
  }

  makeNoise(x, y, radius, team) {
    this.noise.push({ x, y, radius, age: 0, life: 1.1, team });
    for (const unit of this.units) {
      if (!unit.alive || unit.team === team) continue;
      if (Math.hypot(unit.x - x, unit.y - y) > radius) continue;
      const dx = x - unit.x;
      const dy = y - unit.y;
      const d = Math.hypot(dx, dy) || 1;
      unit.face = { x: dx / d, y: dy / d };
      unit.alert = 2.2;
    }
  }

  update(dt) {
    if (this.phase !== PHASE.RUN || this.outcome) {
      this.ageEffects(dt);
      return;
    }

    this.time += dt;

    for (const unit of this.units) {
      if (!unit.alive) continue;
      unit.attackCd = Math.max(0, unit.attackCd - dt);
      unit.hurt = Math.max(0, unit.hurt - dt);
      if (unit.alert > 0) unit.alert -= dt;
      if (unit.team === 'hostile') this.think(unit, dt);
      this.moveUnit(unit, dt);
    }

    // Player raiders shoot whatever they can see and reach; the plan is where they walk, not
    // what they do when a musket comes up.
    for (const unit of this.squad) {
      if (!unit.alive || unit.attackCd > 0) continue;
      const target = this.acquire(unit);
      if (!target) continue;
      this.fire(unit, target);
    }

    this.ageEffects(dt);
    this.evaluate();
    this.dirtyVision = true;
  }

  ageEffects(dt) {
    for (const puff of this.noise) puff.age += dt;
    this.noise = this.noise.filter((puff) => puff.age < puff.life);
    for (const tracer of this.tracers) tracer.age += dt;
    this.tracers = this.tracers.filter((tracer) => tracer.age < 0.18);
    for (const blast of this.blasts) blast.age += dt;
    this.blasts = this.blasts.filter((blast) => blast.age < 0.5);
  }

  // ------------------------------------------------------------------ movement

  moveUnit(unit, dt) {
    if (!unit.alive) return;
    if (unit.routeAt >= unit.route.length) return;

    const next = unit.route[unit.routeAt];

    if (unit.hold > 0) {
      unit.hold -= dt;
      if (next.look) unit.face = { ...next.look };
      return;
    }

    const dx = next.x - unit.x;
    const dy = next.y - unit.y;
    const d = Math.hypot(dx, dy);
    const speed = unit.cls.move * (unit.carrying ? 0.8 : 1) * dt;

    if (d <= speed) {
      unit.x = next.x;
      unit.y = next.y;
      unit.cellX = next.x;
      unit.cellY = next.y;
      unit.routeAt++;
      this.arrive(unit, next);
      return;
    }

    unit.x += (dx / d) * speed;
    unit.y += (dy / d) * speed;
    unit.face = { x: dx / d, y: dy / d };
  }

  arrive(unit, cell) {
    if (cell.hold) unit.hold = cell.hold;
    if (cell.look) unit.face = { ...cell.look };
    if (unit.team !== 'squad') return;

    const prize = this.enemyChest(unit.team);
    if (
      prize &&
      !prize.carrier &&
      unit.cellX === prize.x &&
      unit.cellY === prize.y
    ) {
      prize.carrier = unit;
      unit.carrying = prize;
      this.message = `${unit.cls.name} has the Vikings' chest.`;
    }

    const home = this.ownChest(unit.team);
    if (
      unit.carrying &&
      home &&
      unit.cellX === home.x &&
      unit.cellY === home.y
    ) {
      this.win('chest');
    }

    if (unit.carrying) this.message = `Carry it home to ${MAP.squadName.toLowerCase()}' chest.`;
  }

  // ------------------------------------------------------------------ vision and combat

  /// Walls block sight; a unit sees a 110-degree cone nine cells deep, the core's numbers.
  lineClear(ax, ay, bx, by) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = Math.round(ax + (bx - ax) * t);
      const y = Math.round(ay + (by - ay) * t);
      if (this.map.blocksSight(x, y)) return false;
    }
    return true;
  }

  sees(unit, other) {
    const dx = other.x - unit.x;
    const dy = other.y - unit.y;
    const d = Math.hypot(dx, dy);
    if (d > unit.cls.view) return false;
    if (d > 0.6) {
      const facing = (dx * unit.face.x + dy * unit.face.y) / d;
      if (facing < Math.cos((unit.cls.viewAngle * Math.PI) / 360)) return false;
    }
    return this.lineClear(unit.x, unit.y, other.x, other.y);
  }

  /// Anything within a couple of paces is noticed even with its back turned: boots on the
  /// deck are not something a raider can un-see, and without this two crews can stand a room
  /// apart, both facing away, forever.
  notices(unit, other) {
    const d = Math.hypot(other.x - unit.x, other.y - unit.y);
    if (d <= 2.6 && this.lineClear(unit.x, unit.y, other.x, other.y)) return true;
    return this.sees(unit, other);
  }

  /// The nearest enemy this unit can see coming, whether it can reach it yet or not.
  acquire(unit) {
    let best = null;
    let bestDist = Infinity;
    for (const other of this.units) {
      if (!other.alive || other.team === unit.team) continue;
      const d = distance(unit, other);
      if (d > unit.cls.range) continue;
      if (!this.notices(unit, other)) continue;
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  fire(shooter, target) {
    const d = distance(shooter, target);
    const aim = { x: (target.x - shooter.x) / (d || 1), y: (target.y - shooter.y) / (d || 1) };
    shooter.face = aim;
    shooter.aim = aim;
    shooter.attackCd = shooter.cls.interval;

    let chance = 1;
    if (shooter.cls.accuracy !== undefined) {
      const falloff = Math.min(1, d / shooter.cls.range);
      chance = shooter.cls.accuracy + (shooter.cls.accuracyMax - shooter.cls.accuracy) * falloff;
    }

    // A shield or a spear wall stops most of what comes at its front.
    const toShooter = { x: -aim.x, y: -aim.y };
    const facing = target.face.x * toShooter.x + target.face.y * toShooter.y;
    if (target.cls.block && facing > 0.5) chance *= 1 - target.cls.block;

    const hit = Math.random() < chance;
    this.tracers.push({ from: { x: shooter.x, y: shooter.y }, to: { x: target.x, y: target.y }, age: 0, hit });

    if (shooter.cls.loud) this.makeNoise(shooter.x, shooter.y, shooter.cls.noise, shooter.team);
    if (hit) this.damage(target, shooter);
  }

  damage(target, shooter) {
    target.hp -= 1;
    target.hurt = 0.35;
    this.dirtyVision = true;
    if (target.hp > 0) return;

    target.alive = false;
    target.route = [];
    target.target = null;

    if (target.carrying) {
      const chest = target.carrying;
      chest.carrier = null;
      chest.x = target.cellX;
      chest.y = target.cellY;
      target.carrying = null;
    }

    this.blasts.push({ x: target.x, y: target.y, age: 0 });
    if (target.team === 'squad') {
      this.lost++;
      this.message = `${target.cls.name} is down.`;
      if (this.selected === target) this.selected = this.squad.find((u) => u.alive) || null;
    } else if (shooter) {
      this.message = `${shooter.cls.name} has killed a ${target.cls.name}.`;
    }
  }

  /// Enemies hold their post and react on sight: no orders, but they will close and they
  /// will shoot. The pirates' Pistoleer is loud, so every shot pulls the deck toward it.
  think(unit, dt) {
    const seen = this.units.filter(
      (other) => other.alive && other.team !== unit.team && this.notices(unit, other)
    );

    if (seen.length) {
      seen.sort((a, b) => distance(unit, a) - distance(unit, b));
      unit.aware += dt;
      if (unit.aware >= unit.cls.reaction) unit.target = seen[0];
    } else if (!unit.target || !unit.target.alive || !this.notices(unit, unit.target)) {
      unit.aware = Math.max(0, unit.aware - dt);
      unit.target = null;
    }

    const target = unit.target;
    if (!target || !target.alive) return;

    const d = distance(unit, target);
    if (d <= unit.cls.range) {
      if (unit.attackCd <= 0) this.fire(unit, target);
      return;
    }

    // Out of reach: close along the deck, a step at a time, so walls still matter.
    unit.chaseCd -= dt;
    if (unit.chaseCd > 0) return;
    unit.chaseCd = 0.35;
    const path = this.findPath(unit.cellX, unit.cellY, target.cellX, target.cellY);
    if (path && path.length) {
      unit.route = [path[0]];
      unit.routeAt = 0;
    }
  }

  // ------------------------------------------------------------------ fog of war

  /// Every deck cell a squad raider can see, keyed "x,y". F reveals the lot.
  visibleCells() {
    const seen = new Set();
    if (this.revealAll) {
      for (let y = 0; y < this.map.rows; y++) {
        for (let x = 0; x < this.map.cols; x++) seen.add(x + ',' + y);
      }
      return seen;
    }
    for (const unit of this.squad) {
      if (!unit.alive) continue;
      const radius = unit.cls.view;
      const fromX = Math.max(0, Math.floor(unit.x - radius));
      const toX = Math.min(this.map.cols - 1, Math.ceil(unit.x + radius));
      const fromY = Math.max(0, Math.floor(unit.y - radius));
      const toY = Math.min(this.map.rows - 1, Math.ceil(unit.y + radius));
      for (let y = fromY; y <= toY; y++) {
        for (let x = fromX; x <= toX; x++) {
          if (!this.map.walkable(x, y)) continue;
          const dx = x - unit.x;
          const dy = y - unit.y;
          const d = Math.hypot(dx, dy);
          if (d > radius) continue;
          if (d > 0.6) {
            const facing = (dx * unit.face.x + dy * unit.face.y) / d;
            if (facing < Math.cos((unit.cls.viewAngle * Math.PI) / 360)) continue;
          }
          if (!this.lineClear(unit.x, unit.y, x, y)) continue;
          seen.add(x + ',' + y);
        }
      }
      seen.add(unit.cellX + ',' + unit.cellY);
    }
    return seen;
  }

  // ------------------------------------------------------------------ outcome

  evaluate() {
    if (this.outcome) return;
    const squadAlive = this.squad.filter((u) => u.alive).length;
    const hostilesAlive = this.hostiles.filter((u) => u.alive).length;
    if (squadAlive === 0) this.lose();
    else if (hostilesAlive === 0) this.win('cleared');
  }

  win(how) {
    if (this.outcome) return;
    this.outcome = { result: 'win', how };
    this.stars = this.lost === 0 ? 3 : this.lost === 1 ? 2 : 1;
    this.phase = PHASE.PLAN;
    this.message = how === 'chest' ? 'The chest is home.' : `No ${MAP.hostileName.toLowerCase()} left standing.`;
  }

  lose() {
    if (this.outcome) return;
    this.outcome = { result: 'lose', how: 'wiped' };
    this.stars = 0;
    this.phase = PHASE.PLAN;
    this.message = 'Every raider is down.';
  }
}
