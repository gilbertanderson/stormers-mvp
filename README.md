# Stormers — The Two Ships

A playable slice of **Stormers**, a game in development. Two crews, two hulls, one boarding
channel: lay a plan for your raiders, then press Space and watch it either work or fall apart.

This is a browser build of the *The Two Ships* mission from the Unity prototype
(*Stormers: Hull Raiders*). It is not a port of the engine — it is the same map, the same
spawns and the same class numbers, re-implemented in plain JavaScript on three.js so the
mission can be played without a download.

Play it: **https://gilbertanderson.github.io/stormers-mvp/**

## Play it locally

No build step, no dependencies to install — but it uses ES modules, so it has to be served
over HTTP rather than opened from disk.

```sh
python -m http.server 8123
# or
npx serve .
```

Then open <http://127.0.0.1:8123/>.

The rules test runs headless, with no browser:

```sh
node test/sim.mjs
```

## How it plays

You are the **Pirates**, boarding the **Vikings** across three planks. You win by carrying the
Viking chest back to your own, or by leaving none of them standing.

The game runs in two phases:

- **Planning** — nothing moves. Click a raider, then click deck to lay a path. Each click adds a
  waypoint; paths are routed around bulkheads, so you are choosing a route, not drawing one.
- **Running** — press Space. Raiders walk their plans. You can pause back into planning at any
  time, keep what is left of the route, and change your mind.

Combat is automatic and simultaneous on both sides. Whoever is spotted first reacts first: your
raiders and theirs both engage anything in reach with a clear line, or anything inside their
view cone — so walking a crew down the open deck presents everyone to everyone at once. A
front-facing target is partly blocked; spearmen block more.

Chests start guarded, facing the hatches behind them, so a chest cannot simply be walked off.
Whoever carries one is a beacon: it is visible through the fog, and it can be taken off them.

Stars are for lives, not for speed: no raider lost is three stars, one lost is two, anything
else is one.

### Controls

| Input | Action |
| --- | --- |
| Click a raider, then deck | Select, then plot a waypoint |
| Right-click | Step the current plan back |
| `H` | Hold at the last waypoint instead of pushing on |
| `Space` | Run the plan / pause back to planning |
| `F` | Reveal the whole deck |
| `R` | Restart the mission |
| `WASD` or drag | Pan |
| Wheel | Zoom |
| `Tab` | Cycle raiders |
| `Backspace` | Clear the current plan |
| `Esc` | Deselect |

## What is and is not in the slice

Implemented:

- The full 44 × 22 deck plan of both hulls, ported cell for cell, with bulkheads, hatches,
  three boarding planks and the water between them.
- Five raider classes with the prototype's real numbers — speed, reaction time, reach, attack
  interval, accuracy falloff by range, frontal block, view cone, and the pistoleer's noise.
- Path planning around walls, per-waypoint holds, both crews moving and fighting at once.
- Fog of war from each raider's view cone, broken by bulkheads.
- Chests: guarded, carryable, visible through the fog while carried, and a win condition.
- Win / loss with star scoring, and restart.

Not implemented, and deliberately so — these exist in the Unity prototype and not here:

- Go-codes and called shots.
- Charges and the breach action (blowing a hull open rather than using a plank).
- The Viking crew defends. It does not raid: it does not plan, does not push across a plank,
  and does not go for your chest.
- Anything persistent: no saves, no progression, no unlocks.
- Touch input. This is a mouse-and-keyboard slice.

### One warning

A straight march down the open deck is a losing plan. The mission is built around bulkheads,
hatches and timing; if you line your crew up in the open you will get a musket volley and an
axeman for your trouble. Split across the planks.

## Where the numbers come from

Everything mechanical here is transcribed from the Unity project, not invented for the web
build:

| Here | Source of truth |
| --- | --- |
| `src/map.js` — deck plan | `Assets/HullRaiders/Scripts/HullRaidersLevels.cs`, `TheTwoShips()` |
| `src/map.js` — classes, roster, spawns | `Assets/HullRaiders/Scripts/HullRaidersClasses.cs` |
| `src/game.js` — rules | `stormers-core`'s `Unit`, `UnitPlan`, `Pathfinder`, `Chest`, `Commander` and `Mission` |

If the mission changes in Unity, `src/map.js` has to change with it — the deck plan is written as
ASCII rows in the same shape as the C# level data for exactly that reason.

## The code

| File | What it does |
| --- | --- |
| `src/map.js` | Deck plan, palette, class table, spawns, map parsing (walkability, sight, surfaces) |
| `src/game.js` | Rules: BFS routing, planning, running, vision, combat, chests, scoring |
| `src/view.js` | three.js scene, camera and input geometry — instanced deck, planks, fog, paths, noise, tracers |
| `src/main.js` | DOM HUD, keyboard and mouse, and the frame loop; exposes `window.stormers` for poking at a live game |
| `test/sim.mjs` | Headless rules test that drives `game.js` with no renderer |

`vendor/three/` holds three.js r171 (module build). Nothing else is vendored and there is no
package manager involved.

## Licence

three.js is MIT licensed — see `vendor/three/LICENSE`. The game code and the mission data are
© the Stormers project.
