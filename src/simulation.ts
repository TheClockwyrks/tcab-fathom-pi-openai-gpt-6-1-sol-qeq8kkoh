import type { DeepReadonly } from "ts-essentials";
import type { UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { FathomState, Predator, Pulse } from "./types";
import { menuItemRect, menuItems } from "./debug";
import {
  attempt,
  center,
  char,
  copy,
  DIRECTIONS,
  distance,
  distances,
  enter,
  exits,
  fresh,
  initial,
  lineOfSight,
  move,
  neighbor,
  open,
  opposite,
  put,
  random,
  reconcile,
  route,
  sameTile,
  segmentDistance,
  wander,
} from "./world";

const down = (v: number, dt = C.TICK_DT) => Math.max(0, v - dt);
type Cues = Set<C.CueName>;
export function acquire(s: FathomState, p: Predator) {
  if (p.state !== "chase") {
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    if (p.kind !== "lanternjaw") {
      p.alertLeft = C.ALERT_TIME;
      p.alert = true;
    }
  }
  p.state = "chase";
  p.fix = { tx: s.forager.tx, ty: s.forager.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    p.flarePhase = 0;
    p.flareFade = 0;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
  }
}
function drop(p: Predator) {
  p.state = "wander";
  p.fix = null;
  p.flareIn = C.FLARE_INTERVAL;
  if (p.kind === "flarefish") {
    p.flarePhase = 0;
    p.flaring = false;
    p.flareCharging = false;
    p.flareRadius = 0;
  }
}
function cast(s: FathomState, owner: number | null, tint: Pulse["tint"]) {
  const b = owner === null ? s.forager : s.predators[owner];
  s.pulses.push({
    source: owner === null ? "forager" : "gloamfin",
    tint,
    ox: b.tx,
    oy: b.ty,
    front: -1e-7,
    range: owner === null ? s.sonar.range : C.GLOAMFIN_PING_RANGE,
    owner,
    caught: false,
  });
}
function ping(
  s: FathomState,
  p: Predator,
  index: number,
  tint: Pulse["tint"],
  cues: Cues,
) {
  cast(s, index, tint);
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.lastPing = s.playTime;
  cues.add(C.CUES.predatorPing);
}
function hunter(s: FathomState, p: Predator, index: number, cues: Cues) {
  if (!p.mind) return;
  p.alertLeft = down(p.alertLeft);
  p.alert = p.alertLeft > 0;
  if (p.state === "den") {
    const gateY = s.tiles.findIndex((r) => r.includes("g"));
    if (!s.tiles.some((r) => r.includes("d")) || gateY < 0 || !p.released)
      return;
    const gateX = s.tiles[gateY].indexOf("g"),
      target = { tx: gateX, ty: gateY - 1 };
    if (p.travel)
      move(s, p, p.speed * C.TICK_DT, () => route(s, p, target, true), true);
    if (char(s, p.tx, p.ty) === ".") p.state = "wander";
    return;
  }
  if (p.kind === "gloamfin") {
    const wasLock = p.hearingLock;
    p.hearingLock = distance(p, s.forager) <= C.GLOAMFIN_HEAR;
    p.pingIn = down(p.pingIn);
    if (p.hearingLock) {
      acquire(s, p);
      p.pingIn = 0;
    } else {
      if (wasLock) p.pingIn = 0;
      if (
        p.state === "chase" &&
        p.fix &&
        sameTile(p, p.fix) &&
        !sameTile(p, s.forager)
      ) {
        p.state = "search";
        p.searchTime = 0;
        p.searchPing = false;
      }
      if (p.state === "search") {
        p.searchTime += C.TICK_DT;
        if (p.searchTime >= C.GLOAMFIN_GIVEUP) drop(p);
      }
      const ready = s.playTime - p.lastPing >= C.GLOAMFIN_PING_MIN_GAP - 1e-8;
      if (
        p.state === "search" &&
        !p.searchPing &&
        p.searchTime >= C.GLOAMFIN_SEARCH_DELAY &&
        ready
      ) {
        ping(s, p, index, "orange", cues);
        p.searchPing = true;
      } else if (p.pingIn <= 1e-8 && ready) ping(s, p, index, "violet", cues);
    }
    if (p.state === "chase")
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
            C.GLOAMFIN_RAMP_TIME,
      );
  } else {
    const blinded = s.inkClouds.some(
      (i) => segmentDistance(p, s.forager, i) <= i.radius,
    );
    const sense =
      !blinded &&
      distance(p, s.forager) <= (p.detectRange ?? 0) &&
      lineOfSight(s, p, s.forager);
    const bloomLock =
      p.kind === "flarefish" &&
      p.flaring &&
      !blinded &&
      distance(p, s.forager) <= C.FLARE_RADIUS;
    if (blinded) {
      if (p.state === "chase") drop(p);
    } else if (sense || bloomLock) acquire(s, p);
    else if (p.state === "chase") {
      p.linger = down(p.linger);
      if (p.linger <= 1e-8) drop(p);
    }
    if (p.kind === "flarefish") {
      p.flareFade = down(p.flareFade);
      if (p.state === "wander") {
        if (!p.flarePhase) {
          p.flareIn = down(p.flareIn);
          if (p.flareIn <= 1e-8) p.flarePhase = 1e-7;
        } else {
          const before = p.flarePhase;
          p.flarePhase += C.TICK_DT;
          if (before < C.FLARE_CHARGE && p.flarePhase >= C.FLARE_CHARGE)
            cues.add(C.CUES.flare);
          if (p.flarePhase >= C.FLARE_CHARGE + C.FLARE_BLOOM) {
            p.flarePhase = 0;
            p.flareIn = C.FLARE_INTERVAL;
            p.flareFade = 0.35;
          }
        }
      }
      p.flareCharging = p.flarePhase > 0 && p.flarePhase < C.FLARE_CHARGE;
      p.flaring = p.flarePhase >= C.FLARE_CHARGE;
      p.flareRadius = p.flaring ? C.FLARE_RADIUS : 0;
      // The bloom is a continuous sense, including its first tick.
      if (p.flaring && !blinded && distance(p, s.forager) <= C.FLARE_RADIUS)
        acquire(s, p);
    }
  }
  reconcile(s);
  if (p.travel) {
    if (p.state === "chase" && p.fix) {
      const d = route(s, p, p.fix);
      if (d === opposite(p.dir)) p.dir = d;
    }
    const old = p.dir;
    move(s, p, p.speed * C.TICK_DT, () => {
      let d = p.state === "chase" && p.fix ? route(s, p, p.fix) : null;
      if (p.state === "search" && p.fix) {
        const ds = distances(s, p.fix.tx, p.fix.ty);
        const nearby = exits(s, p).filter((dir) => {
          const [x, y] = neighbor(s, p.tx, p.ty, dir);
          return ds[y * C.GRID_COLS + x] <= C.GLOAMFIN_SEARCH_ROAM;
        });
        const onward = nearby.filter((dir) => dir !== opposite(p.dir));
        const choices = onward.length ? onward : nearby;
        d =
          choices[Math.floor(random(s) * choices.length)] ?? route(s, p, p.fix);
      } else if (p.state !== "chase") d = wander(s, p);
      if (
        p.kind === "gloamfin" &&
        p.state === "chase" &&
        d &&
        d !== p.dir &&
        d !== opposite(p.dir)
      )
        p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
      return d;
    });
    if (
      p.kind === "gloamfin" &&
      p.state === "chase" &&
      old !== p.dir &&
      opposite(old) !== p.dir
    )
      p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
  }
}
function wavefronts(s: FathomState) {
  for (const pulse of s.pulses) {
    const prev = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const ds = distances(s, pulse.ox, pulse.oy, true);
    const arrived = (x: number, y: number) => {
      const d = ds[y * C.GRID_COLS + x];
      return d > prev && d <= pulse.front && d <= pulse.range;
    };
    if (pulse.source === "forager") {
      for (let y = 0; y < C.GRID_ROWS; y++)
        for (let x = 0; x < C.GRID_COLS; x++)
          if (arrived(x, y)) {
            s.tileMarks[y * C.GRID_COLS + x] = C.SONAR_MARK_TIME;
            for (const d of DIRECTIONS) {
              const [nx, ny] = neighbor(s, x, y, d);
              if (
                nx >= 0 &&
                nx < C.GRID_COLS &&
                ny >= 0 &&
                ny < C.GRID_ROWS &&
                char(s, nx, ny) === "#"
              )
                s.tileMarks[ny * C.GRID_COLS + nx] = C.SONAR_MARK_TIME;
            }
          }
      for (const p of s.predators)
        if (p.state !== "den" && arrived(p.tx, p.ty)) {
          if (p.kind !== "lanternjaw") p.mark = C.SONAR_MARK_TIME;
          if (p.kind === "gloamfin" && p.mind) acquire(s, p);
        }
    } else if (!pulse.caught && arrived(s.forager.tx, s.forager.ty)) {
      pulse.caught = true;
      const p = pulse.owner === null ? undefined : s.predators[pulse.owner];
      if (p?.mind && p.state !== "den") acquire(s, p);
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
function controls(s: FathomState): FathomState {
  const has = (a: C.ActionName) => s.pending.includes(a);
  s.pending = [...s.pending];
  if (s.screen === "playing") {
    if (has("pause")) enter(s, "paused");
  } else if (s.screen === "paused" && (has("pause") || has("back")))
    enter(s, "playing");
  else if (s.screen === "howto") {
    if (has("confirm") || has("back")) return fresh(s, "title");
  } else if (menuItems(s.screen).length) {
    const items = menuItems(s.screen);
    if (has("up"))
      s.menuIndex = ((s.menuIndex ?? 0) + items.length - 1) % items.length;
    if (has("down")) s.menuIndex = ((s.menuIndex ?? 0) + 1) % items.length;
    if (s.screen === "gameover" && has("back")) return fresh(s, "title");
    if (has("confirm")) {
      if (s.screen === "title") {
        s.titleIndex = s.menuIndex ?? 0;
        if (s.menuIndex === 0) return fresh(s, "countdown");
        enter(s, "howto");
      } else if (s.screen === "paused") {
        if (s.menuIndex === 0) enter(s, "playing");
        else return fresh(s, s.menuIndex === 1 ? "countdown" : "title");
      } else return fresh(s, s.menuIndex === 0 ? "countdown" : "title");
    }
  }
  return s;
}
function tick(input: FathomState, cues: Cues): FathomState {
  let s = input;
  const was = s.screen;
  s.simTime += C.TICK_DT;
  if (s.screen === "countdown" || s.screen === "cleared")
    s.screenTime += C.TICK_DT;
  s = controls(s);
  const edges = [...s.pending];
  s.pending = [];
  if (s.screen === "countdown") {
    if (s.screenTime >= 2 - 1e-8) {
      enter(s, "playing");
      for (const p of s.predators) if (p.releaseAt === 0) p.released = true;
    }
    return s;
  }
  if (s.screen === "cleared") {
    if (s.screenTime >= 2 - 1e-8) {
      const n = initial(s.assets, s.muted);
      n.depth = s.depth + 1;
      n.score = s.score;
      n.lives = s.lives;
      n.titleIndex = s.titleIndex;
      n.simTime = s.simTime;
      n.remainder = s.remainder;
      attempt(n);
      return n;
    }
    return s;
  }
  if (s.screen !== "playing" || was !== "playing") return s;
  s.sonar.cooldown = down(s.sonar.cooldown);
  s.ink.cooldown = down(s.ink.cooldown);
  if (s.sonar.cooldown < 1e-8) s.sonar.cooldown = 0;
  if (s.ink.cooldown < 1e-8) s.ink.cooldown = 0;
  const decayTime = Math.max(0, C.TICK_DT - s.brightHold);
  s.brightHold = down(s.brightHold);
  s.brightness *= 0.5 ** (decayTime / C.BRIGHT_HALFLIFE);
  s.tileMarks = s.tileMarks.map((t) => down(t));
  s.inkClouds = s.inkClouds
    .map((i) => ({ ...i, remaining: down(i.remaining) }))
    .filter((i) => i.remaining > 1e-8);
  for (const p of s.predators) p.mark = down(p.mark);
  reconcile(s);
  if (edges.includes("a") && s.sonar.ready) {
    cast(s, null, "cyan");
    s.sonar.cooldown = C.SONAR_COOLDOWN;
    cues.add(C.CUES.sonar);
  }
  if (edges.includes("b") && s.ink.ready) {
    s.inkClouds.push({
      x: s.forager.x,
      y: s.forager.y,
      radius: C.INK_RADIUS,
      remaining: C.INK_LIFE,
    });
    s.ink.cooldown = C.INK_COOLDOWN;
    cues.add(C.CUES.ink);
  }
  const f = s.forager;
  if (s.held) {
    if (s.desired === opposite(f.dir)) f.dir = s.desired;
    f.moving = move(s, f, C.FORAGER_SPEED * C.TICK_DT, () =>
      open(s, ...neighbor(s, f.tx, f.ty, s.desired))
        ? s.desired
        : open(s, ...neighbor(s, f.tx, f.ty, f.dir))
          ? f.dir
          : null,
    );
  } else f.moving = false;
  if (s.plankton[f.ty]?.[f.tx] === "*" && char(s, f.tx, f.ty) === ".") {
    put(s.plankton, f.tx, f.ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (!s.planktonRemaining) {
      s.score += C.SCORE_CLEAR;
      enter(s, "cleared");
      cues.add(C.CUES.descend);
      return s;
    }
  }
  reconcile(s);
  s.predators.forEach((p, i) => {
    if (!p.released && p.releaseAt !== null && s.playTime >= p.releaseAt - 1e-8)
      p.released = true;
    hunter(s, p, i, cues);
  });
  wavefronts(s);
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn <= 1e-8 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const gy = s.tiles.findIndex((r) => r.includes("g")),
      gx = gy < 0 ? -1 : s.tiles[gy].indexOf("g");
    if (gy > 0 && open(s, gx, gy - 1)) {
      s.drifters.push({
        ...center(gx, gy - 1),
        dir: "up",
        lit: false,
        mind: true,
        travel: true,
      });
      s.drifterIn = C.DRIFTER_INTERVAL;
    }
  }
  for (const d of s.drifters)
    if (d.mind && d.travel)
      move(s, d, C.DRIFTER_SPEED * C.TICK_DT, () => wander(s, d));
  s.drifters = s.drifters.filter((d) => {
    if (sameTile(d, f)) {
      s.score += C.SCORE_DRIFTER;
      return false;
    }
    return true;
  });
  if (s.predators.some((p) => p.state !== "den" && sameTile(p, f))) {
    cues.add(C.CUES.caught);
    if (s.lives > 0) {
      s.lives--;
      attempt(s);
    } else enter(s, "gameover");
  }
  if (s.screen === "playing") s.playTime += C.TICK_DT;
  return s;
}
/** Lighting is a read of this frame's world, never a renderer side effect. */
export function lighting(s: FathomState) {
  if (s.screen !== "playing" && s.screen !== "countdown") return;
  const flares = s.predators.filter((p) => p.state !== "den" && p.flaring);
  for (let y = 0; y < C.GRID_ROWS; y++) {
    let row = "";
    for (let x = 0; x < C.GRID_COLS; x++) {
      const c = center(x, y),
        passive =
          distance(c, s.forager) <= s.visionRadius &&
          lineOfSight(s, s.forager, c, true);
      const lit =
        passive ||
        s.tileMarks[y * C.GRID_COLS + x] > 0 ||
        flares.some((p) => distance(p, c) <= C.FLARE_RADIUS);
      row += lit ? "l" : s.visibility[y][x] === "u" ? "u" : "r";
    }
    s.visibility[y] = row;
  }
  const bodyLight = (b: { x: number; y: number }) =>
    (distance(b, s.forager) <= s.visionRadius &&
      lineOfSight(s, s.forager, b)) ||
    flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (const p of s.predators)
    p.lit =
      p.state !== "den" &&
      (bodyLight(p) || p.mark > 0 || p.alert || !!p.flareCharging);
  for (const d of s.drifters) d.lit = bodyLight(d);
}
export function update(
  state: DeepReadonly<FathomState>,
  api: UpdateApi,
  dt: number,
): FathomState {
  let s = copy(state);
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  for (const a of C.ACTIONS)
    if (a !== "mute" && api.input.pressed(a)) {
      if (!s.pending.includes(a)) s.pending.push(a);
      if (DIRECTIONS.includes(a as typeof s.desired))
        s.desired = a as typeof s.desired;
    }
  const held = DIRECTIONS.filter((d) => api.input.value(d) > 0);
  s.held = held.length > 0;
  for (const sample of api.input.pointerSamples()) {
    if (!sample.primary) continue;
    const items = menuItems(s.screen);
    const index = items.findIndex((_, i) => {
      const r = menuItemRect(s, i);
      return (
        r &&
        sample.x >= r.x &&
        sample.x <= r.x + r.w &&
        sample.y >= r.y &&
        sample.y <= r.y + r.h
      );
    });
    if (index >= 0 && (sample.type === "move" || sample.type === "down"))
      s.menuIndex = index;
    if (sample.type === "down")
      s.pointerDown[sample.id] = s.screen === "howto" ? -2 : index;
    if (sample.type === "up") {
      const pressed = s.pointerDown[sample.id];
      if (
        (index >= 0 && pressed === index) ||
        (s.screen === "howto" && pressed === -2)
      ) {
        if (index >= 0) s.menuIndex = index;
        s.pending.push("confirm");
      }
      delete s.pointerDown[sample.id];
    }
  }
  lighting(s);
  s.remainder += Math.max(0, dt);
  while (s.remainder + 1e-10 >= C.TICK_DT) {
    s.remainder -= C.TICK_DT;
    if (s.remainder < 0) s.remainder = 0;
    const cues: Cues = new Set();
    s = tick(s, cues);
    reconcile(s);
    lighting(s);
    for (const cue of cues) api.audio.play(cue);
  }
  reconcile(s);
  lighting(s);
  return s;
}
