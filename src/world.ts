import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";
import type { Body, Direction, FathomState, Predator, Screen } from "./types";

export const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];
export const vectors: Record<Direction, [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};
export const opposite = (d: Direction): Direction =>
  DIRECTIONS[(DIRECTIONS.indexOf(d) + 2) % DIRECTIONS.length];
export const center = (tx: number, ty: number) => ({
  x: C.GRID_ORIGIN_X + tx * C.TILE + C.TILE / 2,
  y: C.GRID_ORIGIN_Y + ty * C.TILE + C.TILE / 2,
  tx,
  ty,
});
export const tileAt = (b: { x: number; y: number }) => ({
  tx: Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE),
  ty: Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE),
});
export const layer = (ch: string) =>
  Array.from({ length: C.GRID_ROWS }, () => ch.repeat(C.GRID_COLS));
export function put(rows: string[], x: number, y: number, ch: string) {
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
}

/** A symmetric lattice of loops; the only broad chamber is the sealed den. */
export function maze(): string[] {
  const rows = layer("#");
  for (let y = 1; y < C.GRID_ROWS - 1; y++)
    for (let x = 1; x < C.GRID_COLS - 1; x++) {
      if (
        [1, 5, 11, 16].includes(y) ||
        [1, 5, 9, 13, 22, 26, 30, 34].includes(x) ||
        (y === 8 && (x <= 13 || x >= 22))
      )
        put(rows, x, y, ".");
    }
  put(rows, 0, 8, ".");
  put(rows, C.GRID_COLS - 1, 8, ".");
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  return rows;
}
export function copy(s: DeepReadonly<FathomState>): FathomState {
  return {
    ...s,
    assets: s.assets as Record<string, ImageBitmap[]>,
    grid: { ...s.grid },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    drifters: s.drifters.map((d) => ({ ...d })),
    pulses: s.pulses.map((p) => ({ ...p })),
    inkClouds: s.inkClouds.map((i) => ({ ...i })),
    tileMarks: [...s.tileMarks],
    start: { ...s.start },
    pending: [...s.pending],
    pointerDown: { ...s.pointerDown },
  };
}
export function predator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
): Predator {
  return {
    ...center(tx, ty),
    dir: "up",
    kind,
    state: "wander",
    released: true,
    mind: true,
    travel: true,
    speed: C.PREDATOR_SPEED,
    alert: false,
    lit: false,
    detectRange: null,
    hearingRange: null,
    hearingLock: kind === "gloamfin" ? false : null,
    flareCharging: kind === "flarefish" ? false : null,
    flaring: kind === "flarefish" ? false : null,
    flareRadius: kind === "flarefish" ? 0 : null,
    fix: null,
    linger: C.LINGER_TIME,
    alertLeft: 0,
    mark: 0,
    releaseAt: null,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    lastPing: -C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flarePhase: 0,
    flareFade: 0,
  };
}
export function roster(s: FathomState) {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(s.depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  const den: [number, number][] = [];
  s.tiles.forEach((r, y) =>
    [...r].forEach((t, x) => {
      if (t === "d") den.push([x, y]);
    }),
  );
  s.predators = kinds.map((kind, i) => {
    const [x, y] = den[i % den.length] ?? [17, 8];
    return {
      ...predator(kind, x, y),
      state: "den",
      released: false,
      releaseAt: i * C.DEN_RELEASE_GAP,
    };
  });
  s.playTime = 0;
}
export function reconcile(s: FathomState): FathomState {
  Object.assign(s.forager, tileAt(s.forager));
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.reduce(
    (n, r) => n + [...r].filter((c) => c === "*").length,
    0,
  );
  for (const d of s.drifters) Object.assign(d, tileAt(d));
  for (const p of s.predators) {
    Object.assign(p, tileAt(p));
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
  }
  return s;
}
export function initial(
  assets: Record<string, ImageBitmap[]> = {},
  muted = false,
): FathomState {
  const tiles = maze();
  const s: FathomState = {
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((r) =>
      [...r].map((c) => (c === "." ? "*" : "-")).join(""),
    ),
    visibility: layer("u"),
    forager: { ...center(17, 16), dir: "left", moving: false },
    predators: [],
    drifters: [],
    pulses: [],
    inkClouds: [],
    simTime: 0,
    assets,
    remainder: 0,
    playTime: 0,
    screenTime: 0,
    seed: 62951,
    desired: "left",
    held: false,
    pending: [],
    pointerDown: {},
    tileMarks: Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(0),
    start: { tx: 17, ty: 16 },
  };
  roster(s);
  return reconcile(s);
}
export function enter(s: FathomState, screen: Screen) {
  if (screen === "playing" && s.screen !== "paused" && s.screen !== "playing")
    s.playTime = 0;
  s.screen = screen;
  s.screenTime = 0;
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : ["paused", "gameover"].includes(screen)
        ? 0
        : null;
}
export function attempt(s: FathomState) {
  s.forager = { ...center(s.start.tx, s.start.ty), dir: "left", moving: false };
  s.desired = "left";
  s.held = false;
  s.brightness = 0;
  s.brightHold = 0;
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.tileMarks.fill(0);
  roster(s);
  enter(s, "countdown");
  reconcile(s);
}
export function fresh(s: FathomState, screen: Screen): FathomState {
  const n = initial(s.assets, s.muted);
  n.titleIndex = s.titleIndex;
  n.simTime = s.simTime;
  n.remainder = s.remainder;
  enter(n, screen);
  return n;
}
export const char = (s: DeepReadonly<FathomState>, x: number, y: number) =>
  s.tiles[y]?.[x] ?? "#";
export const open = (
  s: DeepReadonly<FathomState>,
  x: number,
  y: number,
  den = false,
) => (den ? ".dg".includes(char(s, x, y)) : char(s, x, y) === ".");
export function neighbor(
  s: DeepReadonly<FathomState>,
  x: number,
  y: number,
  dir: Direction,
): [number, number] {
  const [dx, dy] = vectors[dir];
  let nx = x + dx;
  const wrap = s.tiles.findIndex(
    (r) => r[0] === "." && r[C.GRID_COLS - 1] === ".",
  );
  if (y === wrap && dy === 0) nx = (nx + C.GRID_COLS) % C.GRID_COLS;
  return [nx, y + dy];
}
export const exits = (
  s: DeepReadonly<FathomState>,
  b: { tx: number; ty: number },
  den = false,
) => DIRECTIONS.filter((d) => open(s, ...neighbor(s, b.tx, b.ty, d), den));
export function random(s: FathomState): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}
export function wander(s: FathomState, b: Body, den = false): Direction {
  const all = exits(s, b, den),
    choices = all.filter((d) => d !== opposite(b.dir));
  const use = choices.length ? choices : all;
  return use[Math.floor(random(s) * use.length)] ?? b.dir;
}
export function distances(
  s: DeepReadonly<FathomState>,
  tx: number,
  ty: number,
  den = false,
): number[] {
  const out = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(Infinity);
  if (!open(s, tx, ty, den)) return out;
  out[ty * C.GRID_COLS + tx] = 0;
  const queue: [number, number][] = [[tx, ty]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const d of DIRECTIONS) {
      const [nx, ny] = neighbor(s, x, y, d),
        k = ny * C.GRID_COLS + nx;
      if (open(s, nx, ny, den) && out[k] === Infinity) {
        out[k] = out[y * C.GRID_COLS + x] + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return out;
}
export function route(
  s: FathomState,
  b: Body,
  target: { tx: number; ty: number },
  den = false,
): Direction | null {
  if (b.tx === target.tx && b.ty === target.ty) return null;
  const ds = distances(s, target.tx, target.ty, den);
  let best = Infinity,
    dir: Direction | null = null;
  for (const d of exits(s, b, den)) {
    const [x, y] = neighbor(s, b.tx, b.ty, d);
    if (ds[y * C.GRID_COLS + x] < best) {
      best = ds[y * C.GRID_COLS + x];
      dir = d;
    }
  }
  return dir;
}
/** Consume a distance in center-to-center segments, preserving overshoot and wrap. */
export function move(
  s: FathomState,
  b: Body,
  distance: number,
  choose: () => Direction | null,
  den = false,
): boolean {
  if (!open(s, b.tx, b.ty, den)) return false;
  let moved = false;
  while (distance > 1e-8) {
    const c = center(b.tx, b.ty),
      atCenter = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (atCenter) {
      const dir = choose();
      if (!dir || !open(s, ...neighbor(s, b.tx, b.ty, dir), den)) break;
      b.dir = dir;
    }
    const [dx, dy] = vectors[b.dir];
    let toCenter = dx ? (c.x - b.x) * dx : (c.y - b.y) * dy;
    if (toCenter <= 1e-7) {
      // A fixture can close the next cell while a body is between centers.
      if (!open(s, ...neighbor(s, b.tx, b.ty, b.dir), den)) break;
      toCenter += C.TILE;
    }
    const step = Math.min(distance, toCenter);
    b.x += dx * step;
    b.y += dy * step;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    Object.assign(b, tileAt(b));
    distance -= step;
    moved = true;
  }
  return moved;
}
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y);
export const sameTile = (
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
) => a.tx === b.tx && a.ty === b.ty;
/** Exact grid traversal: a rock face is visible, but never the cells behind it. */
export function lineOfSight(
  s: DeepReadonly<FathomState>,
  a: { x: number; y: number },
  b: { x: number; y: number },
  landingRock = false,
): boolean {
  const start = tileAt(a),
    target = tileAt(b),
    dx = b.x - a.x,
    dy = b.y - a.y;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  let x = start.tx,
    y = start.ty;
  const stepX = dx ? C.TILE / Math.abs(dx) : Infinity,
    stepY = dy ? C.TILE / Math.abs(dy) : Infinity;
  let nextX = dx
    ? (C.GRID_ORIGIN_X + (x + (sx > 0 ? 1 : 0)) * C.TILE - a.x) / dx
    : Infinity;
  let nextY = dy
    ? (C.GRID_ORIGIN_Y + (y + (sy > 0 ? 1 : 0)) * C.TILE - a.y) / dy
    : Infinity;
  for (;;) {
    const atTarget = x === target.tx && y === target.ty;
    if (char(s, x, y) === "#" && !(landingRock && atTarget)) return false;
    if (atTarget) return true;
    if (Math.abs(nextX - nextY) < 1e-12) {
      x += sx;
      y += sy;
      nextX += stepX;
      nextY += stepY;
    } else if (nextX < nextY) {
      x += sx;
      nextX += stepX;
    } else {
      y += sy;
      nextY += stepY;
    }
  }
}
export function segmentDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = dx * dx + dy * dy;
  const t = len
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
