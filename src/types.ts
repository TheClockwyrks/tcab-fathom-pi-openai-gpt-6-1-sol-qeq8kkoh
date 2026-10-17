import type { DeepReadonly } from "ts-essentials";
import type { ActionName, PredatorKind } from "./constants";

export type Direction = "up" | "down" | "left" | "right";
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";
export type PredatorState = "den" | "wander" | "chase" | "search";
export interface Body {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Direction;
}
export interface Forager extends Body {
  moving: boolean;
}
export interface Drifter extends Body {
  lit: boolean;
  mind: boolean;
  travel: boolean;
}
export interface Predator extends Body {
  kind: PredatorKind;
  state: PredatorState;
  released: boolean;
  mind: boolean;
  travel: boolean;
  speed: number;
  alert: boolean;
  lit: boolean;
  detectRange: number | null;
  hearingRange: number | null;
  hearingLock: boolean | null;
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
  fix: { tx: number; ty: number } | null;
  linger: number;
  alertLeft: number;
  mark: number;
  releaseAt: number | null;
  chaseSpeed: number;
  pingIn: number;
  lastPing: number;
  searchTime: number;
  searchPing: boolean;
  flareIn: number;
  flarePhase: number;
  flareFade: number;
}
export interface Pulse {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  front: number;
  range: number;
  owner: number | null;
  caught: boolean;
}
export interface InkCloud {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}
export interface FathomSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number | null;
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  planktonRemaining: number;
  drifterIn: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  windowRadius: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: Forager;
  drifters: Omit<Drifter, "dir">[];
  predators: Omit<
    Predator,
    | "fix"
    | "linger"
    | "alertLeft"
    | "mark"
    | "releaseAt"
    | "chaseSpeed"
    | "pingIn"
    | "lastPing"
    | "searchTime"
    | "searchPing"
    | "flareIn"
    | "flarePhase"
    | "flareFade"
  >[];
  pulses: Omit<Pulse, "owner" | "caught">[];
  inkClouds: InkCloud[];
  simTime: number;
}
export interface FathomState extends Omit<
  FathomSnapshot,
  "predators" | "drifters" | "pulses"
> {
  predators: Predator[];
  drifters: Drifter[];
  pulses: Pulse[];
  assets: Record<string, ImageBitmap[]>;
  remainder: number;
  playTime: number;
  screenTime: number;
  seed: number;
  desired: Direction;
  held: boolean;
  pending: ActionName[];
  pointerDown: Record<number, number>;
  tileMarks: number[];
  start: { tx: number; ty: number };
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
type S = DeepReadonly<FathomState>;
export interface FathomDebugApi {
  version: number;
  reset(s: S): FathomState;
  snapshot(s: S): FathomSnapshot;
  reconcile(s: S): FathomState;
  setScreen(s: S, screen: Screen): FathomState;
  setMenuIndex(s: S, index: number): FathomState;
  setTitleIndex(s: S, index: number): FathomState;
  menuItemRect(s: S, index: number): Rect | null;
  setScore(s: S, points: number): FathomState;
  setLives(s: S, n: number): FathomState;
  setDepth(s: S, d: number): FathomState;
  setMaze(s: S, rows: string[]): FathomState;
  setPlankton(s: S, tx: number, ty: number, present: boolean): FathomState;
  clearPlankton(s: S): FathomState;
  clearFog(s: S): FathomState;
  setForagerTile(s: S, tx: number, ty: number): FathomState;
  setForagerDir(s: S, dir: Direction): FathomState;
  setBrightness(s: S, g: number): FathomState;
  setBrightHold(s: S, seconds: number): FathomState;
  clearPredators(s: S): FathomState;
  addPredator(s: S, kind: PredatorKind, tx: number, ty: number): FathomState;
  setPredatorTile(s: S, index: number, tx: number, ty: number): FathomState;
  setPredatorDir(s: S, index: number, dir: Direction): FathomState;
  setPredatorState(
    s: S,
    index: number,
    value: Exclude<PredatorState, "search">,
  ): FathomState;
  setPredatorReleased(s: S, index: number, released: boolean): FathomState;
  setPredatorMind(s: S, index: number, enabled: boolean): FathomState;
  setPredatorTravel(s: S, index: number, enabled: boolean): FathomState;
  spawnDrifter(s: S, tx: number, ty: number): FathomState;
  clearDrifters(s: S): FathomState;
  setDrifterMind(s: S, index: number, enabled: boolean): FathomState;
  setDrifterTravel(s: S, index: number, enabled: boolean): FathomState;
  setDrifterIn(s: S, seconds: number): FathomState;
  setSonarCooldown(s: S, seconds: number): FathomState;
  setInkCooldown(s: S, seconds: number): FathomState;
}
