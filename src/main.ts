import { appUrl } from "./urls.ts";
import "./style.css";
import {
  definitions,
  newLayout,
  parseLayout,
  seasonId,
  session,
  structureId,
  tileId,
  tiles,
} from "./workshop.ts";
import type { Action, StructureId, TileId } from "./workshop.ts";
import { drawScene, point, sprites } from "./scene.ts";
import { register } from "./webmcp.ts";
import { preferences } from "./preferences.ts";

const app = document.getElementById("app");
if (!app) throw new Error("Missing application root");
app.innerHTML = `<header><a class="wordmark" href="${appUrl("/")}">Greece <em>Battleground</em></a><span class="build-label">Polis workshop · Development preview</span></header>
<main class="workspace"><section class="settlement"><div class="settlement-heading"><div><p class="eyebrow">Shape a legend</p><h1>Your polis</h1></div>
<label class="season-label">Season<select id="season">${seasonId.options.map((s) => `<option value="${s}">${s}</option>`).join("")}</select></label></div>
<div id="world-scroller" class="world-scroller"><div class="scene"><canvas width="960" height="640" aria-label="Isometric Greek settlement"></canvas><div id="tile-controls" role="group" aria-label="Settlement tiles"></div></div></div>
<div class="world-footer"><span id="summary"></span><button id="weather" aria-pressed="true">Weather on</button></div>
<p class="hint">Choose a structure, then an empty tile. Select a building to move it to an empty tile, or remove it.</p>
<p id="notice" role="status" aria-live="polite"></p></section>
<aside><p class="eyebrow">Build your settlement</p><h2>Structures</h2><div id="structures" class="structures">${structureId.options.map((id) => `<button class="structure" data-structure="${id}" aria-pressed="false"><img src="${appUrl(`/art/${definitions[id].sprite}.webp`)}" alt="" width="80" height="80"><span>${definitions[id].name}</span></button>`).join("")}</div>
<section class="selection"><h3 id="selection-title">Explore your polis</h3><p id="selection-detail">Select a structure to start building.</p><button id="remove" disabled>Remove selected structure</button></section>
<p class="prototype-note">This workshop previews original art and placement. Battles and the full game rules are still in development.</p>
</aside></main><footer>Raise a city. Earn a place among the legends.</footer>`;

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement))
  throw new Error("Missing settlement canvas");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Canvas is unavailable");
function element(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing control: " + id);
  return node;
}
const controls = element("tile-controls");
const title = element("selection-title");
const detail = element("selection-detail");
const summary = element("summary");
const notice = element("notice");
const season = (() => {
  const node = element("season");
  if (!(node instanceof HTMLSelectElement))
    throw new Error("Invalid season control");
  return node;
})();
const remove = (() => {
  const node = element("remove");
  if (!(node instanceof HTMLButtonElement))
    throw new Error("Invalid remove control");
  return node;
})();
const weather = element("weather");

const saveKey = "greece-battleground.workshop.v1";
let layout = newLayout();
let loadMessage = "";
try {
  const raw = localStorage.getItem(saveKey);
  if (raw) layout = parseLayout(JSON.parse(raw));
} catch {
  loadMessage =
    "Your saved workshop could not be restored. A fresh layout is shown; it will be saved when you make a change.";
}
let selected: TileId | null = null;
let focused = tileId.parse(18);
let building: StructureId | null = null;
let effects = true;
const grid = tiles(layout.seed);
const game = session(
  layout,
  (next) => localStorage.setItem(saveKey, JSON.stringify(next)),
  renderControls,
);
const buttons = new Map<TileId, HTMLButtonElement>();
for (const tile of grid) {
  const button = document.createElement("button");
  button.className = "tile";
  button.type = "button";
  const p = point(tile.q, tile.r);
  button.style.left = `${(p.x / 960) * 100}%`;
  button.style.top = `${(p.y / 640) * 100}%`;
  button.addEventListener("click", () => choose(tile.id));
  button.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const dq =
      event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const dr = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const target = grid.find((t) => t.q === tile.q + dq && t.r === tile.r + dr);
    if (target) {
      focused = target.id;
      renderControls();
      buttons.get(target.id)?.focus();
    }
  });
  buttons.set(tile.id, button);
  controls.append(button);
}
for (const button of document.querySelectorAll("[data-structure]")) {
  button.addEventListener("click", () => {
    building = structureId.parse(button.getAttribute("data-structure"));
    selected = null;
    renderControls();
    notice.textContent = `Choose an empty tile for ${definitions[building].name}.`;
  });
}
season.addEventListener("change", () =>
  act({ op: "season", value: seasonId.parse(season.value) }),
);
remove.addEventListener("click", () => {
  if (selected !== null) act({ op: "remove", tile: selected });
});
weather.addEventListener("click", () => {
  effects = !effects;
  weather.setAttribute("aria-pressed", String(effects));
  weather.textContent = effects ? "Weather on" : "Weather off";
});

function act(action: Action) {
  try {
    game.act({ revision: game.inspect().r, actions: [action] });
    notice.textContent = "Settlement saved.";
    return true;
  } catch (error) {
    notice.textContent =
      error instanceof Error ? error.message : "The change could not be saved.";
    renderControls();
    return false;
  }
}
function choose(id: TileId) {
  focused = id;
  const occupied = game.layout.placements.find((p) => p.tile === id);
  if (building && !occupied) {
    act({ op: "place", tile: id, structure: building });
    return;
  }
  if (
    selected !== null &&
    !occupied &&
    game.layout.placements.some((p) => p.tile === selected)
  ) {
    if (act({ op: "move", from: selected, to: id })) {
      selected = id;
      renderControls();
    }
    return;
  }
  selected = id;
  building = null;
  renderControls();
}
function renderControls() {
  season.value = game.layout.season;
  summary.textContent = `${game.layout.placements.length} structures · ${game.layout.season}`;
  for (const tile of grid) {
    const button = buttons.get(tile.id);
    if (!button) continue;
    const structure = game.layout.placements.find((p) => p.tile === tile.id);
    button.setAttribute(
      "aria-label",
      `Tile ${tile.id}, ${tile.terrain}${structure ? ", " + definitions[structure.structure].name : ", empty"}`,
    );
    button.setAttribute("aria-pressed", String(tile.id === selected));
    button.tabIndex = tile.id === focused ? 0 : -1;
  }
  for (const button of document.querySelectorAll("[data-structure]"))
    button.setAttribute(
      "aria-pressed",
      String(button.getAttribute("data-structure") === building),
    );
  const structure = game.layout.placements.find((p) => p.tile === selected);
  title.textContent = structure
    ? definitions[structure.structure].name
    : building
      ? definitions[building].name
      : "Explore your polis";
  detail.textContent = structure
    ? "Choose an empty tile to move this building."
    : building
      ? "Choose an empty tile to place this building."
      : "Select a structure or explore a tile.";
  remove.disabled = !structure;
}
renderControls();
const scroller = element("world-scroller");
scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
notice.textContent = loadMessage;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let reduceSetting = preferences().motion === "reduce";
addEventListener("pageshow", () => {
  reduceSetting = preferences().motion === "reduce";
});
const lifecycle = new AbortController();
addEventListener("pagehide", (event) => {
  if (!event.persisted) lifecycle.abort();
});
register(game, lifecycle.signal).catch(() => {
  notice.textContent = "AI tools are unavailable in this browser session.";
});
try {
  const images = await sprites(
    undefined,
    new Set([
      ...Object.values(definitions).map((d) => d.sprite),
      ...Object.values(definitions).flatMap((d) => (d.troop ? [d.troop] : [])),
    ]),
  );
  let last = 0;
  const frame = (time: number) => {
    if (lifecycle.signal.aborted) return;
    if (!document.hidden && time - last >= 1000 / 30) {
      drawScene(
        ctx,
        {
          ...game.layout,
          placements: game.layout.placements.map((p) => ({
            tile: p.tile,
            ...definitions[p.structure],
          })),
        },
        grid,
        images,
        selected,
        time,
        reduced.matches || reduceSetting || !effects,
      );
      last = time;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
} catch {
  notice.textContent =
    "The art library could not be loaded. Reload to try again.";
}
