import type { DeepReadonly } from "ts-essentials";
import type { RenderApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { Direction, FathomState } from "./types";
import { menuItemRect, menuItems } from "./debug";
import {
  center,
  char,
  DIRECTIONS,
  distances,
  distance,
  lineOfSight,
  neighbor,
} from "./world";

export const BACKGROUND = "#03060c";
const CYAN = "#86f6e5",
  DIM = "#64838b",
  WHITE = "#dff7f2",
  AMBER = "#ff9968";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
type State = DeepReadonly<FathomState>;
type Ctx = CanvasRenderingContext2D;
function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size = 16,
  color = WHITE,
  align: CanvasTextAlign = "left",
) {
  ctx.font = `${size >= 40 ? "bold " : ""}${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}
function tracked(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  spacing: number,
  color = DIM,
) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  for (const letter of value) {
    ctx.fillText(letter, x, y);
    x += ctx.measureText(letter).width + spacing;
  }
}
function line(
  ctx: Ctx,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#17333b",
  width = 1,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function disc(ctx: Ctx, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function ring(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  color = "#17333b",
  width = 1,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
function glow(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 0.25,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "transparent");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}
function sprite(
  ctx: Ctx,
  s: State,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
) {
  const image = s.assets[sheet]?.[frame];
  if (image) ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
}
const facing = (d: Direction) => ({ down: 0, up: 2, left: 4, right: 6 })[d];
function tileFrame(s: State, x: number, y: number) {
  const t = char(s, x, y);
  if (t === "g") return 18;
  if (t !== "#") return 16;
  return DIRECTIONS.reduce((mask, d, i) => {
    const [nx, ny] = neighbor(s, x, y, d);
    return mask + (char(s, nx, ny) === "#" ? 1 << i : 0);
  }, 0);
}
function terrain(ctx: Ctx, s: State, all = false) {
  for (let y = 0; y < C.GRID_ROWS; y++)
    for (let x = 0; x < C.GRID_COLS; x++) {
      const v = all ? "l" : s.visibility[y][x];
      const c = center(x, y);
      if (v === "u") continue;
      ctx.globalAlpha = v === "r" ? 0.26 : 1;
      sprite(ctx, s, "trench-walls", tileFrame(s, x, y), c.x, c.y);
      if (s.plankton[y][x] === "*") {
        ctx.fillStyle = v === "r" ? "#5f9691" : "#a9e3cf";
        ctx.shadowColor = "#75f5c8";
        ctx.shadowBlur = v === "r" ? 0 : 7;
        ctx.beginPath();
        ctx.arc(c.x, c.y, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
  ctx.globalAlpha = 1;
}
function amber(ctx: Ctx, x: number, y: number) {
  glow(ctx, x, y, 20, "#ff773d", 0.4);
  disc(ctx, x, y, 3, AMBER);
  disc(ctx, x, y, 1.2, "#ffe6b3");
}
function drawMaze(ctx: Ctx, s: State) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  // The flat fog sheet repeats at its native tile size underneath all reveals.
  const fog = s.assets["trench-walls"]?.[17];
  ctx.fillStyle = fog
    ? (ctx.createPattern(fog, "repeat") ?? BACKGROUND)
    : BACKGROUND;
  ctx.fillRect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  for (const p of s.predators)
    if (p.flaring && p.state !== "den") {
      ctx.moveTo(p.x + C.FLARE_RADIUS, p.y);
      ctx.arc(p.x, p.y, C.FLARE_RADIUS, 0, Math.PI * 2);
    }
  ctx.clip();
  terrain(ctx, s);
  glow(ctx, s.forager.x, s.forager.y, s.windowRadius, "#247f87", 0.15);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(s.forager.x, s.forager.y, s.windowRadius, 0, Math.PI * 2);
  ctx.clip();
  for (const d of s.drifters) amber(ctx, d.x, d.y);
  for (const p of s.predators)
    if (p.kind === "lanternjaw" && p.state !== "den") amber(ctx, p.x, p.y);
  ctx.restore();
  for (const cloud of s.inkClouds) {
    const g = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      cloud.radius * 0.65,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    g.addColorStop(0, "#000106f5");
    g.addColorStop(1, "#00010600");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
    ring(ctx, cloud.x, cloud.y, cloud.radius * 0.88, "#1b243650");
  }
  for (const pulse of s.pulses) {
    const ds = distances(s, pulse.ox, pulse.oy, true),
      tint =
        pulse.tint === "cyan"
          ? CYAN
          : pulse.tint === "violet"
            ? "#b8a2ff"
            : "#ffa35b";
    ctx.shadowColor = tint;
    ctx.shadowBlur = 12;
    for (let y = 0; y < C.GRID_ROWS; y++)
      for (let x = 0; x < C.GRID_COLS; x++) {
        const d = ds[y * C.GRID_COLS + x],
          age = pulse.front - d;
        if (d > pulse.range || age < -0.8 || age > 1.4) continue;
        const c = center(x, y);
        ctx.globalAlpha = Math.max(0, 1 - Math.abs(age) / 1.5);
        ctx.fillStyle = tint;
        ctx.fillRect(c.x - 6, c.y - 6, 12, 12);
        for (const dir of DIRECTIONS) {
          const [nx, ny] = neighbor(s, x, y, dir);
          if (Math.abs(nx - x) > 1) continue;
          if (ds[ny * C.GRID_COLS + nx] === d - 1) {
            const p = center(nx, ny);
            line(ctx, c.x, c.y, p.x, p.y, tint, 3);
          }
        }
      }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
  const cycle = Math.floor(s.playTime * 8);
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.flareCharging || p.flaring || p.flareFade > 0) {
      const f = p.flareCharging
        ? Math.min(2, Math.floor((p.flarePhase / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 +
            Math.min(
              2,
              Math.floor(((p.flarePhase - C.FLARE_CHARGE) / C.FLARE_BLOOM) * 3),
            )
          : p.flareFade > 0.175
            ? 6
            : 7;
      sprite(ctx, s, "flare-bloom", f, p.x, p.y, C.FLARE_RADIUS * 2);
    }
    if (p.lit) {
      const liveLight =
        (distance(p, s.forager) <= s.visionRadius &&
          lineOfSight(s, s.forager, p)) ||
        s.predators.some((f) => f.flaring && distance(f, p) <= C.FLARE_RADIUS);
      ctx.globalAlpha =
        p.mark > 0 && !p.alert && !p.flareCharging && !liveLight
          ? p.mark / C.SONAR_MARK_TIME
          : 1;
      const beat = p.mind && p.travel ? cycle : 0;
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (beat % 8)
          : facing(p.dir) + (beat % 2);
      sprite(ctx, s, p.kind, frame, p.x, p.y);
      ctx.globalAlpha = 1;
    }
    if (p.alert) {
      const color = p.kind === "gloamfin" ? "#c5a6ff" : "#ffb077",
        progress = 1 - p.alertLeft / C.ALERT_TIME;
      ctx.globalAlpha = 1 - progress;
      ring(ctx, p.x, p.y, 15 + progress * 24, color, 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4,
          r = 20 + progress * 20;
        line(
          ctx,
          p.x + Math.cos(a) * r,
          p.y + Math.sin(a) * r,
          p.x + Math.cos(a) * (r + 9),
          p.y + Math.sin(a) * (r + 9),
          color,
          2,
        );
      }
      ctx.globalAlpha = 1;
    }
  }
  for (const d of s.drifters)
    if (d.lit)
      sprite(ctx, s, "drifter", d.mind && d.travel ? cycle % 8 : 0, d.x, d.y);
  glow(ctx, s.forager.x, s.forager.y, 40, CYAN, 0.3);
  sprite(
    ctx,
    s,
    "glimmerfin",
    facing(s.forager.dir) +
      (s.forager.moving ? Math.floor(s.playTime * 9) % 2 : 0),
    s.forager.x,
    s.forager.y,
  );
  ctx.restore();
  // Subtle survey marks frame the water, never disclose hidden tiles.
  for (let i = 0; i <= C.GRID_COLS; i += 3) {
    const x = C.GRID_ORIGIN_X + i * C.TILE;
    line(ctx, x, 75, x, 79, "#24454a");
  }
  line(ctx, 64, 72, 1216, 72);
  line(ctx, 64, 663, 1216, 663);
}
function gauge(
  ctx: Ctx,
  x: number,
  label: string,
  key: string,
  cooldown: number,
  max: number,
) {
  text(ctx, key, x, 684, 12, DIM);
  text(ctx, label, x + 61, 684, 13, cooldown === 0 ? CYAN : DIM);
  const fill = 1 - Math.min(1, cooldown / max);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle =
      i / 12 < fill ? (cooldown === 0 ? "#73cdbd" : "#327877") : "#132830";
    ctx.fillRect(x + 154 + i * 7, 678, 5, 12);
  }
}
function hud(ctx: Ctx, s: State) {
  text(ctx, String(s.score).padStart(6, "0"), 64, 39, 48);
  tracked(ctx, C.TITLE_TEXT, 540, 35, 17, 7, CYAN);
  tracked(
    ctx,
    `${C.DIVE_LABEL} / ${String(s.depth).padStart(2, "0")}`,
    1057,
    30,
    12,
    2,
  );
  text(ctx, `${s.planktonRemaining} MOTES REMAIN`, 1216, 51, 11, DIM, "right");
  text(ctx, `DEPTH ${s.depth}`, 64, 685, 16, WHITE);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 220 + i * 29, 685, 23);
  gauge(ctx, 382, "SONAR", "[SPACE]", s.sonar.cooldown, C.SONAR_COOLDOWN);
  gauge(ctx, 704, "INK", "[SHIFT]", s.ink.cooldown, C.INK_COOLDOWN);
  text(
    ctx,
    s.muted ? "M / SOUND OFF" : "M / SOUND ON",
    1216,
    685,
    11,
    DIM,
    "right",
  );
}
function menus(ctx: Ctx, s: State) {
  menuItems(s.screen).forEach((item, i) => {
    const r = menuItemRect(s, i);
    if (!r) return;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#102b32" : "#071017";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = selected ? "#4faea6" : "#173039";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(r.x, r.y, 3, r.h);
    }
    text(
      ctx,
      selected ? "›" : "·",
      r.x + 21,
      r.y + r.h / 2,
      24,
      selected ? CYAN : DIM,
    );
    tracked(ctx, item, r.x + 50, r.y + r.h / 2, 16, 2, selected ? WHITE : DIM);
    if (selected)
      text(ctx, "↵", r.x + r.w - 25, r.y + r.h / 2, 18, CYAN, "center");
  });
}
function title(ctx: Ctx, s: State) {
  glow(ctx, 936, 346, 360, "#135e69", 0.2);
  tracked(ctx, "ABYSSAL SURVEY / 001", 112, 89, 12, 3, DIM);
  line(ctx, 112, 115, 119, 115, CYAN, 3);
  line(ctx, 130, 115, 440, 115);
  tracked(ctx, C.TITLE_TEXT, 104, 242, 100, 1, WHITE);
  tracked(ctx, C.TAGLINE_TEXT, 113, 322, 17, 5, CYAN);
  text(ctx, "A little light. A very hungry ocean.", 112, 376, 16, "#87a3aa");
  menus(ctx, s);
  text(ctx, "↑ ↓ SELECT    ENTER DIVE", 112, 587, 11, DIM);
  // A circular cutaway: the trench is a place, not a full-map preview.
  ctx.save();
  ctx.beginPath();
  ctx.arc(933, 338, 215, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#07141e";
  ctx.fillRect(710, 115, 450, 450);
  ctx.save();
  ctx.translate(933 - 496 * 1.4, 338 - 448 * 1.4);
  ctx.scale(1.4, 1.4);
  ctx.globalAlpha = 0.75;
  terrain(ctx, s, true);
  ctx.globalAlpha = 1;
  glow(ctx, 496, 448, 170, "#338b8b", 0.35);
  sprite(ctx, s, "glimmerfin", 6, 496, 448, 32);
  amber(ctx, 624, 448);
  sprite(ctx, s, "lanternjaw", 8 + (Math.floor(s.simTime * 8) % 8), 624, 448);
  ctx.restore();
  const shadow = ctx.createRadialGradient(933, 338, 85, 933, 338, 218);
  shadow.addColorStop(0, "#03060c00");
  shadow.addColorStop(1, "#03060cf5");
  ctx.fillStyle = shadow;
  ctx.fillRect(710, 115, 450, 450);
  ctx.restore();
  ring(ctx, 933, 338, 216, "#2b6061");
  ring(ctx, 933, 338, 232, "#133239");
  ctx.save();
  ctx.setLineDash([2, 12]);
  ring(ctx, 933, 338, 249, "#285055");
  ctx.restore();
  line(ctx, 668, 338, 706, 338, "#538c89");
  line(ctx, 1160, 338, 1198, 338, "#538c89");
  line(ctx, 933, 73, 933, 110, "#538c89");
  line(ctx, 933, 570, 933, 602, "#538c89");
  text(ctx, "NO SUNLIGHT BELOW THIS LINE", 933, 620, 11, DIM, "center");
  text(ctx, "+  FORAGER SIGNAL", 1000, 505, 11, CYAN);
  line(ctx, 994, 489, 970, 459, "#528580");
  line(ctx, 64, 658, 1216, 658);
  text(ctx, "01 / KINDLE", 112, 687, 12, CYAN);
  text(ctx, "GRAZE. LISTEN. DISAPPEAR.", 640, 687, 11, DIM, "center");
  text(
    ctx,
    s.muted ? "M / SOUND OFF" : "M / SOUND ON",
    1168,
    687,
    11,
    DIM,
    "right",
  );
}
function howto(ctx: Ctx, s: State) {
  tracked(ctx, "FIELD GUIDE / THE KINDLE DIVE", 100, 64, 12, 3, CYAN);
  text(ctx, "Stay bright. Stay alive.", 100, 127, 44);
  text(
    ctx,
    "Every mote feeds your light. Every light draws something closer.",
    100,
    179,
    16,
    DIM,
  );
  line(ctx, 100, 215, 1180, 215);
  const lessons = [
    [
      "01",
      "READ THE DARK",
      "Your cool light reveals nearby rock and water.",
      "Explored paths stay dim inside your light window.",
    ],
    [
      "02",
      "MAKE SOME NOISE",
      "SPACE sends sonar around corners. It maps the maze,",
      "but the Gloamfin can hear exactly where it finds you.",
    ],
    [
      "03",
      "LEAVE NO TRACE",
      "SHIFT drops ink. It blinds light-hunters, not ears.",
      "Eat every mote to clear the maze and descend.",
    ],
  ];
  lessons.forEach(([n, head, a, b], i) => {
    const y = 261 + i * 105;
    text(ctx, n, 100, y, 14, CYAN);
    tracked(ctx, head, 142, y, 15, 2);
    text(ctx, a, 142, y + 29, 13, "#b5cbcc");
    text(ctx, b, 142, y + 51, 13, DIM);
  });
  const hunters = [
    [
      "lanternjaw",
      "LANTERNJAW",
      "Follows your light.",
      "An amber lure. Or a harmless drifter?",
    ],
    [
      "gloamfin",
      "GLOAMFIN",
      "Follows your sound.",
      "Turn corners to shake its speed.",
    ],
    [
      "flarefish",
      "FLAREFISH",
      "Hunts in its own flash.",
      "A warm charge. Then nowhere to hide.",
    ],
  ];
  hunters.forEach(([sheet, head, a, b], i) => {
    const y = 274 + i * 109;
    sprite(ctx, s, sheet, 6, 805, y + 5, 48);
    tracked(ctx, head, 847, y - 5, 14, 2, i === 1 ? "#bba6ef" : AMBER);
    text(ctx, a, 847, y + 23, 13);
    text(ctx, b, 780, y + 55, 12, DIM);
  });
  line(ctx, 100, 587, 1180, 587);
  text(
    ctx,
    "ARROWS / WASD  Swim     SPACE  Sonar     SHIFT  Ink",
    100,
    619,
    14,
    CYAN,
  );
  text(
    ctx,
    "ESC / P  Pause     M  Sound     `  Diagnostics",
    100,
    651,
    13,
    DIM,
  );
  text(ctx, "ENTER / ESC / CLICK TO RETURN  ↵", 1180, 687, 12, CYAN, "right");
}
export function render(s: State, api: RenderApi) {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  if (s.screen === "title") {
    title(ctx, s);
    return;
  }
  if (s.screen === "howto") {
    howto(ctx, s);
    return;
  }
  if (s.screen !== "gameover") {
    drawMaze(ctx, s);
    hud(ctx, s);
  }
  if (s.screen === "playing") return;
  if (s.screen === "countdown" || s.screen === "cleared") {
    ctx.fillStyle = "#03060c99";
    ctx.fillRect(405, 266, 470, 159);
    ctx.strokeStyle = "#1d4248";
    ctx.strokeRect(405.5, 266.5, 469, 158);
    tracked(
      ctx,
      s.screen === "cleared" ? `DEPTH ${s.depth} CLEARED` : "DIVE",
      s.screen === "cleared" ? 488 : 592,
      301,
      18,
      4,
      CYAN,
    );
    text(
      ctx,
      s.screen === "cleared"
        ? `+${C.SCORE_CLEAR}`
        : String(Math.max(1, Math.ceil(2 - s.screenTime))).padStart(2, "0"),
      640,
      361,
      52,
      WHITE,
      "center",
    );
    text(
      ctx,
      s.screen === "cleared" ? "THE ABYSS GOES DEEPER" : "FIND YOUR LIGHT",
      640,
      449,
      12,
      DIM,
      "center",
    );
    return;
  }
  ctx.fillStyle = s.screen === "paused" ? "#03060cb8" : "#03060ce8";
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  glow(
    ctx,
    640,
    310,
    280,
    s.screen === "gameover" ? "#794343" : "#1d696f",
    0.16,
  );
  tracked(
    ctx,
    s.screen === "paused" ? "SIGNAL HELD" : "SIGNAL LOST",
    545,
    217,
    12,
    3,
    DIM,
  );
  text(
    ctx,
    s.screen === "paused" ? "PAUSED" : "DIVE OVER",
    640,
    282,
    58,
    WHITE,
    "center",
  );
  text(
    ctx,
    s.screen === "paused"
      ? "THE DEEP CAN WAIT."
      : `${String(s.score).padStart(6, "0")} POINTS  /  DEPTH ${s.depth}`,
    640,
    341,
    16,
    CYAN,
    "center",
  );
  menus(ctx, s);
  text(ctx, "↑ ↓ SELECT    ENTER CONFIRM", 640, 620, 11, DIM, "center");
}
