import "./stage.css";
import type { Game } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { FathomDebugApi, FathomState } from "./types";
import { debug } from "./debug";
import { initial } from "./world";
import { update } from "./simulation";
import { render } from "./render";

export type * from "./types";
export { BACKGROUND } from "./render";

/** The runtime owns IO; all mutable dive facts are values in FathomState. */
export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    const sounds = [
      { freq: 720, freqTo: 1080, durationMs: 65, gain: 0.06 },
      { freq: 920, freqTo: 180, durationMs: 380, gain: 0.12 },
      { freq: 130, freqTo: 35, durationMs: 300, gain: 0.15 },
      { freq: 360, freqTo: 660, durationMs: 220, gain: 0.1 },
      {
        freq: 90,
        freqTo: 880,
        durationMs: 450,
        gain: 0.1,
        wave: "triangle" as const,
      },
      {
        freq: 180,
        freqTo: 35,
        durationMs: 600,
        gain: 0.18,
        wave: "sawtooth" as const,
      },
      { freq: 440, freqTo: 1320, durationMs: 700, gain: 0.12 },
    ];
    Object.values(C.CUES).forEach((name, i) =>
      api.audio.define(name, sounds[i]),
    );
    const sheets: [string, number][] = [
      ["glimmerfin", 8],
      ["lanternjaw", 16],
      ["gloamfin", 8],
      ["flarefish", 8],
      ["drifter", 8],
      ["flare-bloom", 8],
      ["trench-walls", 19],
    ];
    const assets = Object.fromEntries(
      await Promise.all(
        sheets.map(async ([name, count]) => [
          name,
          await Promise.all(
            Array.from({ length: count }, (_, i) =>
              api.assets.loadImage(`${name}/${i}.png`),
            ),
          ),
        ]),
      ),
    );
    for (const name of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(name, (s) => s[name]);
    api.diagnostics.register("sonar", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.DEN_ORDER.length * C.ROSTER_CAP; i++)
      api.diagnostics.register(`hunter ${i + 1}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "-";
      });
    return [initial(assets), debug];
  },
  update,
  render,
};
