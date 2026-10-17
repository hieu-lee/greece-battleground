import { appUrl } from "./urls.ts";
import "./style.css";
import { catalogue, sprites, paintSprite } from "./scene.ts";
import { buildings } from "./rules.ts";
import { definitions } from "./workshop.ts";
import { preferences } from "./preferences.ts";

const artBuildings = [
  ...Object.values(definitions),
  ...Object.values(buildings).filter(
    (d) =>
      !Object.values(definitions).some(
        (existing) => existing.sprite === d.sprite,
      ),
  ),
];
const app = document.getElementById("app");
if (!app) throw new Error("Missing art review root");
app.innerHTML = `<header><a class="wordmark" href="${appUrl("/")}">Greece <em>Battleground</em></a><span class="build-label">Original art review</span></header>
<main class="art-review"><h1>Painted troops &amp; Greek architecture</h1><p>Inspect each keyframe, then watch the sequence at settlement scale and enlarged. Combat effects and rules are not simulated here.</p>
<div class="animation-controls"><label>Action <select id="action"></select></label><label>Keyframe <input id="frame" type="range" min="0" value="0"></label><button id="play" aria-pressed="false">Play sequence</button><span id="frame-label" role="status"></span></div>
<canvas width="960" height="420" aria-label="Painted troop animation preview"></canvas><p id="art-notice" role="status"></p>
<h2>Seasonal battleground</h2><div id="backgrounds" class="art-grid"></div>
<h2>Buildings at settlement scale</h2><div id="building-levels"></div>
<h2>Symbols</h2><div id="icons" class="art-grid"></div></main>`;
const action = document.getElementById("action"),
  frame = document.getElementById("frame"),
  play = document.getElementById("play"),
  label = document.getElementById("frame-label"),
  notice = document.getElementById("art-notice"),
  canvas = document.querySelector("canvas"),
  icons = document.getElementById("icons"),
  backgrounds = document.getElementById("backgrounds"),
  levels = document.getElementById("building-levels");
if (
  !(action instanceof HTMLSelectElement) ||
  !(frame instanceof HTMLInputElement) ||
  !(play instanceof HTMLButtonElement) ||
  !label ||
  !notice ||
  !(canvas instanceof HTMLCanvasElement) ||
  !icons ||
  !backgrounds ||
  !levels
)
  throw new Error("Missing art review control");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Canvas is unavailable");
try {
  const entries = await catalogue();
  const assets = await sprites(entries);
  const families = artBuildings.map((d) => ({
    sprite: d.sprite,
    name:
      Object.values(buildings).find((building) => building.sprite === d.sprite)
        ?.name ?? d.name,
  }));
  families.splice(1, 0, {
    sprite: "arcadia-hall",
    name: "Arcadia Hall",
  });
  for (const family of families) {
    const sprite = assets.get(family.sprite);
    if (!sprite || sprite.data.kind !== "building") continue;
    const section = document.createElement("section"),
      heading = document.createElement("h3"),
      grid = document.createElement("div");
    heading.textContent =
      family.sprite === "polis-hall" ? "Athens Hall" : family.name;
    grid.className = "art-grid";
    section.dataset.building = family.sprite;
    for (let index = 0; index < sprite.data.frames; index++) {
      const figure = document.createElement("figure"),
        preview = document.createElement("canvas"),
        caption = document.createElement("figcaption");
      preview.width = 256;
      preview.height = 320;
      preview.style.width = "128px";
      preview.style.height = "160px";
      preview.setAttribute(
        "aria-label",
        `${heading.textContent} level ${index + 1} at settlement scale`,
      );
      const context = preview.getContext("2d");
      if (!context) throw new Error("Building preview canvas is unavailable");
      context.fillStyle = "#29474a";
      context.fillRect(0, 0, 256, 320);
      paintSprite(context, sprite, index, 128, 240, 24);
      caption.textContent = `Level ${index + 1}`;
      figure.append(preview, caption);
      grid.append(figure);
    }
    section.append(heading, grid);
    levels.append(section);
  }
  const animations = [...assets.values()].filter(
    (x) => x.data.kind === "animation",
  );
  for (const sprite of animations) {
    const option = document.createElement("option");
    option.value = sprite.data.id;
    option.textContent = sprite.data.id.replaceAll("-", " ");
    action.append(option);
  }
  for (const entry of entries) {
    if (entry.kind === "background" && entry.id.startsWith("battleground-")) {
      const figure = document.createElement("figure"),
        image = new Image(240, 160);
      image.src = appUrl(entry.path);
      image.loading = "lazy";
      image.style.height = "auto";
      image.alt = `${entry.id.replace("battleground-", "")} Greek coastal battlefield`;
      const caption = document.createElement("figcaption");
      caption.textContent = entry.id.replace("battleground-", "");
      figure.append(image, caption);
      backgrounds.append(figure);
    }
    if (entry.kind !== "icon") continue;
    const figure = document.createElement("figure");
    for (const size of [24, 48, 96]) {
      const image = new Image(size, size);
      image.src = appUrl(entry.path);
      image.alt = "";
      figure.append(image);
    }
    const caption = document.createElement("figcaption");
    caption.textContent = entry.id.replace("icon-", "");
    figure.append(caption);
    icons.append(figure);
  }
  let playing = false,
    started = 0,
    raf = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let reduceSetting = preferences().motion === "reduce";
  const draw = () => {
    const sprite = assets.get(action.value);
    if (!sprite || sprite.data.kind !== "animation") return;
    const index = Number(frame.value);
    ctx.clearRect(0, 0, 960, 420);
    ctx.fillStyle = "#29474a";
    ctx.fillRect(0, 0, 960, 420);
    ctx.strokeStyle = "#edd99a55";
    ctx.beginPath();
    ctx.moveTo(30, 330);
    ctx.lineTo(930, 330);
    ctx.stroke();
    paintSprite(ctx, sprite, index, 190, 330, 36);
    // Giants register at a lower pixelsPerUnit; cap the enlargement so the whole frame above the feet fits.
    paintSprite(
      ctx,
      sprite,
      index,
      590,
      330,
      Math.min(144, (310 * sprite.data.pixelsPerUnit) / sprite.data.anchor[1]),
    );
    ctx.fillStyle = "#efe6ce";
    ctx.font = "14px system-ui";
    ctx.fillText("Settlement scale ×3", 75, 40);
    ctx.fillText("Keyframe enlarged", 460, 40);
    label.textContent = `${index + 1} / ${sprite.data.frames}${sprite.data.contactFrame === index ? " · attack contact" : ""}`;
  };
  const stop = () => {
    playing = false;
    cancelAnimationFrame(raf);
    play.textContent = "Play sequence";
    play.setAttribute("aria-pressed", "false");
  };
  const syncMotion = () => {
    reduceSetting = preferences().motion === "reduce";
    if (reduced.matches || reduceSetting) stop();
    else notice.textContent = "";
  };
  const tick = (time: number) => {
    const sprite = assets.get(action.value);
    if (!playing || !sprite || sprite.data.kind !== "animation") return;
    const elapsed = Math.floor(((time - started) * sprite.data.fps) / 1000);
    frame.value = String(
      sprite.data.loop
        ? elapsed % sprite.data.frames
        : Math.min(elapsed, sprite.data.frames - 1),
    );
    if (!document.hidden) draw();
    if (!sprite.data.loop && elapsed >= sprite.data.frames - 1) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  const select = () => {
    stop();
    const sprite = assets.get(action.value);
    if (!sprite || sprite.data.kind !== "animation") return;
    frame.max = String(sprite.data.frames - 1);
    frame.value = "0";
    draw();
  };
  action.addEventListener("change", select);
  frame.addEventListener("input", () => {
    stop();
    draw();
  });
  play.addEventListener("click", () => {
    syncMotion();
    if (playing) {
      stop();
      return;
    }
    if (reduced.matches || reduceSetting) {
      notice.textContent =
        "Reduced motion is enabled. Use the keyframe slider to inspect poses.";
      return;
    }
    playing = true;
    started = performance.now();
    play.textContent = "Pause sequence";
    play.setAttribute("aria-pressed", "true");
    raf = requestAnimationFrame(tick);
  });
  reduced.addEventListener("change", syncMotion);
  addEventListener("pageshow", syncMotion);
  addEventListener("pagehide", () => stop());
  select();
} catch {
  notice.textContent = "Art could not be loaded. Reload to retry.";
}
