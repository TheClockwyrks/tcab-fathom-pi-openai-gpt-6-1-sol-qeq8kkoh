import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomSnapshot,
  FathomState,
  Screen,
} from "./types";
import {
  center,
  char,
  copy,
  DIRECTIONS,
  enter,
  initial,
  layer,
  predator,
  put,
  reconcile,
  roster,
} from "./world";

export function menuItems(screen: Screen): readonly string[] {
  return screen === "title"
    ? C.TITLE_ITEMS
    : screen === "paused"
      ? C.PAUSE_ITEMS
      : screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: DeepReadonly<FathomState>, i: number) {
  if (!Number.isInteger(i) || i < 0 || i >= menuItems(s.screen).length)
    return null;
  return {
    x: s.screen === "title" ? 112 : 472,
    y: (s.screen === "title" ? 438 : 396) + i * 58,
    w: 336,
    h: 48,
  };
}
function valid(ok: boolean, label: string): asserts ok {
  if (!ok) throw new RangeError(`Fathom: invalid ${label}`);
}
function number(n: number, min = 0, max = Infinity, whole = false) {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!whole || Number.isInteger(n)),
    "number",
  );
}
function bool(b: boolean) {
  valid(typeof b === "boolean", "boolean");
}
function tile(
  s: DeepReadonly<FathomState>,
  x: number,
  y: number,
  allowed = ".",
) {
  number(x, 0, C.GRID_COLS - 1, true);
  number(y, 0, C.GRID_ROWS - 1, true);
  valid(allowed.includes(char(s, x, y)), "tile");
}
function dir(d: Direction) {
  valid(DIRECTIONS.includes(d), "direction");
}
function subject<T>(list: T[], i: number): T {
  number(i, 0, list.length - 1, true);
  return list[i];
}
const pose = (s: DeepReadonly<FathomState>, f: (n: FathomState) => void) => {
  const n = copy(s);
  f(n);
  return reconcile(n);
};
export function snapshot(s: DeepReadonly<FathomState>): FathomSnapshot {
  const {
    assets: _assets,
    remainder: _remainder,
    playTime: _playTime,
    screenTime: _screenTime,
    seed: _seed,
    desired: _desired,
    held: _held,
    pending: _pending,
    pointerDown: _pointerDown,
    tileMarks: _tileMarks,
    start: _start,
    ...out
  } = copy(s);
  return {
    ...out,
    drifters: out.drifters.map(({ dir: _dir, ...d }) => d),
    predators: out.predators.map(
      ({
        fix: _fix,
        linger: _linger,
        alertLeft: _alertLeft,
        mark: _mark,
        releaseAt: _releaseAt,
        chaseSpeed: _chaseSpeed,
        pingIn: _pingIn,
        lastPing: _lastPing,
        searchTime: _searchTime,
        searchPing: _searchPing,
        flareIn: _flareIn,
        flarePhase: _flarePhase,
        flareFade: _flareFade,
        ...p
      }) => p,
    ),
    pulses: out.pulses.map(({ owner: _owner, caught: _caught, ...p }) => p),
  };
}
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => initial(copy(s).assets, s.muted),
  snapshot,
  reconcile: (s) => reconcile(copy(s)),
  menuItemRect,
  setScreen: (s, screen) =>
    pose(s, (n) => {
      valid(
        [
          "title",
          "howto",
          "countdown",
          "playing",
          "paused",
          "cleared",
          "gameover",
        ].includes(screen),
        "screen",
      );
      enter(n, screen);
    }),
  setMenuIndex: (s, i) =>
    pose(s, (n) => {
      number(i, 0, menuItems(n.screen).length - 1, true);
      n.menuIndex = i;
    }),
  setTitleIndex: (s, i) =>
    pose(s, (n) => {
      number(i, 0, C.TITLE_ITEMS.length - 1, true);
      n.titleIndex = i;
    }),
  setScore: (s, v) =>
    pose(s, (n) => {
      number(v, 0, Infinity, true);
      n.score = v;
    }),
  setLives: (s, v) =>
    pose(s, (n) => {
      number(v, 0, Infinity, true);
      n.lives = v;
    }),
  setDepth: (s, v) =>
    pose(s, (n) => {
      number(v, 1, Infinity, true);
      n.depth = v;
      roster(n);
    }),
  setMaze: (s, rows) =>
    pose(s, (n) => {
      valid(
        Array.isArray(rows) &&
          rows.length === C.GRID_ROWS &&
          rows.every(
            (r) =>
              typeof r === "string" &&
              r.length === C.GRID_COLS &&
              /^[#.gd]+$/.test(r),
          ),
        "maze",
      );
      const gates = rows.join("").split("g").length - 1;
      valid(!rows.some((r) => /[dg]/.test(r)) || gates === 1, "den gate");
      n.tiles = [...rows];
    }),
  setPlankton: (s, x, y, present) =>
    pose(s, (n) => {
      tile(n, x, y);
      bool(present);
      put(n.plankton, x, y, present ? "*" : "-");
    }),
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = layer("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = layer("u");
      n.tileMarks.fill(0);
    }),
  setForagerTile: (s, x, y) =>
    pose(s, (n) => {
      tile(n, x, y);
      Object.assign(n.forager, center(x, y), { moving: false });
      n.held = false;
    }),
  setForagerDir: (s, d) =>
    pose(s, (n) => {
      dir(d);
      n.forager.dir = d;
      n.desired = d;
      n.forager.moving = false;
      n.held = false;
    }),
  setBrightness: (s, v) =>
    pose(s, (n) => {
      number(v, 0, 1);
      n.brightness = v;
    }),
  setBrightHold: (s, v) =>
    pose(s, (n) => {
      number(v, 0, C.BRIGHT_HOLD);
      n.brightHold = v;
    }),
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s, kind, x, y) =>
    pose(s, (n) => {
      valid(C.DEN_ORDER.includes(kind), "kind");
      tile(n, x, y);
      n.predators.push(predator(kind, x, y));
    }),
  setPredatorTile: (s, i, x, y) =>
    pose(s, (n) => {
      tile(n, x, y, ".dg");
      Object.assign(subject(n.predators, i), center(x, y));
    }),
  setPredatorDir: (s, i, d) =>
    pose(s, (n) => {
      dir(d);
      subject(n.predators, i).dir = d;
    }),
  setPredatorState: (s, i, value) =>
    pose(s, (n) => {
      valid(["den", "wander", "chase"].includes(value), "predator state");
      const p = subject(n.predators, i);
      tile(n, p.tx, p.ty, value === "den" ? "dg" : ".");
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = C.LINGER_TIME;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.alert = false;
      p.alertLeft = 0;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      p.flarePhase = 0;
      p.flareIn = C.FLARE_INTERVAL;
      if (p.kind === "flarefish") {
        p.flareCharging = false;
        p.flaring = false;
        p.flareRadius = 0;
      }
    }),
  setPredatorReleased: (s, i, b) =>
    pose(s, (n) => {
      bool(b);
      subject(n.predators, i).released = b;
    }),
  setPredatorMind: (s, i, b) =>
    pose(s, (n) => {
      bool(b);
      subject(n.predators, i).mind = b;
    }),
  setPredatorTravel: (s, i, b) =>
    pose(s, (n) => {
      bool(b);
      subject(n.predators, i).travel = b;
    }),
  spawnDrifter: (s, x, y) =>
    pose(s, (n) => {
      tile(n, x, y);
      n.drifters.push({
        ...center(x, y),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
    }),
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, b) =>
    pose(s, (n) => {
      bool(b);
      subject(n.drifters, i).mind = b;
    }),
  setDrifterTravel: (s, i, b) =>
    pose(s, (n) => {
      bool(b);
      subject(n.drifters, i).travel = b;
    }),
  setDrifterIn: (s, v) =>
    pose(s, (n) => {
      number(v, 0, C.DRIFTER_INTERVAL);
      n.drifterIn = v;
    }),
  setSonarCooldown: (s, v) =>
    pose(s, (n) => {
      number(v);
      n.sonar.cooldown = v;
    }),
  setInkCooldown: (s, v) =>
    pose(s, (n) => {
      number(v);
      n.ink.cooldown = v;
    }),
};
