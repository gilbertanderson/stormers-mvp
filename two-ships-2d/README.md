# The Two Ships — standalone prototype export

This folder is a plain source export of the Aura Slice **"The Two Ships"** (Stormers: Hull Raiders
mission prototype). It is a complete, self-contained browser prototype: nothing here depends on
Aura's canvas, Aura's local server, or any runtime injection, and there is no build step.

It is **not** a three.js project. The prototype is drawn with the plain Canvas 2D API and plain DOM;
it has **zero third-party dependencies** (no three.js, no frameworks, no bundler, no external fonts
or images). Aura Slice passes it an import map, but the code never imports `three` or `aura-kit`, so
the same files run unmodified in any static web server.

## Run it locally

ES modules are fetched by the browser, so the page will not load from `file://` — serve the folder
over http instead:

```bash
cd two-ships-2d
python3 -m http.server 8080
# then open http://localhost:8080/
```

Any static server works (`npx serve`, `php -S localhost:8080`, Unity's own dev server, ...). Open the
served folder's `index.html`; `index.html` loads `./src/main.js` as a module and `./src/style.css`.

## Controls

- Click one of your crew, then click a deck cell to move there.
- `1` PRY (3 s, silent) · `2` AXE (1.2 s, noise 7) · `3` KEG (1 s place, 2 s fuse, noise 14) · `4` SMOKE (range 6, stun 4 s)
- `Space` pauses, `Esc` cancels a smoke aim.
- Top bar: switch side (Vikings / Pirates), Pause / Resume, Restart. The aim of the raid: cross the
  three planks, breach or blow the enemy cabin hatch, take their chest and carry it back to your own.

## Files

```
index.html              entry point (markup only)
src/main.js             wiring: game, canvas view, HUD, input, rAF loop, test hooks
src/contracts.js        tiles, palette, 28x17 map rows, class stats, tools, keymap, math helpers
src/world.js            map parsing, grid queries, line of sight, BFS pathfinding
src/sim.js              real-time rules: movement, vision, noise, combat, breaches, kegs, smoke, chests, end states
src/ai.js               the other crew: guards hold their post, raiders take the planks and the chest
src/view.js             Canvas 2D renderer for the deck, units, smoke, fx and selection overlay
src/hud.js              DOM chrome: top bar, selected-unit card, crew list, raid kit, abilities, event log, end screen
src/style.css           dark chrome for the HUD
```

There are no binary assets: every icon, marker and wave line is drawn procedurally in `src/view.js`.
(The Slice's own `thumb.png` is Aura's cover image for the Slice, not part of the prototype, and is
deliberately not exported.)

## Aura test hooks

`src/main.js` ends with a guarded block that registers `AuraSlice.expose` / `AuraSlice.exposeAction`
readers (`phase`, `units`, `advance`, `fresh`, ...) for Aura's playtests. It is wrapped in
`typeof AuraSlice !== 'undefined'` checks and `try/catch`, so outside Aura it is inert: the page
starts, runs and plays exactly the same with `window.AuraSlice` undefined.

## Third-party libraries and assets

- **Libraries:** none. Only the browser's standard Canvas 2D, DOM and ES module support are used.
- **Assets:** none. No CC0 or third-party art, audio or fonts are included; all visuals are drawn
  in code and the only font is the system UI font stack (`ui-sans-serif, system-ui, ...`).
- Seeded combat rolls use a mulberry32 PRNG written in `src/contracts.js`, so a given seed is
  reproducible (`makeRng`).

Source: exported verbatim from the saved state of the Aura Slice `the-two-ships`.
