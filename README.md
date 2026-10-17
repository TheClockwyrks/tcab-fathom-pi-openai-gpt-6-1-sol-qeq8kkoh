# Fathom

**A little light. A very hungry ocean.**

Fathom is a bioluminescent maze chase in the deep sea. Graze every plankton mote,
read the corridors with sonar, and evade three hunters: the light-seeking
Lanternjaw, the sound-tracking Gloamfin, and the flash-hunting Flarefish.

This is the **Kindle** dive. Your light reveals nearby ground; a larger circular
window shows the paths you remember. Eating grows both circles, but makes you
easier to see. Explored ground beyond the window is still completely dark.
Amber glimmers might be harmless bonus drifters—or something hungry.

## Run locally

Requires a current Node.js version supported by Vite (Node 22.12+ or Node 24).

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. The game works with a keyboard or the engine's
automatic touchscreen controls. It needs no account, backend, downloaded fonts,
or external services. Sound unlocks on the first interaction; muted play is fully
supported.

## Controls

| Control | Action |
| --- | --- |
| Arrow keys / WASD | Swim; up/down select menu items |
| Space | Send corridor-following sonar; confirm a menu item |
| Shift | Release an ink cloud |
| Enter | Confirm a menu item |
| Escape / P | Pause or resume |
| Escape | Back from a menu or the field guide |
| M | Toggle sound |
| Backtick | Toggle diagnostics |
| Pointer / touch | Select and confirm menu items |

Hold a direction to swim; release movement controls to stop. Turns are buffered
until the next open junction, and you can reverse immediately. Sonar maps around
corners but gives the Gloamfin a sound fix. Ink blinds the light hunters, not the
Gloamfin. Clearing all plankton descends one depth, adds hunters up to six, and
shortens sonar range. You start with three lives in reserve in addition to the
attempt being played.

## Production build

```sh
npm run build
```

The complete static site is emitted to `dist/`, with `index.html` at its root.
Serve that directory as-is, at a server root or a sub-path. All game assets are
local and requested relative to the page. `npm run preview` serves the build
locally for a final check.

## Checks

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

Tests stand the actual Simple 2D engine up over a Node canvas and a scripted
clock. They cover movement, frame partitioning, fog and rendering masks, sonar,
ink, predator senses, releases, scoring, menus, and the immutable debug surface.
Coverage and test reports are written to `coverage/`.

## Source map

- `src/game.ts`: engine registrations, art loading, and the game export.
- `src/types.ts`: state, snapshot, and debug API types (re-exported by `game.ts`).
- `src/world.ts`: maze, grid geometry, immutable copies, routing, and motion.
- `src/simulation.ts`: render-free, 120 Hz simulation and input transitions.
- `src/debug.ts`: validated, immutable scenario poses and pure readings.
- `src/render.ts`: the trench, creatures, effects, HUD, and seven screens.
- `src/stage.css`: responsive CSS surface sizing; fitting remains the engine's.
- `src/game.test.ts`: engine-driven unit and pixel tests.
- `showcase/`: player-facing description, screenshots, and a five-second replay.

The engine owns the frame loop, canvas fit, input, audio, asset loading, recording,
and diagnostic overlay. State belongs entirely to the engine-held `FathomState`.
Automation obtains the surface through `engine.debug`, poses through
`engine.apply(s => engine.debug.setScreen(s, "playing"))`, and reads through
`engine.debug.snapshot(engine.state)`. Nothing is installed on the production
page's global object.
