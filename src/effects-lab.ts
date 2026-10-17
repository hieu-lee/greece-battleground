import { appUrl } from "./urls.ts";
import { battleView } from "./battle-view.ts";
import "./style.css";
import "./effects-lab.css";
import { z } from "zod";
import { effectId, effects } from "./effects.ts";
import type { EffectId } from "./effects.ts";
import { effectTextures, paintEffect } from "./effect-renderer.ts";
import type { EffectTextures } from "./effect-renderer.ts";
import { createAudio } from "./audio.ts";
import { preferences, savePreferences } from "./preferences.ts";
import { paintSprite, sprites } from "./scene.ts";
import type { Sprite } from "./scene.ts";
import type { Tool } from "./webmcp.ts";

const app = document.getElementById("app");
if (!app) throw new Error("Missing atelier root");
app.innerHTML = `<header><a class="wordmark" href="${appUrl("/")}">Greece <em>Battleground</em></a><span>Effects atelier</span></header>
<main class="effects-workspace"><section class="effects-stage"><p class="eyebrow">A spark from Olympus</p><h1 id="effect-name"></h1><canvas id="effects-canvas" width="960" height="640" aria-label="Original Greek combat effect preview"></canvas><div class="effect-actions"><button id="replay">Replay effect & sound</button><button id="pause">Pause</button><button id="mute">Mute sound</button></div><p id="effect-status" role="status">Sound starts after you interact. Lightning and drakon fire are preview assets; their source abilities are still being verified.</p></section><aside><h2>Combat & world cues</h2><div id="effects-list"></div><p class="hint">Hand-painted fire, smoke, bronze sparks and Greek wards. Permitted source sound effects and original Greek spells, with stereo placement and a bounded voice budget.</p><a href="${appUrl("/play.html")}">Play a practice battle</a></aside></main>`;
const canvas = document.getElementById("effects-canvas");
if (!(canvas instanceof HTMLCanvasElement))
  throw new Error("Missing effects canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Effects canvas unavailable");
function element(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error("Missing effects control: " + id);
  return found;
}
const name = element("effect-name"),
  status = element("effect-status"),
  list = element("effects-list");
function button(id: string) {
  const found = document.getElementById(id);
  if (!(found instanceof HTMLButtonElement))
    throw new Error("Missing control: " + id);
  return found;
}
const audio = createAudio();
const controller = new AbortController();
const registration = new AbortController();
const motion = matchMedia("(prefers-reduced-motion: reduce)");
let selected: EffectId = "lightning";
let age = 0;
let paused = false;
let revision = 0;
let previous = 0;
let frame = 0;
const controls = new Map<EffectId, HTMLButtonElement>();
for (const id of effectId.options) {
  const b = document.createElement("button");
  b.textContent = effects[id].name;
  b.addEventListener("click", () => {
    preview(id, 0, false);
    play(id);
  });
  controls.set(id, b);
  list.append(b);
}
function update() {
  name.textContent = effects[selected].name;
  for (const [id, b] of controls)
    b.setAttribute("aria-pressed", String(id === selected));
  button("pause").textContent = paused ? "Resume" : "Pause";
  button("mute").textContent = preferences().muted
    ? "Unmute sound"
    : "Mute sound";
  button("mute").setAttribute("aria-pressed", String(preferences().muted));
}
function preview(id: EffectId, seconds: number, stop: boolean) {
  selected = id;
  age = seconds;
  paused = stop;
  revision++;
  audio.silence();
  update();
}
function play(id: EffectId) {
  if (paused || document.hidden || controller.signal.aborted) return;
  audio.play(id);
  status.textContent =
    audio.status.failure ??
    (audio.status.muted
      ? "Sound is muted."
      : "Greek effect and stereo sound preview.");
}
button("replay").addEventListener("click", () => {
  preview(selected, 0, false);
  play(selected);
});
button("pause").addEventListener("click", () => {
  paused = !paused;
  if (paused) audio.silence();
  update();
});
button("mute").addEventListener("click", () => {
  try {
    savePreferences({ ...preferences(), muted: !preferences().muted });
  } catch {
    status.textContent = "Sound settings could not be saved.";
  }
});
addEventListener("preferenceschange", update, { signal: controller.signal });
addEventListener("storage", update, { signal: controller.signal });
update();
try {
  const textures = await effectTextures().catch(
    (error: unknown): EffectTextures => {
      status.textContent =
        (error instanceof Error
          ? error.message
          : "Effects library unavailable") +
        ". Procedural cues remain available.";
      return new Map();
    },
  );
  const assets = await sprites(
    undefined,
    new Set(["hoplite-idle", "tracker-idle", "polis-hall"]),
  ).catch((): Map<string, Sprite> => {
    status.textContent =
      "Scene art unavailable. Effect previews remain available.";
    return new Map();
  });
  const draw = (time: number) => {
    if (!document.hidden) {
      if (!paused)
        age += previous === 0 ? 0 : Math.min(0.1, (time - previous) / 1000);
      if (!paused && age > effects[selected].duration + 0.75) age = 0;
      const reduced = preferences().motion === "reduce" || motion.matches;
      const sky = ctx.createLinearGradient(0, 0, 0, 640);
      sky.addColorStop(0, "#132f46");
      sky.addColorStop(0.6, "#39727e");
      sky.addColorStop(1, "#172e3a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 960, 640);
      ctx.fillStyle = "#85a2a114";
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(
          120 + i * 180,
          150 + (i % 2) * 40,
          170,
          12,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = "#506d56";
      ctx.beginPath();
      ctx.ellipse(480, 450, 420, 125, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#d2bd7b45";
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.ellipse(480, 445, 90 + i * 48, 30 + i * 14, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const hall = assets.get("polis-hall"),
        hoplite = assets.get("hoplite-idle"),
        tracker = assets.get("tracker-idle");
      if (hall) paintSprite(ctx, hall, 0, 210, 390, 24);
      const source = { x: 395, y: 410 },
        target = { x: 645, y: 422 },
        troopPixels = 38,
        chestHeight =
          (battleView.chestHeight * troopPixels) / battleView.troopPixels;
      if (tracker)
        paintSprite(
          ctx,
          tracker,
          0,
          source.x,
          source.y + chestHeight,
          troopPixels,
        );
      if (hoplite) {
        ctx.save();
        ctx.translate(target.x, target.y + chestHeight);
        ctx.scale(-1, 1);
        paintSprite(ctx, hoplite, 0, 0, 0, troopPixels);
        ctx.restore();
      }
      paintEffect(ctx, selected, source, target, age, 97, textures, reduced);
      ctx.fillStyle = "#eedab4";
      ctx.font = "14px system-ui";
      ctx.fillText("AEGEAN PROVING GROUND", 36, 48);
      ctx.fillStyle = "#b6d9dc";
      ctx.font = "13px system-ui";
      ctx.fillText(
        reduced ? "Reduced motion · static cue" : "Greek art & spatial sound",
        36,
        74,
      );
    }
    previous = time;
    frame = requestAnimationFrame(draw);
  };
  draw(0);
  addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) {
        previous = 0;
        draw(0);
      }
    },
    { signal: controller.signal },
  );
} catch (error) {
  status.textContent =
    error instanceof Error ? error.message : "Effects could not be loaded.";
}
addEventListener("pagehide", (event) => {
  cancelAnimationFrame(frame);
  if (!event.persisted) {
    controller.abort();
    registration.abort();
  }
});
const inspect = z.object({}).strict();
const input = z
  .object({
    effect: effectId,
    seconds: z.number().min(0).max(4).default(0),
    paused: z.boolean().default(false),
  })
  .strict();
const tools: Tool[] = [
  {
    name: "inspect_effects",
    description:
      "Greek VFX and source SFX atelier status and available previews. Lightning/fire ability mechanics are not verified yet.",
    inputSchema: z.toJSONSchema(inspect),
    annotations: { readOnlyHint: true },
    execute: (value) => {
      inspect.parse(value);
      return {
        r: revision,
        effect: selected,
        seconds: age,
        paused,
        sound: audio.status,
        available: effectId.options,
      };
    },
  },
  {
    name: "preview_effect",
    description:
      "Preview a named original effect at a time in seconds; paused=true holds that frame for art audit. Does not unlock or play audio without human interaction.",
    inputSchema: z.toJSONSchema(input),
    annotations: { readOnlyHint: false },
    execute: (value) => {
      const parsed = input.parse(value);
      preview(parsed.effect, parsed.seconds, parsed.paused);
      return { r: revision, effect: selected, seconds: age, paused };
    },
  },
];
if (document.modelContext) {
  try {
    for (const tool of tools)
      await document.modelContext.registerTool(tool, {
        signal: registration.signal,
      });
  } catch {
    registration.abort();
  }
}
