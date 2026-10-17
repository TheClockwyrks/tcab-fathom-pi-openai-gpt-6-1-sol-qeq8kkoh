/// <reference types="node" />
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine } from "@clockwyrks/simple-2d";
import { BACKGROUND, game } from "./game";
import type { FathomDebugApi, FathomState } from "./game";
import * as C from "./constants";
import {
  center,
  copy,
  distances,
  exits,
  initial,
  layer,
  maze,
  neighbor,
  put,
} from "./world";
import { lighting } from "./simulation";

// Native canvas and coverage instrumentation can be slow on shared CI runners.
vi.setConfig({ testTimeout: 30000 });
const engines: Engine<FathomState, FathomDebugApi>[] = [];
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    async (path: string) => new Response(new Uint8Array(await readFile(path))),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterEach(() => {
  engines.splice(0).forEach((e) => e.destroy());
});
afterAll(() => vi.unstubAllGlobals());
async function setup(ms = 1000 / C.TICK_HZ) {
  const canvas = createCanvas(640, 360),
    events = new EventTarget();
  const e = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game,
    background: BACKGROUND,
    layout: C.LAYOUT,
    clock: new ConstantClock(ms),
    surface: {
      cssWidth: () => 640,
      cssHeight: () => 360,
      dpr: () => 1,
      events: () => events,
    },
  });
  engines.push(e);
  const cues: string[] = [];
  e.events.on("cue:played", (event) => cues.push(event.cue));
  await e.initialize();
  const key = (code: string, on = true) => {
    const ev = new Event(on ? "keydown" : "keyup");
    Object.assign(ev, { code, repeat: false });
    events.dispatchEvent(ev);
  };
  const tap = async (code: string) => {
    key(code);
    await e.advance(1);
    key(code, false);
  };
  const apply = (
    fn: (
      d: FathomDebugApi,
      s: Parameters<FathomDebugApi["reset"]>[0],
    ) => FathomState,
  ) => e.apply((s) => fn(e.debug, s));
  const pointer = (type: string, x: number, y: number, id = 1) => {
    const ev = new Event(type);
    Object.assign(ev, {
      clientX: x / 2,
      clientY: y / 2,
      pointerId: id,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    });
    events.dispatchEvent(ev);
  };
  return { e, key, tap, apply, pointer, cues, canvas };
}
function corridor() {
  const rows = layer("#");
  for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, 5, ".");
  return rows;
}
async function fixture(rows = corridor(), x = 10, y = 5) {
  const h = await setup();
  h.apply((d, s) => d.setMaze(s, rows));
  h.apply((d, s) => d.clearPlankton(s));
  h.apply((d, s) => d.clearPredators(s));
  h.apply((d, s) => d.setForagerTile(s, x, y));
  h.apply((d, s) => d.setScreen(s, "playing"));
  return h;
}

describe("world and immutable state contract", () => {
  it("loads all art, binds the complete action vocabulary and opens unrevealed", async () => {
    const { e } = await setup();
    const s = e.debug.snapshot(e.state);
    expect(s.version).toBe(C.FATHOM_DEBUG_VERSION);
    expect(s.screen).toBe("title");
    expect(s.menuIndex).toBe(0);
    expect(s.planktonRemaining).toBe(s.tiles.join("").split(".").length - 1);
    expect(s.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    expect(
      Object.values(e.state.assets).reduce((n, a) => n + a.length, 0),
    ).toBe(75);
    expect(s.predators.map((p) => p.kind)).toEqual(C.DEN_ORDER);
    expect(s.predators.every((p) => p.state === "den" && !p.released)).toBe(
      true,
    );
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(e.diagnostics().every((r) => r.error === undefined)).toBe(true);
  });
  it("lays out connected, symmetric one-cell-wide loops with the specified proportions", () => {
    const rows = maze(),
      corridors: [number, number][] = [];
    rows.forEach((r, y) =>
      [...r].forEach((t, x) => {
        if (t === ".") corridors.push([x, y]);
        if (t !== "d" && t !== "g" && !"dg".includes(r[C.GRID_COLS - 1 - x]))
          expect(t).toBe(r[C.GRID_COLS - 1 - x]);
        if (x < C.GRID_COLS - 1 && y < C.GRID_ROWS - 1)
          expect(
            [t, r[x + 1], rows[y + 1][x], rows[y + 1][x + 1]].join(""),
          ).not.toBe("....");
      }),
    );
    const state = initial();
    const ds = distances(state, state.start.tx, state.start.ty);
    const degrees = new Map<number, number>();
    for (const [x, y] of corridors) {
      expect(ds[y * C.GRID_COLS + x]).toBeLessThan(Infinity);
      const degree = exits(state, { tx: x, ty: y }).length;
      expect(degree).toBeGreaterThanOrEqual(2);
      degrees.set(y * C.GRID_COLS + x, degree);
    }
    const openness =
      [...degrees.values()].reduce((n, v) => n + v, 0) / corridors.length;
    expect(openness).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(openness).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    const density = corridors.length / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2));
    expect(density).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(density).toBeLessThanOrEqual(C.MAZE_DENSITY_MAX);
    const seen = new Set<number>(),
      runs: number[] = [];
    for (const [x, y] of corridors) {
      const key = y * C.GRID_COLS + x;
      if (seen.has(key) || degrees.get(key) !== 2) continue;
      const queue: [number, number][] = [[x, y]];
      seen.add(key);
      for (let i = 0; i < queue.length; i++)
        for (const d of exits(state, { tx: queue[i][0], ty: queue[i][1] })) {
          const [nx, ny] = neighbor(state, queue[i][0], queue[i][1], d),
            nk = ny * C.GRID_COLS + nx;
          if (degrees.get(nk) === 2 && !seen.has(nk)) {
            seen.add(nk);
            queue.push([nx, ny]);
          }
        }
      runs.push(queue.length);
    }
    const run = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(run).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(run).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
  });
  it("poses one fact, reconciles derived fields, and never mutates an earlier state", async () => {
    const { e, apply } = await setup();
    const old = e.debug.snapshot(e.state);
    apply((d, s) => d.setBrightness(s, 0.5));
    expect(e.state.visionRadius).toBe(C.VISION_MIN + C.VISION_GAIN / 2);
    expect(e.state.windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN / 2,
    );
    expect(e.state.predators[0].detectRange).toBe(
      C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN / 2,
    );
    const posed = e.debug.snapshot(e.state);
    apply((d, s) => d.reconcile(s));
    apply((d, s) => d.reconcile(s));
    expect(e.debug.snapshot(e.state)).toEqual(posed);
    expect(old.brightness).toBe(0);
    expect(e.state.simTime).toBe(0);
    apply((d, s) => d.clearFog(s));
    apply((d, s) => d.reconcile(s));
    expect(e.state.visibility.every((r) => /^u+$/.test(r))).toBe(true);
    apply((d, s) => d.reset(s));
    expect(e.debug.snapshot(e.state)).toEqual(old);
  });
  it("rejects invalid domains loudly, accepts legal fixture exceptions", async () => {
    const { e, apply } = await setup();
    expect(() => apply((d, s) => d.setBrightness(s, 2))).toThrow(RangeError);
    expect(() => apply((d, s) => d.setLives(s, -1))).toThrow(RangeError);
    expect(() => apply((d, s) => d.setScore(s, 0.5))).toThrow(RangeError);
    expect(() => apply((d, s) => d.setDepth(s, 0))).toThrow(RangeError);
    expect(() => apply((d, s) => d.setMaze(s, ["#"]))).toThrow(RangeError);
    const rows = layer(".");
    put(rows, 1, 1, "d");
    expect(() => apply((d, s) => d.setMaze(s, rows))).toThrow(RangeError);
    put(rows, 1, 2, "g");
    apply((d, s) => d.setMaze(s, rows));
    expect(e.state.tiles).toEqual(rows);
    expect(() => apply((d, s) => d.setPredatorTravel(s, 12, false))).toThrow(
      RangeError,
    );
    expect(() => apply((d, s) => d.setForagerTile(s, -1, 2))).toThrow(
      RangeError,
    );
    apply((d, s) => d.setScreen(s, "howto"));
    expect(() => apply((d, s) => d.setMenuIndex(s, 0))).toThrow(RangeError);
    expect(e.debug.menuItemRect(e.state, 0)).toBeNull();
  });
});

describe("fixed-step movement and screens", () => {
  it("moves at exactly four tiles per second, stops on release and reverses mid-tile", async () => {
    const { e, key } = await fixture();
    const x = e.state.forager.x;
    key("ArrowRight");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(x + C.TILE);
    key("ArrowRight", false);
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(x + C.TILE);
    expect(e.state.forager.moving).toBe(false);
    key("ArrowRight");
    await e.advance(10);
    const ahead = e.state.forager.x;
    key("ArrowRight", false);
    key("ArrowLeft");
    await e.advance(5);
    expect(e.state.forager.x).toBeLessThan(ahead);
    expect(e.state.forager.dir).toBe("left");
  });
  it("buffers a perpendicular turn until the exact junction center", async () => {
    const rows = corridor();
    for (let y = 1; y < 5; y++) put(rows, 12, y, ".");
    const { e, key } = await fixture(rows);
    key("ArrowRight");
    await e.advance(40);
    key("ArrowRight", false);
    key("ArrowUp");
    await e.advance(10);
    expect(e.state.forager.y).toBe(center(12, 5).y);
    await e.advance(20);
    expect(e.state.forager.x).toBeCloseTo(center(12, 5).x);
    expect(e.state.forager.y).toBeLessThan(center(12, 5).y);
  });
  it("keeps a tapped turn buffered while another movement key stays held", async () => {
    const rows = corridor();
    for (let y = 1; y < 5; y++) put(rows, 12, y, ".");
    const { e, key, tap } = await fixture(rows);
    key("ArrowRight");
    await e.advance(40);
    await tap("ArrowUp");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(12, 5).x);
    expect(e.state.forager.y).toBeLessThan(center(12, 5).y);
  });
  it("never enters a neighbor a fixture closes while the body is mid-step", async () => {
    const { e, key, apply } = await fixture();
    key("ArrowRight");
    await e.advance(5);
    const rows = corridor();
    put(rows, 11, 5, "#");
    apply((d, s) => d.setMaze(s, rows));
    const x = e.state.forager.x;
    await e.advance(60);
    expect(e.state.forager.x).toBe(x);
    key("ArrowRight", false);
    key("ArrowLeft");
    await e.advance(20);
    expect(e.state.forager.x).toBeLessThan(x);
  });
  it("carries wrap displacement continuously in one ordinary step", async () => {
    const rows = corridor();
    put(rows, 0, 5, ".");
    put(rows, C.GRID_COLS - 1, 5, ".");
    const { e, key } = await fixture(rows, 0, 5);
    key("ArrowLeft");
    await e.advance(30);
    expect(e.state.forager.x).toBeCloseTo(center(C.GRID_COLS - 1, 5).x);
    expect(e.state.forager.tx).toBe(C.GRID_COLS - 1);
  });
  it("has identical simulation results under differently partitioned frame deltas", async () => {
    const a = await fixture(),
      b = await fixture();
    a.key("ArrowRight");
    b.key("ArrowRight");
    b.e.setClock(new SequenceClock([2, 6, 17, 25]));
    a.e.setClock(new ConstantClock(10));
    await a.e.advance(100);
    await b.e.advance(80);
    expect(a.e.debug.snapshot(a.e.state)).toEqual(
      b.e.debug.snapshot(b.e.state),
    );
  });
  it("retains press edges until a whole tick is available", async () => {
    const { e, tap } = await setup(1);
    await tap("Enter");
    expect(e.state.screen).toBe("title");
    await e.advance(8);
    expect(e.state.screen).toBe("countdown");
  });
  it("runs all menu routes, remembers title selection and freezes paused play", async () => {
    const { e, tap, apply } = await setup();
    await tap("ArrowUp");
    expect(e.state.menuIndex).toBe(1);
    await tap("Enter");
    expect(e.state.screen).toBe("howto");
    await tap("Escape");
    expect(e.state.menuIndex).toBe(1);
    expect(e.state.titleIndex).toBe(1);
    await tap("ArrowDown");
    await tap("Enter");
    expect(e.state.screen).toBe("countdown");
    await e.advance(C.TICK_HZ * 2);
    expect(e.state.screen).toBe("playing");
    await tap("Escape");
    expect(e.state.screen).toBe("paused");
    const world = e.debug.snapshot(e.state);
    await e.advance(60);
    expect(e.state.forager).toEqual(world.forager);
    expect(e.debug.snapshot(e.state).predators).toEqual(world.predators);
    expect(e.state.simTime).toBeGreaterThan(world.simTime);
    await tap("Escape");
    expect(e.state.screen).toBe("playing");
    await tap("KeyP");
    await tap("ArrowDown");
    await tap("Enter");
    expect(e.state.screen).toBe("countdown");
    expect(e.state.score).toBe(0);
    apply((d, s) => d.setScreen(s, "paused"));
    apply((d, s) => d.setMenuIndex(s, 2));
    await tap("Enter");
    expect(e.state.screen).toBe("title");
    apply((d, s) => d.setScreen(s, "gameover"));
    await tap("Escape");
    expect(e.state.screen).toBe("title");
    apply((d, s) => d.setScreen(s, "gameover"));
    await tap("Enter");
    expect(e.state.screen).toBe("countdown");
  });
  it("selects by pointer but confirms only a press and release in the same region", async () => {
    const { e, apply, pointer } = await setup();
    const a = e.debug.menuItemRect(e.state, 0)!,
      b = e.debug.menuItemRect(e.state, 1)!;
    pointer("pointerdown", a.x + 15, a.y + 15);
    pointer("pointerup", b.x + 15, b.y + 15);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    pointer("pointermove", b.x + 15, b.y + 15);
    await e.advance(1);
    expect(e.state.menuIndex).toBe(1);
    pointer("pointerdown", b.x + 15, b.y + 15);
    pointer("pointerup", b.x + 15, b.y + 15);
    await e.advance(1);
    expect(e.state.screen).toBe("howto");
    pointer("pointerdown", 500, 500);
    pointer("pointerup", 510, 510);
    await e.advance(1);
    expect(e.state.screen).toBe("title");
    expect(e.state.titleIndex).toBe(1);
    apply((d, s) => d.setScreen(s, "paused"));
    await e.advance(1);
  });
  it("mirrors the engine mute preference on every screen and preserves it through reset", async () => {
    const { e, tap, apply } = await setup();
    await tap("KeyM");
    expect(e.state.muted).toBe(true);
    apply((d, s) => d.reset(s));
    expect(e.state.muted).toBe(true);
    await tap("KeyM");
    expect(e.state.muted).toBe(false);
  });
});

describe("grazing, sonar, fog and ink", () => {
  it("eats on entry, holds brightness then decays with the specified half-life", async () => {
    const { e, apply, cues } = await fixture();
    apply((d, s) => d.setPlankton(s, 10, 5, true));
    apply((d, s) => d.setPlankton(s, 11, 5, true));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_PLANKTON);
    expect(e.state.brightness).toBe(C.BRIGHT_PER_EAT);
    expect(e.state.brightHold).toBe(C.BRIGHT_HOLD);
    await e.advance(C.TICK_HZ);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    await e.advance(C.TICK_HZ * C.BRIGHT_HALFLIFE);
    expect(e.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
    expect(cues.filter((c) => c === C.CUES.eat)).toHaveLength(1);
  });
  it("clears only by eating the final mote and descends with score and reserves intact", async () => {
    const { e, apply, cues } = await fixture();
    await e.advance(5);
    expect(e.state.screen).toBe("playing");
    apply((d, s) => d.setPlankton(s, 10, 5, true));
    await e.advance(1);
    expect(e.state.screen).toBe("cleared");
    expect(e.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    expect(cues).toContain(C.CUES.descend);
    await e.advance(C.TICK_HZ * 2);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.depth).toBe(2);
    expect(e.state.predators).toHaveLength(4);
    expect(e.state.lives).toBe(C.START_LIVES);
  });
  it("remembers lit ground but does not reveal merely because it is inside the outer circle", async () => {
    const { e, apply } = await fixture();
    await e.advance(1);
    expect(e.state.visibility[5][10]).toBe("l");
    expect(e.state.visibility[5][15]).toBe("u");
    expect(e.state.visibility[4][10]).toBe("l");
    expect(e.state.visibility[3][10]).toBe("u");
    apply((d, s) => d.setForagerTile(s, 25, 5));
    await e.advance(1);
    expect(e.state.visibility[5][10]).toBe("r");
    const n = copy(e.state);
    lighting(n);
    expect(e.state.visibility).toEqual(n.visibility);
  });
  it("floods around corners progressively, marks hunters, and leaves amber entities unresolved", async () => {
    const rows = corridor();
    for (let y = 6; y <= 9; y++) put(rows, 12, y, ".");
    const { e, apply, tap } = await fixture(rows);
    apply((d, s) => d.addPredator(s, "gloamfin", 12, 9));
    apply((d, s) => d.setPredatorMind(s, 0, false));
    apply((d, s) => d.addPredator(s, "lanternjaw", 16, 5));
    apply((d, s) => d.setPredatorMind(s, 1, false));
    await tap("Space");
    expect(e.state.pulses[0].front).toBeLessThan(1);
    expect(e.state.predators[0].lit).toBe(false);
    await e.advance(53);
    expect(e.state.predators[0].lit).toBe(true);
    expect(e.state.predators[1].lit).toBe(false);
    expect(e.state.visibility[9][12]).toBe("l");
    expect(e.state.visibility[9][13]).toBe("l");
    await e.advance(230);
    expect(e.state.predators[0].lit).toBe(false);
    expect(e.state.sonar.ready).toBe(true);
  });
  it("creates a fixed cloud and respects cooldown without repeat casts while held", async () => {
    const { e, apply, key, cues } = await fixture();
    key("ShiftLeft");
    await e.advance(1);
    expect(e.state.inkClouds[0].radius).toBe(C.INK_RADIUS);
    expect(e.state.ink.cooldown).toBe(C.INK_COOLDOWN);
    const x = e.state.inkClouds[0].x;
    apply((d, s) => d.setForagerTile(s, 14, 5));
    await e.advance(10);
    expect(e.state.inkClouds[0].x).toBe(x);
    await e.advance(C.TICK_HZ * C.INK_LIFE);
    expect(e.state.inkClouds).toHaveLength(0);
    expect(cues.filter((c) => c === C.CUES.ink)).toHaveLength(1);
  });
  it("scores frozen drifters and re-arms the gate cadence", async () => {
    const { e, apply } = await fixture();
    apply((d, s) => d.spawnDrifter(s, 10, 5));
    apply((d, s) => d.setDrifterMind(s, 0, false));
    await e.advance(1);
    expect(e.state.score).toBe(C.SCORE_DRIFTER);
    expect(e.state.drifters).toHaveLength(0);
    apply((d, s) => d.reset(s));
    apply((d, s) => d.clearPredators(s));
    apply((d, s) => d.setScreen(s, "playing"));
    apply((d, s) => d.setDrifterIn(s, 0));
    await e.advance(1);
    expect(e.state.drifters).toHaveLength(1);
    expect(e.state.drifterIn).toBe(C.DRIFTER_INTERVAL);
    apply((d, s) => d.setDrifterTravel(s, 0, false));
    const fixed = e.state.drifters[0].x;
    await e.advance(60);
    expect(e.state.drifters[0].x).toBe(fixed);
    apply((d, s) => d.clearDrifters(s));
    expect(e.state.drifters).toHaveLength(0);
  });
});

describe("hunters, release schedule and contact", () => {
  it("scales only roster and sonar range with depth", async () => {
    const { e, apply } = await setup();
    for (let depth = 1; depth <= 7; depth++) {
      apply((d, s) => d.setDepth(s, depth));
      expect(e.state.predators.length).toBe(3 + Math.min(3, depth - 1));
      expect(e.state.sonar.range).toBe(
        Math.max(C.SONAR_RANGE_MIN, C.SONAR_RANGE_BASE - depth + 1),
      );
    }
    expect(e.state.predators.map((p) => p.kind)).toEqual([
      ...C.DEN_ORDER,
      ...C.ROSTER_ADD_ORDER,
    ]);
  });
  it("releases by time slot before the swim out, independent of travel", async () => {
    const { e, apply } = await setup();
    apply((d, s) => d.setScreen(s, "countdown"));
    await e.advance(120);
    expect(e.state.predators.every((p) => !p.released)).toBe(true);
    apply((d, s) => d.setScreen(s, "playing"));
    e.state.predators.forEach((_, i) =>
      apply((d, s) => d.setPredatorTravel(s, i, false)),
    );
    await e.advance(1);
    expect(e.state.predators[0].released).toBe(true);
    expect(e.state.predators[0].state).toBe("den");
    await e.advance(C.TICK_HZ * C.DEN_RELEASE_GAP);
    expect(e.state.predators[1].released).toBe(true);
    expect(e.state.predators[2].released).toBe(false);
  });
  it("holds a den predator out of play on a fixture with no chamber", async () => {
    const { e, apply } = await setup();
    apply((d, s) => d.setMaze(s, corridor()));
    apply((d, s) => d.setScreen(s, "playing"));
    await e.advance(120);
    expect(e.state.predators.every((p) => p.state === "den" && !p.lit)).toBe(
      true,
    );
  });
  it("hunts light, lingers at a lapsed fix, and ink breaks the chase immediately", async () => {
    const { e, apply, tap } = await fixture();
    apply((d, s) => d.addPredator(s, "lanternjaw", 13, 5));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].speed).toBe(C.PREDATOR_SPEED);
    expect(e.state.predators[0].alert).toBe(false);
    apply((d, s) => d.setForagerTile(s, 25, 5));
    await e.advance(120);
    expect(e.state.predators[0].state).toBe("chase");
    await e.advance(121);
    expect(e.state.predators[0].state).toBe("wander");
    expect(e.state.predators[0].speed).toBe(C.DRIFTER_SPEED);
    apply((d, s) => d.setForagerTile(s, 10, 5));
    await e.advance(1);
    await tap("ShiftLeft");
    expect(e.state.predators[0].state).toBe("wander");
  });
  it("separates mind from travel and still catches on a shared tile", async () => {
    const { e, apply, cues } = await fixture();
    apply((d, s) => d.addPredator(s, "flarefish", 12, 5));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].alert).toBe(true);
    apply((d, s) => d.setPredatorMind(s, 0, false));
    const p = { ...e.state.predators[0] };
    await e.advance(30);
    expect(e.state.predators[0].x).toBe(p.x);
    expect(e.state.predators[0].state).toBe(p.state);
    apply((d, s) => d.setForagerTile(s, 12, 5));
    const score = e.state.score;
    await e.advance(1);
    expect(e.state.screen).toBe("countdown");
    expect(e.state.lives).toBe(C.START_LIVES - 1);
    expect(e.state.score).toBe(score);
    expect(cues).toContain(C.CUES.caught);
  });
  it("ends only when contact finds no life in reserve", async () => {
    const { e, apply } = await fixture();
    apply((d, s) => d.setLives(s, 0));
    apply((d, s) => d.addPredator(s, "lanternjaw", 10, 5));
    apply((d, s) => d.setPredatorMind(s, 0, false));
    await e.advance(1);
    expect(e.state.screen).toBe("gameover");
    expect(e.state.lives).toBe(0);
  });
  it("hears through rock, stays silent under close lock, and alerts without travel", async () => {
    const rows = corridor();
    put(rows, 10, 7, ".");
    const { e, apply, tap } = await fixture(rows);
    apply((d, s) => d.addPredator(s, "gloamfin", 10, 7));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await tap("ShiftLeft");
    expect(e.state.predators[0].hearingLock).toBe(true);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
    await e.advance(120);
    expect(e.state.pulses.filter((p) => p.source === "gloamfin")).toHaveLength(
      0,
    );
    apply((d, s) => d.setForagerTile(s, 20, 5));
    await e.advance(1);
    expect(e.state.pulses.some((p) => p.tint === "violet")).toBe(true);
  });
  it("takes a sound fix on arrival, then searches and casts an orange lost-you ping", async () => {
    const { e, apply, tap } = await fixture();
    apply((d, s) => d.addPredator(s, "gloamfin", 16, 5));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await tap("Space");
    expect(e.state.predators[0].state).toBe("wander");
    await e.advance(53);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].alert).toBe(true);
    apply((d, s) => d.setForagerTile(s, 25, 5));
    apply((d, s) => d.setPredatorTile(s, 0, 10, 5));
    await e.advance(1);
    expect(e.state.predators[0].state).toBe("search");
    await e.advance(144);
    expect(e.state.pulses.some((p) => p.tint === "orange")).toBe(true);
    await e.advance(500);
    expect(e.state.predators[0].state).toBe("wander");
  });
  it("paths around obstacles rather than taking a straight line through rock", async () => {
    const rows = layer("#");
    for (let x = 3; x <= 10; x++) {
      put(rows, x, 3, ".");
      put(rows, x, 7, ".");
    }
    for (let y = 3; y <= 7; y++) {
      put(rows, 3, y, ".");
      put(rows, 10, y, ".");
    }
    const { e, apply } = await fixture(rows, 7, 3);
    apply((d, s) => d.addPredator(s, "gloamfin", 7, 7));
    apply((d, s) => d.setPredatorState(s, 0, "chase"));
    const oldY = e.state.predators[0].y;
    await e.advance(30);
    const p = e.state.predators[0];
    expect(p.y).toBe(oldY);
    expect(p.x).not.toBe(center(7, 7).x);
    expect(e.state.tiles[p.ty][p.tx]).toBe(".");
  });
  it("charges and blooms through rock, revealing outside the vision circle", async () => {
    const rows = corridor();
    put(rows, 24, 10, ".");
    const { e, apply, cues } = await fixture(rows, 4, 5);
    apply((d, s) => d.addPredator(s, "flarefish", 24, 10));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await e.advance(C.TICK_HZ * C.FLARE_INTERVAL + 1);
    expect(e.state.predators[0].flareCharging).toBe(true);
    await e.advance(C.TICK_HZ * C.FLARE_CHARGE);
    expect(e.state.predators[0].flaring).toBe(true);
    expect(e.state.predators[0].flareRadius).toBe(C.FLARE_RADIUS);
    expect(e.state.visibility[10][25]).toBe("l");
    expect(cues).toContain(C.CUES.flare);
    await e.advance(C.TICK_HZ * C.FLARE_BLOOM);
    expect(e.state.predators[0].flaring).toBe(false);
    expect(e.state.visibility[10][25]).toBe("r");
  });
  it("drops Gloamfin chase speed at a corner and ramps back to the cap", async () => {
    const rows = corridor();
    for (let y = 6; y <= 9; y++) put(rows, 12, y, ".");
    const { e, apply } = await fixture(rows, 12, 9);
    apply((d, s) => d.addPredator(s, "gloamfin", 10, 5));
    apply((d, s) => d.setPredatorState(s, 0, "chase"));
    await e.advance(1);
    expect(e.state.predators[0].speed).toBe(C.GLOAMFIN_CORNER_SPEED);
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await e.advance(C.TICK_HZ * C.GLOAMFIN_RAMP_TIME);
    expect(e.state.predators[0].speed).toBe(C.GLOAMFIN_CHASE_SPEED);
  });
  it("locks through rock during a bloom and extinguishes the flare immediately", async () => {
    const rows = corridor();
    put(rows, 10, 9, ".");
    const { e, apply } = await fixture(rows);
    apply((d, s) => d.addPredator(s, "flarefish", 10, 9));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await e.advance(C.TICK_HZ * (C.FLARE_INTERVAL + C.FLARE_CHARGE) + 1);
    expect(e.state.predators[0].state).toBe("chase");
    expect(e.state.predators[0].alert).toBe(true);
    expect(e.state.predators[0].flaring).toBe(false);
    expect(e.state.predators[0].flareRadius).toBe(0);
    await e.advance(C.TICK_HZ * C.ALERT_TIME + 1);
    expect(e.state.predators[0].alert).toBe(false);
  });
  it("enemy pings are visible wavefronts but reveal and mark nothing", async () => {
    const { e, apply } = await fixture();
    apply((d, s) => d.addPredator(s, "gloamfin", 20, 5));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    await e.advance(C.TICK_HZ * C.GLOAMFIN_PING_INTERVAL + 1);
    expect(e.state.pulses.some((p) => p.tint === "violet")).toBe(true);
    expect(e.state.visibility[5][20]).toBe("u");
    expect(e.state.predators[0].lit).toBe(false);
  });
  it("renders remembered terrain only inside the circular window", async () => {
    const { e, apply, canvas } = await fixture();
    await e.advance(1);
    apply((d, s) => d.setForagerTile(s, 25, 5));
    await e.advance(1);
    const p = center(10, 5),
      ctx = canvas.getContext("2d");
    const dark = [...ctx.getImageData(p.x / 2, p.y / 2, 1, 1).data];
    expect(dark).toEqual([3, 6, 12, 255]);
    expect(e.state.visibility[5][10]).toBe("r");
    apply((d, s) => d.setForagerTile(s, 15, 5));
    await e.advance(1);
    expect([...ctx.getImageData(p.x / 2, p.y / 2, 1, 1).data]).not.toEqual(
      dark,
    );
    expect(e.state.visibility[5][10]).toBe("r");
  });
  it("keeps the paused maze animation and all world timers frozen", async () => {
    const { e, apply, tap, canvas } = await fixture();
    apply((d, s) => d.spawnDrifter(s, 12, 5));
    await tap("ShiftLeft");
    await tap("KeyP");
    const pixels = canvas.toBuffer("image/png"),
      before = e.debug.snapshot(e.state);
    await e.advance(45);
    expect(canvas.toBuffer("image/png")).toEqual(pixels);
    expect({ ...e.debug.snapshot(e.state), simTime: before.simTime }).toEqual(
      before,
    );
  });
  it("poses every creature control and restores all defaults on reset", async () => {
    const { e, apply } = await fixture();
    apply((d, s) => d.setScore(s, 123));
    apply((d, s) => d.setLives(s, 7));
    apply((d, s) => d.setTitleIndex(s, 1));
    apply((d, s) => d.setForagerDir(s, "down"));
    apply((d, s) => d.setBrightHold(s, C.BRIGHT_HOLD));
    apply((d, s) => d.setBrightness(s, 1));
    apply((d, s) => d.setSonarCooldown(s, 17));
    apply((d, s) => d.setInkCooldown(s, 21));
    apply((d, s) => d.addPredator(s, "lanternjaw", 11, 5));
    apply((d, s) => d.setPredatorDir(s, 0, "left"));
    apply((d, s) => d.setPredatorReleased(s, 0, false));
    apply((d, s) => d.setPredatorMind(s, 0, false));
    apply((d, s) => d.setPredatorTravel(s, 0, false));
    apply((d, s) => d.spawnDrifter(s, 13, 5));
    apply((d, s) => d.setDrifterMind(s, 0, false));
    apply((d, s) => d.setDrifterTravel(s, 0, false));
    const before = e.debug.snapshot(e.state);
    apply((d, s) => d.reconcile(s));
    expect(e.debug.snapshot(e.state)).toEqual(before);
    expect(e.state.score).toBe(123);
    expect(e.state.sonar.cooldown).toBe(17);
    expect(e.state.ink.cooldown).toBe(21);
    apply((d, s) => d.reset(s));
    expect(e.debug.snapshot(e.state)).toEqual(e.debug.snapshot(initial()));
  });
  it("holds an isolated predator stationary forever instead of crossing rock", async () => {
    const rows = corridor();
    put(rows, 20, 10, ".");
    const { e, apply } = await fixture(rows);
    apply((d, s) => d.addPredator(s, "lanternjaw", 20, 10));
    const start = e.state.predators[0].x;
    await e.advance(200);
    expect(e.state.predators[0].x).toBe(start);
    expect(e.state.predators[0].ty).toBe(10);
  });
});
