// Headless check of the rules, with no browser and no renderer in the way:
//
//   node test/sim.mjs
//
// It asserts the things that quietly break a tactics slice: the map keeps its shape, every
// raider can path to the other crew's chest, nobody walks through a bulkhead or off the deck,
// a placed plan actually moves the raiders, a fight resolves, and the chest rules score.

import { Game, PHASE } from '../src/game.js';

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const run = (game, seconds, until) => {
  let ticks = 0;
  const limit = Math.round(seconds * 60);
  while (ticks < limit && !(until && until())) {
    game.update(1 / 60);
    ticks++;
  }
  return ticks / 60;
};

console.log('map');
const game = new Game();
const map = game.map;
check(`deck plan is ${map.cols}x${map.rows}`, map.cols === 44 && map.rows === 22);
check('four pirates and four vikings', game.squad.length === 4 && game.hostiles.length === 4,
  `${game.squad.length}/${game.hostiles.length}`);
check('two chests, one a side', game.chests.length === 2 &&
  game.chests.some((c) => c.team === 'squad') && game.chests.some((c) => c.team === 'hostile'));
check('both hulls are joined by deck', map.walkable(19, 6) && map.walkable(20, 6) && map.walkable(24, 6));
check('the channel is open water between the planks', !map.walkable(21, 8));
check('a bulkhead stops sight and movement', !map.walkable(19, 8) && map.blocksSight(19, 8));

console.log('pathfinding');
const prize = game.enemyChest('squad');
for (const unit of game.squad) {
  const path = game.findPath(unit.cellX, unit.cellY, prize.x, prize.y);
  check(`${unit.cls.name} can reach the vikings' chest`, Boolean(path) && path.length > 0,
    path ? `${path.length} cells` : 'no route');
}
const across = game.findPath(6, 18, 34, 18);
check('a route crosses the channel by a plank', Boolean(across) && across.length > 24,
  across ? `${across.length} cells` : 'no route');

console.log('a placed plan runs');
const planner = new Game();
const scout = planner.squad[0];
planner.select(scout);
planner.addWaypoint(prize.x, prize.y);
check('the waypoint is accepted', scout.plan.length === 1);
planner.togglePause();
check('space starts the plan', planner.phase === PHASE.RUN);

const startedAt = { x: scout.x, y: scout.y };
let offDeck = 0;
run(planner, 25, () => !scout.alive || (scout.cellX === prize.x && scout.cellY === prize.y));
check('the raider moved', Math.hypot(scout.x - startedAt.x, scout.y - startedAt.y) > 3,
  `${Math.hypot(scout.x - startedAt.x, scout.y - startedAt.y).toFixed(1)} cells`);
check('nobody left the deck',
  planner.units.every((u) => !u.alive || map.walkable(Math.round(u.x), Math.round(u.y))), `${offDeck}`);
check('the raider either reached the chest or died trying', !scout.alive || scout.carrying !== null,
  `alive=${scout.alive} carrying=${Boolean(scout.carrying)}`);

console.log('the chest rules');
const rules = new Game();
const runner = rules.squad[0];
const theirChest = rules.enemyChest('squad');
const ourChest = rules.ownChest('squad');

const stand = (unit, x, y) => {
  unit.x = x;
  unit.y = y;
  unit.cellX = x;
  unit.cellY = y;
  rules.arrive(unit, { x, y, hold: 0 });
};

stand(runner, theirChest.x, theirChest.y);
check('standing on the chest takes it', theirChest.carrier === runner);
stand(runner, ourChest.x, ourChest.y);
check('carrying it home wins', rules.outcome && rules.outcome.result === 'win',
  rules.outcome ? rules.outcome.how : 'no outcome');
check('an untouched squad earns three stars', rules.stars === 3, `${rules.stars}`);

const dropped = new Game();
const bearer = dropped.squad[0];
bearer.x = dropped.enemyChest('squad').x;
bearer.y = dropped.enemyChest('squad').y;
dropped.arrive(bearer, { x: bearer.x, y: bearer.y, hold: 0 });
dropped.damage(bearer, dropped.hostiles[0]);
check('a killed carrier drops the chest', dropped.enemyChest('squad').carrier === null);

console.log('a fight resolves');
const fight = new Game();
const pirate = fight.squad[2];
const viking = fight.hostiles[0];
const place = (unit, x, y, face) => {
  unit.x = x;
  unit.y = y;
  unit.cellX = x;
  unit.cellY = y;
  unit.face = { ...face };
};
place(pirate, 20, 10, { x: 0, y: -1 });
place(viking, 22, 10, { x: -1, y: 0 });
fight.select(pirate);
fight.addWaypoint(22, 10);
fight.togglePause();
const fightTime = run(fight, 30, () => !pirate.alive || !viking.alive);
check('two crews in reach kill each other', !pirate.alive || !viking.alive,
  `after ${fightTime.toFixed(1)}s`);

console.log('a full boarding party');
const raid = new Game();
for (const unit of raid.squad) {
  raid.select(unit);
  raid.addWaypoint(raid.enemyChest('squad').x, raid.enemyChest('squad').y);
  raid.addWaypoint(raid.ownChest('squad').x, raid.ownChest('squad').y);
}
raid.togglePause();
const raidTime = run(raid, 240, () => Boolean(raid.outcome));
check('four raiders on one order fight it out to an outcome', Boolean(raid.outcome),
  `${raidTime.toFixed(0)}s`);
if (raid.outcome) {
  console.log(`  ..   ${raid.outcome.result} by ${raid.outcome.how}, ` +
    `${raid.stars} star(s), ${raid.lost} lost, ${raidTime.toFixed(0)}s`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
