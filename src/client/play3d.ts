import { onAccountChange } from "../api.ts";
import { appUrl } from "../urls.ts";
import "./client.css";
import * as THREE from "three";
import { clans, selectedClan } from "../clans.ts";
import { buildings, fates, holderText } from "../rules.ts";
import { saleReturns, transaction } from "../game.ts";
import { troopCount } from "../warband.ts";
import type { Command } from "../game.ts";
import { tickSeconds } from "../combat.ts";
import { publicGame } from "../read-model.ts";
import type { PlayState } from "../read-model.ts";
import { fog as engineFog, grid, sourceMap, startTile } from "../map.ts";
import type { FogState, TileId } from "../map.ts";
import { createPlaySession } from "../play-session.ts";
import { loadProfile } from "../ranked.ts";
import { registerPlayTools } from "../play-tools.ts";
import { createAudio } from "../audio.ts";
import { createActionDispatch } from "../action-dispatch.ts";
import { preferences } from "../preferences.ts";
import { createTutorial } from "../tutorial.ts";
import { tutorialBlocked } from "../tutorial-domain.ts";
import { appendRunArchives } from "../run-archive.ts";
import { createWorld } from "./world.ts";
import type { FogCell } from "./sky.ts";
import { createIsland } from "./island.ts";
import { createOverlay } from "./overlay.ts";
import { createBuildings } from "./buildings.ts";
import { retrySurfaces, surfaceSamples, surfacesStatus } from "./materials.ts";
import type { BuildingPlacement } from "./buildings.ts";
import { createVfx } from "./vfx.ts";
import { createWeather } from "./weather.ts";
import { createBattleView } from "./battle3d.ts";
import { createBillboard } from "./units.ts";
import type { Billboard } from "./units.ts";
import {
  createHud,
  preparationKey,
  buildingTooltip,
  featureTooltip,
  fateTargets,
  villagerRole,
} from "./hud.ts";
import type { HudSelection } from "./hud.ts";
import { createScreens } from "./screens.ts";
import { hexToWorld, worldToHex } from "./hex.ts";
import type { TileSpec } from "./terrain.ts";
import type { Side } from "./hex.ts";
import { world as shared } from "./shaders.ts";
import { icons } from "./icons.ts";
import { seasonBlend, seasonNames } from "./display.ts";

// Prepare camera: the middle of the playable tiles, east of the island's centre.
const playable = grid
  .filter((t) => t.playable)
  .map((t) => hexToWorld(t.q, t.r));
const HOME = {
  x: playable.reduce((sum, c) => sum + c.x, 0) / playable.length,
  z: playable.reduce((sum, c) => sum + c.z, 0) / playable.length + 0.6,
  distance: 20,
};
// On portrait screens the shop column covers the right fifth and the HUD the bottom, so the camera
// looks a little east and north to put the playable tiles in the free middle.
let homedAt = 0;
let homedPortrait = false;
function home() {
  homedAt = performance.now();
  homedPortrait = world.camera.aspect < 1;
  if (!homedPortrait) return HOME;
  const width = HOME.distance / world.distanceForWidth(1);
  return { ...HOME, x: HOME.x + width * 0.11, z: HOME.z - 1 };
}
const ARENA = { x: 0, z: 0.8, distance: 25 };
// Battle intro timing (ms): the versus card's CSS animation, its fade-out tail, then the march.
const VERSUS_MS = 2300;
const VERSUS_FADE_MS = 400;
const MARCH_MS = 1600;
// The rival island is fixed scenery until the battle read model supplies their layout.
// The rival island before any replay: a source-generated map of a fixed seed.
const RIVAL_MAP = sourceMap(97).tiles;
const RIVAL_SCENERY = scenery(RIVAL_MAP);
const params = new URL(location.href).searchParams;
const network = params.get("mode") === "async";
// The server scores a finished async run; its newest profile entry is this run's award.
let awardShown = -1;
function showAward(revision: number) {
  if (awardShown === revision) return;
  awardShown = revision;
  screens.award("Recording your result…");
  loadProfile()
    .then((profile) => {
      if (awardShown !== revision) return;
      const last = profile?.history[0];
      const elo = last?.elo;
      screens.award(
        !last
          ? "Your result is saved to your profile."
          : elo
            ? `Elo ${elo.before} to ${elo.after} (${elo.change > 0 ? "+" : ""}${elo.change}), +${last.xp} XP`
            : `+${last.xp} XP. Freeplay never changes your ranked Elo.`,
      );
    })
    .catch(() => {
      if (awardShown === revision)
        screens.award(
          "Your result is saved. Open your profile from the menu to see it.",
        );
    });
}
const tutorial = !network && params.get("tutorial") === "1";
const controller = new AbortController();
let rendererFailed = false;
if (network)
  onAccountChange(() => {
    controller.abort();
    document.getElementById("app")?.replaceChildren();
    location.replace(appUrl("/"));
  }, controller.signal);

const app = document.getElementById("app");
if (!app) throw new Error("Missing play root");
app.className = "game";
app.innerHTML = `<canvas id="world" aria-label="Your polis, seen from above"></canvas><div class="labels" id="labels"></div><div id="hud"></div><div id="screens"></div><section id="preparation-art-status" aria-labelledby="preparation-art-title" hidden><h2 id="preparation-art-title">Some polis images could not load</h2><p id="preparation-art-message" role="status"></p><button id="retry-preparation-assets" aria-describedby="preparation-art-message">Retry images</button></section><div class="loading" id="loading"><div class="loading-mark">Ω</div><p>Raising your polis…</p></div>`;
const canvas = app.querySelector("canvas")!;
const labels = app.querySelector<HTMLElement>("#labels")!;
const preparationArt = app.querySelector<HTMLElement>(
  "#preparation-art-status",
)!;
const preparationMessage = app.querySelector<HTMLElement>(
  "#preparation-art-message",
)!;
const preparationRetry = app.querySelector<HTMLButtonElement>(
  "#retry-preparation-assets",
)!;
let preparationRetrying = false;
let preparationPresentation = "ready";
const world = (() => {
  try {
    return createWorld(canvas);
  } catch (error) {
    const loading = app.querySelector<HTMLElement>("#loading")!;
    loading.innerHTML = `<div class="loading-mark" aria-hidden="true">Ω</div><h1 id="renderer-startup-error" tabindex="-1">The 3D view could not start</h1><p id="startup-error" role="status">Reload to try again, or return to the menu. Your saved polis is unchanged.</p><nav class="startup-actions" aria-label="3D view recovery"><button id="reload-renderer">Reload</button><a href="${appUrl("/")}">Back to menu</a></nav>`;
    loading
      .querySelector("#reload-renderer")!
      .addEventListener("click", () => location.reload());
    loading.querySelector<HTMLElement>("#renderer-startup-error")!.focus();
    throw error;
  }
})();
const island = createIsland(world);
const overlay = createOverlay(world.scene);
const structures = createBuildings(world.scene, world.camera, () =>
  world.invalidateShadows(),
);
const vfx = createVfx(world, labels);
const battle = createBattleView(world, vfx);
const weather = createWeather(world);
const audio = createAudio();

const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
let reduced = false;
function refreshPreferences() {
  const saved = preferences();
  world.setPreferences(saved);
  reduced = saved.motion === "reduce" || motionQuery.matches;
  document.documentElement.dataset.motion = reduced ? "reduce" : "full";
  world.setReducedMotion(reduced);
  vfx.setReducedMotion(reduced);
  weather.setReducedMotion(reduced);
  structures.setReducedMotion(reduced);
}
refreshPreferences();
motionQuery.addEventListener("change", refreshPreferences, {
  signal: controller.signal,
});
addEventListener("preferenceschange", refreshPreferences, {
  signal: controller.signal,
});
addEventListener("storage", refreshPreferences, { signal: controller.signal });

const game = await createPlaySession({
  network,
  tutorial,
  signal: controller.signal,
}).catch((error) => {
  world.stop();
  const mode = tutorial ? "tutorial" : "practice";
  const loading = app.querySelector<HTMLElement>("#loading")!;
  loading.innerHTML = `<div class="loading-mark">Ω</div><p id="startup-error" role="status"></p><div id="startup-archives"></div><nav class="startup-actions" aria-label="Polis recovery">${network ? `<a href="${appUrl("/play.html?mode=async")}">Retry connection</a>` : ""}<a href="${appUrl(`/clans.html?mode=${network ? "async" : mode}`)}">${network ? "Choose a clan" : "Start a new polis"}</a><a href="${appUrl("/")}">Back to menu</a></nav>`;
  loading.querySelector("#startup-error")!.textContent =
    error instanceof Error ? error.message : "Connection failed.";
  // Saves from earlier rules stay downloadable from here, as on the menu.
  if (!network) {
    const archives = loading.querySelector<HTMLElement>("#startup-archives")!;
    try {
      appendRunArchives(archives, mode);
    } catch {
      archives.textContent =
        "Allow browser storage to access your saved archives.";
    }
  }
  throw error;
});
const battleState = {
  /** Stable battle identity plus replay availability; wallet revisions do not restart it. */
  key: "",
  speed: 1,
  paused: false,
  resultShown: false,
  /** A claim is being sent; repeated Continue presses are ignored meanwhile. */
  claiming: false,
  /**
   * Continue was pressed on this result: a replay that loads during (or after a failed) claim
   * is not played, since the outcome was already shown. Reset when a new battle begins.
   */
  claimed: false,
  /** A saved result's winner has been shown; later background polls keep it on screen. */
  settled: false,
  resultClock: 0,
  /** When the march-out begins (as the versus card fades) and when the first tick runs. */
  marchAt: 0,
  /** Seconds of unpaused intro, which drive the march's walk cycle. */
  introClock: 0,
  /** When the current battle's intro began. */
  introAt: 0,
  /** When the battle was paused (0 while running); the intro clock stands still from here. */
  pausedAt: 0,
  startAt: 0,
  skipped: false,
};
let preparedBattle: {
  combat: NonNullable<typeof battle.combat>;
  structures: number;
  status: "loading" | "ready" | "failed";
} | null = null;
function battleAssetStatus(): "loading" | "ready" | "failed" {
  const fighters = battle.assetStatus;
  const buildings = structures.assetStatus;
  if (fighters === "failed" || buildings === "failed") return "failed";
  if (fighters === "loading" || buildings === "loading") return "loading";
  const combat = battle.combat;
  if (!combat) return "ready";
  if (!world.available) return "loading";
  if (
    !preparedBattle ||
    preparedBattle.combat !== combat ||
    preparedBattle.structures !== structures.revision
  ) {
    const preparation: NonNullable<typeof preparedBattle> = {
      combat,
      structures: structures.revision,
      status: "loading",
    };
    preparedBattle = preparation;
    void world.precompile().then(
      (ready) => {
        if (preparedBattle !== preparation) return;
        preparation.status = ready ? "ready" : "failed";
      },
      () => {
        if (preparedBattle === preparation) preparation.status = "failed";
      },
    );
  }
  return preparedBattle.status;
}
let lastFrame = performance.now();
// Human controls and native tools share one dispatcher: it plays each committed action's sounds
// once. A Fate choice at the current revision first cancels the Fate opening/reveal cues.
let fateAudio: AbortController | null = null;
function cancelFateAudio() {
  fateAudio?.abort();
  fateAudio = null;
}
const acknowledge = createActionDispatch(game, audio);
let lastImprovementRevision = game.state.revision;
async function dispatch(input: unknown) {
  const before = game.state;
  const request = transaction.safeParse(input);
  const actions =
    request.success && request.data.revision === before.revision
      ? request.data.actions
      : [];
  const restartIndex = actions.findLastIndex(
    (action) => action.op === "restart",
  );
  const restart = actions[restartIndex];
  const improvements = actions
    .slice(restartIndex + 1)
    .filter((action) => action.op === "upgrade");
  const improvement = improvements.at(-1);
  const occupied = new Map(
    (restart ? [{ tile: startTile }] : before.placements).map((p) => [
      p.tile,
      { tile: p.tile },
    ]),
  );
  let buildingImprovement: { tile: TileId } | undefined;
  for (const action of actions.slice(restartIndex + 1)) {
    if (action.op === "upgrade") buildingImprovement = undefined;
    if (action.op === "buy") {
      const target = occupied.get(action.tile);
      if (target) buildingImprovement = target;
      else occupied.set(action.tile, { tile: action.tile });
    }
    if (action.op === "sell") {
      if (occupied.get(action.tile) === buildingImprovement)
        buildingImprovement = undefined;
      occupied.delete(action.tile);
    }
    if (action.op === "move") {
      const target = occupied.get(action.from);
      if (target) {
        const displaced = occupied.get(action.to);
        occupied.delete(action.from);
        if (displaced) {
          displaced.tile = action.from;
          occupied.set(action.from, displaced);
        }
        target.tile = action.to;
        occupied.set(action.to, target);
      }
    }
  }
  if (
    request.success &&
    request.data.revision === game.state.revision &&
    request.data.actions.some((action) => action.op === "fate")
  )
    cancelFateAudio();
  const claim =
    request.success &&
    request.data.revision === game.state.revision &&
    game.state.phase.kind === "result" &&
    request.data.actions.some((action) => action.op === "continue") &&
    !battleState.claiming;
  if (claim) {
    battleState.claiming = true;
    battleState.claimed = true;
  }
  try {
    const reply = await acknowledge(input);
    if (
      (improvement || buildingImprovement) &&
      reply &&
      typeof reply === "object" &&
      "r" in reply &&
      typeof reply.r === "number" &&
      reply.r > before.revision &&
      reply.r > lastImprovementRevision &&
      (!("error" in reply) || reply.error === "committed")
    ) {
      lastImprovementRevision = reply.r;
      const snapshot = buildingImprovement
        ? publicGame.safeParse(game.inspect())
        : null;
      const placed =
        buildingImprovement && snapshot?.success && snapshot.data.r === reply.r
          ? snapshot.data.placements.find(
              (p) => p[0] === buildingImprovement.tile,
            )
          : undefined;
      const hall = before.placements.find((p) => p.id === "polis-hall");
      const index =
        improvement?.choice === "skill-0"
          ? 0
          : improvement?.choice === "skill-1"
            ? 1
            : 2;
      const clan = restart?.op === "restart" ? restart.clan : before.clan;
      if (buildingImprovement && (!placed || placed[2] < 2)) return reply;
      const title = placed
        ? `${buildings[placed[1]].name} improved`
        : improvement?.choice === "hall"
          ? "Polis Hall improved"
          : `${clans[clan].skills[index]?.name ?? "Clan skill"} improved`;
      const previousLevel = restart
        ? 1
        : improvement?.choice === "hall"
          ? (hall?.level ?? 1)
          : before.skills[index];
      const level = placed
        ? placed[2]
        : previousLevel +
          improvements.filter((action) => action.choice === improvement?.choice)
            .length;
      const detail = `Level ${level}`;
      hud.announce(title, detail);
      hud.notice(`${title} · ${detail}`);
      const tile = tileById.get(placed?.[0] ?? hall?.tile ?? startTile);
      if (!reduced && tile) {
        const c = hexToWorld(tile.q, tile.r);
        vfx.placement(new THREE.Vector3(c.x, 0, c.z), true);
      }
    }
    return reply;
  } finally {
    if (claim) {
      battleState.claiming = false;
      if (game.state.phase.kind === "result") render();
    }
  }
}
// Tool registration has its own controller: a registration failure must not abort the session.
const toolsController = new AbortController();
controller.signal.addEventListener("abort", () => toolsController.abort(), {
  once: true,
});
void registerPlayTools({
  game,
  network,
  signal: toolsController.signal,
  abort: () => toolsController.abort(),
  guide: () => game.state.tutorial,
  dispatch,
  media: () => ({
    sound: audio.status,
    paused: battleState.paused,
    skipped: battleState.skipped,
    replay: battleState.key || null,
    ticks: battle.combat?.ticks ?? 0,
    seconds: (battle.combat?.ticks ?? 0) * tickSeconds,
    assets: battle.combat ? battleAssetStatus() : null,
    graphicsAvailable: world.available,
    resultShown: battleState.resultShown,
  }),
});

type Mode = { kind: "villager" } | null;
const selection: HudSelection = { shop: null, fate: null };
// The shop offer being dragged over the island; it highlights targets like a selected offer.
let dragged: number | null = null;
let tooltipTile: TileId | null = null;
let mode: Mode = null;
let picked: TileId | null = null;
let selectionContext = preparationKey(game.state);

const hud = createHud(app.querySelector<HTMLElement>("#hud")!, {
  shop(slot) {
    abandonHold();
    audio.play("select");
    selection.shop = selection.shop === slot ? null : slot;
    selection.fate = null;
    mode = null;
    hud.notice("");
    render();
  },
  drag(slot, phase, x, y) {
    // Abandoned drags report no point. Only a point on the open island counts: not one
    // over the HUD (the shop column, a panel) or under a dialog another finger opened.
    const tile =
      Number.isFinite(x) && document.elementFromPoint(x, y) === canvas
        ? tileAt(x, y)
        : null;
    if (phase === "start") {
      // The shop selection is kept until release: changing it rebuilds the offers and would
      // drop the dragged card's pointer capture.
      abandonHold();
      audio.play("select");
      hud.notice("");
      selection.fate = null;
      mode = null;
      picked = null;
      dragged = slot;
      render();
    } else if (phase === "move") {
      overlay.setHover(tile);
    } else {
      overlay.setHover(null);
      const valid = tile !== null && targets(game.state).includes(tile.id);
      if (valid) {
        audio.play("select");
        void act({ op: "buy", slot, tile: tile.id }).then(render);
      } else if (tile) {
        audio.play("error");
        hud.notice("Drop it on an empty owned tile or a matching structure");
      }
      dragged = null;
      // Only the dragged offer's own selection ends with it: a deferred abandonment must not
      // clear an offer selected meanwhile (another finger, the keyboard).
      if (selection.shop === slot) selection.shop = null;
      render();
    }
  },
  reroll() {
    selection.shop = null;
    void act({ op: "reroll-shop" });
  },
  villager() {
    // While a structure is held the villager hex is its sale zone: a keyboard hold sells there,
    // and another finger's tap during a pointer hold does nothing.
    if (held) {
      if (held.pointer === null) {
        // The Enter that sold must not go on to buy a villager as it auto-repeats.
        enterEndedHold = true;
        release({ sale: true, tile: null });
      }
      return;
    }
    const state = game.state;
    if (mode?.kind === "villager") {
      audio.play("select");
      mode = null;
      render();
    } else if (state.workers > 0) {
      audio.play("select");
      mode = { kind: "villager" };
      selection.shop = selection.fate = null;
      hud.notice(
        "Assign the villager to a structure, or colonise a bordering tile",
      );
      render();
    } else
      void act({ op: "villager" }).then((ok) => {
        if (ok) {
          mode = { kind: "villager" };
          hud.notice(
            "Assign the villager to a structure, or colonise a bordering tile",
          );
          render();
        }
      });
  },
  ready() {
    cancelModes();
    void act({ op: "ready" });
  },
  fate() {
    if (game.state.tutorial && game.state.tutorial.stage !== "fate") return;
    hud.cancelDrag();
    cancelFateAudio();
    fateAudio = new AbortController();
    audio.play("fate-open", 0, 0, 0, fateAudio.signal);
    audio.play("fate-reveal", 0, 0, 0.2, fateAudio.signal);
    cancelModes();
    screens.fate(game.state, game.state.insight);
    render();
  },
  settings() {
    hud.cancelDrag();
    abandonHold();
    audio.play("select");
    screens.settings(!screens.settingsOpen);
  },
  hover(content) {
    tooltipTile = null;
    hud.tooltip(content);
  },
});

const lesson = tutorial
  ? createTutorial(app.querySelector<HTMLElement>("#hud")!, {
      act,
      async leave() {
        await game.leaveTutorial();
        audio.dispose();
        location.assign(appUrl("/"));
      },
    })
  : null;
lesson?.refresh(game.state, false);
let tutorialStage: NonNullable<PlayState["tutorial"]>["stage"] | null = null;
controller.signal.addEventListener("abort", () => lesson?.destroy(), {
  once: true,
});

const screensRoot = app.querySelector<HTMLElement>("#screens")!;
const screens = createScreens(screensRoot, {
  act,
  incomePause(paused) {
    game.pause(paused);
  },
  closeFate() {
    cancelFateAudio();
    screens.fate(null);
    render();
  },
  // Charms and spells pick their structure first; the purchase happens on the tile click.
  targetFate(slot) {
    const id = game.state.fate[slot];
    if (!id) return;
    cancelFateAudio();
    screens.fate(null);
    cancelModes();
    selection.fate = slot;
    hud.tooltip(null);
    const card = fates[id];
    hud.notice(
      `Choose an owned ${holderText(card.holders ?? {})} ${card.kind === "rune" ? "item" : "structure"} for ${card.name} (${card.cost} Insight) · Esc cancels`,
    );
    render();
  },
  speed(value) {
    battleState.speed = value;
    resume();
  },
  pause() {
    if (battleState.paused) resume();
    else {
      battleState.paused = true;
      battleState.pausedAt = performance.now();
      audio.silence();
    }
  },
  skip() {
    battleState.skipped = true;
    // Skipping (even while paused) ends the intro at once.
    battleState.paused = false;
    battleState.pausedAt = 0;
    battleState.startAt = Math.min(battleState.startAt, performance.now());
    audio.silence();
    battle.skip();
    vfx.clear();
  },
  retryBattleAssets: retryAssets,
  continueBattle() {
    // Repeated presses while a claim is under way are ignored.
    if (battleState.claiming) return;
    void act({ op: "continue" });
  },
  restart() {
    void act({ op: "restart", clan: selectedClan() });
  },
});

function retryAssets() {
  retrySurfaces();
  for (const b of troops.values()) b.retry();
  battle.retryAssets();
  preparedBattle = null;
  render();
}
preparationRetry.addEventListener("click", () => {
  if (game.state.phase.kind !== "prepare" || preparationRetrying) return;
  preparationRetrying = true;
  retryAssets();
  syncPreparationArt();
});
function syncPreparationArt() {
  if (
    game.state.phase.kind !== "prepare" &&
    preparationPresentation === "ready"
  )
    return;
  let status = structures.assetStatus;
  const surfaces = surfacesStatus();
  if (surfaces === "failed") status = "failed";
  else if (surfaces === "loading" && status === "ready") status = "loading";
  for (const troop of troops.values()) {
    if (troop.status === "failed") status = "failed";
    else if (troop.status === "loading" && status === "ready")
      status = "loading";
  }
  const presentation =
    game.state.phase.kind !== "prepare"
      ? "ready"
      : status === "failed"
        ? "failed"
        : preparationRetrying && status === "loading"
          ? "loading"
          : "ready";
  const recovered = preparationRetrying && presentation === "ready";
  if (presentation !== "loading") preparationRetrying = false;
  if (presentation === preparationPresentation) return;
  preparationPresentation = presentation;
  const retryFocused = document.activeElement === preparationRetry;
  preparationArt.hidden = presentation === "ready";
  preparationRetry.setAttribute(
    "aria-busy",
    String(presentation === "loading"),
  );
  preparationRetry.setAttribute(
    "aria-disabled",
    String(presentation === "loading"),
  );
  preparationRetry.textContent =
    presentation === "loading" ? "Retrying images…" : "Retry images";
  preparationMessage.textContent =
    presentation === "loading"
      ? "Retrying the missing images. Your choices are unchanged."
      : "Your choices are unchanged. Retry to restore the missing images.";
  if (recovered && game.state.phase.kind === "prepare") {
    hud.notice("Polis images restored.");
    if (retryFocused) document.querySelector<HTMLElement>("#ready")?.focus();
  }
}

// Resuming holds an intro for exactly the time it was paused (frame timing plays no part).
function resume() {
  const now = performance.now();
  if (battleState.paused && battleState.pausedAt < battleState.startAt) {
    battleState.startAt += now - battleState.pausedAt;
    battleState.marchAt += now - battleState.pausedAt;
  }
  battleState.paused = false;
  battleState.pausedAt = 0;
  lastFrame = now;
}
function cancelModes() {
  abandonHold();
  if (selection.fate !== null) hud.notice("");
  selection.shop = null;
  selection.fate = null;
  mode = null;
  picked = null;
}

// A repeat of the very action still being sent (a double click) is ignored. Other orders are
// sent in turn; one issued before an earlier order lands may return "stale" (shown as a retry hint).
let inFlight: string | null = null;
const errorText: Record<string, string> = {
  stale: "Your polis changed meanwhile. Try again.",
  invalid: "That action is not possible right now.",
};
async function act(action: Command) {
  // Controls stay focusable while an order awaits confirmation; presses are refused here.
  if (game.connection?.pending) {
    hud.notice("Waiting for your last order to be confirmed…");
    return false;
  }
  const key = JSON.stringify(action);
  if (inFlight === key) {
    hud.notice("Still sending your last order…");
    return false;
  }
  inFlight = key;
  if (action.op === "fate" || action.op === "reroll-fate")
    screens.fateError("");
  try {
    return await send(action);
  } finally {
    if (inFlight === key) inFlight = null;
  }
}
async function send(action: Command) {
  try {
    const upgrade =
      action.op === "buy" &&
      game.state.placements.some((p) => p.tile === action.tile);
    const reply = await dispatch({
      revision: game.state.revision,
      actions: [action],
    });
    // "committed" means the action was saved (the dispatcher already played its sounds) but the
    // local refresh failed: report it without an error cue and carry on as a success.
    const committed =
      reply &&
      typeof reply === "object" &&
      "error" in reply &&
      reply.error === "committed";
    if (committed)
      hud.notice(
        "message" in reply && typeof reply.message === "string"
          ? reply.message
          : "Saved. Refreshing your polis…",
      );
    if (!committed && reply && typeof reply === "object" && "error" in reply) {
      // Async "waiting" is a normal state: the warband is saved until an opponent arrives.
      if (reply.error === "waiting") {
        hud.notice("Your warband is saved · waiting for an opponent");
        render();
        return false;
      }
      audio.play("error");
      const message =
        "message" in reply && typeof reply.message === "string"
          ? reply.message
          : (errorText[String(reply.error)] ?? String(reply.error));
      hud.notice(message);
      render();
      screens.fateError(message);
      return false;
    }
    if ("tile" in action && action.tile !== undefined) {
      const tile = tileById.get(action.tile);
      if (
        tile &&
        ((action.op === "buy" && !upgrade) ||
          action.op === "fate" ||
          action.op === "colonize" ||
          action.op === "assign")
      ) {
        const c = hexToWorld(tile.q, tile.r);
        vfx.placement(
          new THREE.Vector3(c.x, 0, c.z),
          upgrade || action.op === "fate",
        );
      }
    }
    return true;
  } catch (error) {
    audio.play("error");
    const message =
      error instanceof Error ? error.message : "The action failed.";
    hud.notice(message);
    screens.fateError(message);
    return false;
  }
}

// --- Map interaction -------------------------------------------------------
// The session's map getter allocates, so tiles are cached and re-read only when the map changes.
type MapTile = (typeof game.map)[number];
let mapTiles: MapTile[] = [];
let mapScenery: TileSpec[] = [];
// Island ground per tile: a map feature (forest, mountain, stone circle) wins over its terrain.
function scenery(tiles: readonly MapTile[]): TileSpec[] {
  return tiles.map((t) => ({
    q: t.q,
    r: t.r,
    terrain: t.feature ?? t.terrain ?? "hidden",
  }));
}
let mapKey = "";
const tileById = new Map<TileId, MapTile>();
const tileByAxial = new Map<string, MapTile>();
const tileCentres = new Map<TileId, THREE.Vector3>();
function refreshMap() {
  const next = game.map;
  const key = next
    .map((t) => `${t.id}:${t.q}:${t.r}:${t.terrain}:${t.feature}`)
    .join("|");
  if (key === mapKey) return false;
  mapKey = key;
  mapTiles = next;
  mapScenery = scenery(next);
  tileById.clear();
  tileByAxial.clear();
  tileCentres.clear();
  for (const t of next) {
    tileById.set(t.id, t);
    tileByAxial.set(`${t.q},${t.r}`, t);
    const c = hexToWorld(t.q, t.r);
    tileCentres.set(t.id, new THREE.Vector3(c.x, 0, c.z));
  }
  return true;
}
refreshMap();

function tileAtPointer(event: PointerEvent | MouseEvent) {
  return tileAt(event.clientX, event.clientY);
}
function tileAt(x: number, y: number) {
  const p = world.groundPoint(x, y);
  if (!p) return null;
  const { q, r } = worldToHex(p.x, p.z);
  return tileByAxial.get(`${q},${r}`) ?? null;
}
function targets(state: PlayState): TileId[] {
  if (state.phase.kind !== "prepare") return [];
  if (held?.lifted) return moveTargets(state, held.tile);
  const offer = dragged ?? selection.shop;
  if (offer !== null) {
    const item = state.shop[offer];
    if (!item) return [];
    return state.owned.filter((id) => {
      const p = state.placements.find((x) => x.tile === id);
      return p ? p.id === item.id && p.level < 3 : !tileById.get(id)?.feature;
    });
  }
  if (selection.fate !== null) {
    const id = state.fate[selection.fate];
    return id ? fateTargets(state, id, tileById) : [];
  }
  if (mode?.kind === "villager")
    return [
      ...state.placements
        .filter((p) => p.workers < buildings[p.id].workerSlots)
        .map((p) => p.tile),
      ...mapTiles
        .filter((t) => state.fog[t.id] === "unlockable")
        .map((t) => t.id),
    ];
  return [];
}
// Where a held structure may land: any other owned, featureless tile that does not hold the same
// structure (a different one swaps places with it).
function moveTargets(state: PlayState, from: TileId): TileId[] {
  const source = state.placements.find((p) => p.tile === from);
  return state.owned.filter((id) => {
    const target = state.placements.find((p) => p.tile === id);
    return (
      id !== from &&
      !tileById.get(id)?.feature &&
      (!target || target.id !== source?.id)
    );
  });
}

function placementTooltip(
  state: PlayState,
  p: PlayState["placements"][number],
) {
  return buildingTooltip(
    p.id,
    p.level,
    p.workers,
    troopCount(state, p),
    "growth" in p ? p.growth : undefined,
    p.rune,
  );
}
function tileTooltip(state: PlayState, id: TileId | null) {
  const p = state.placements.find((p) => p.tile === id);
  if (p) return placementTooltip(state, p);
  const feature = id === null ? null : tileById.get(id)?.feature;
  return feature && id !== null && state.owned.includes(id)
    ? featureTooltip(
        feature,
        state.featureRunes.find(([tile]) => tile === id)?.[1],
      )
    : null;
}

function showTileTooltip(state: PlayState, id: TileId | null) {
  hud.tooltip(
    id !== null &&
      id === picked &&
      (tileById.get(id)?.feature ||
        state.placements.some((p) => p.tile === id && p.rune))
      ? null
      : tileTooltip(state, id),
  );
}

// Keyboard and assistive access: one focusable button per playable hex, kept over its tile.
const tileLayer = document.createElement("div");
tileLayer.id = "tile-controls";
tileLayer.setAttribute("role", "group");
tileLayer.setAttribute("aria-label", "Settlement tiles");
labels.append(tileLayer);
const tileButtons = new Map<TileId, HTMLButtonElement>();
const tileDescriptionKeys = new Map<TileId, string>();
let focusedTile: TileId | null = null;
let swallowSpace = false;
function moveTileFocus(to: TileId) {
  for (const [id, b] of tileButtons) b.tabIndex = id === to ? 0 : -1;
  tileButtons.get(to)?.focus();
}
function syncTileButtons(state: PlayState) {
  const playable = mapTiles.filter((t) => state.fog[t.id] !== "out-of-bounds");
  for (const [id, b] of tileButtons)
    if (!playable.some((t) => t.id === id)) {
      b.remove();
      tileButtons.delete(id);
      tileDescriptionKeys.delete(id);
    }
  for (const t of playable) {
    let b = tileButtons.get(t.id);
    if (!b) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      button.dataset.focus = `tile:${t.id}`;
      button.addEventListener("click", () => void choose(t.id));
      button.addEventListener("focus", () => {
        focusedTile = t.id;
        tooltipTile = t.id;
        // Keep the keyboard-focused tile on screen.
        const c = tileCentres.get(t.id);
        if (
          c &&
          game.state.phase.kind === "prepare" &&
          button.matches(":focus-visible")
        )
          world.flyTo({ x: c.x, z: c.z + 0.6 });
        overlay.setHover(t);
        if (held?.pointer === null) hoverTile(t.id);
        else showTileTooltip(game.state, t.id);
      });
      button.addEventListener("blur", () => {
        tooltipTile = null;
        overlay.setHover(null);
        hud.tooltip(null);
      });
      button.addEventListener("keydown", (event) => {
        // Holding from the keyboard: Space or Enter drops here (on its own tile, puts it back).
        if (
          held?.pointer === null &&
          (event.key === " " || event.key === "Enter")
        ) {
          event.preventDefault();
          if (!event.repeat) release({ sale: false, tile: t.id });
          swallowSpace = event.key === " ";
          // Nor may an Enter that dropped act on the tile (colonise it) as it auto-repeats.
          if (event.key === "Enter") enterEndedHold = true;
          return;
        }
        if (event.key === " " && !event.repeat && holdByKey(t.id)) {
          event.preventDefault();
          swallowSpace = true;
          return;
        }
        const delta = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        const next = tileByAxial.get(`${t.q + delta[0]!},${t.r + delta[1]!}`);
        if (next && tileButtons.has(next.id)) moveTileFocus(next.id);
      });
      // A Space that picked up or dropped a structure must not also press the button on release.
      button.addEventListener("keyup", (event) => {
        if (event.key !== " " || !swallowSpace) return;
        event.preventDefault();
        swallowSpace = false;
      });
      tileLayer.append(button);
      tileButtons.set(t.id, button);
      b = button;
    }
    const p = state.placements.find((x) => x.tile === t.id);
    const rune = state.featureRunes.find(([tile]) => tile === t.id)?.[1];
    b.setAttribute(
      "aria-label",
      foggedTiles.has(t.id)
        ? `Tile ${t.id}, unexplored`
        : `Tile ${t.id}, ${t.terrain}, ${state.owned.includes(t.id) ? "owned" : "unclaimed"}${p ? `, ${buildings[p.id].name}, level ${p.level}, ${p.workers} workers${p.rune ? `, Charm: ${fates[p.rune].name}` : ""}` : t.feature ? `, ${t.feature.replaceAll("-", " ")}${rune ? `, Charm: ${fates[rune].name}` : ""}` : ", empty"}`,
    );
    b.setAttribute("aria-pressed", String(picked === t.id));
    if (p) b.setAttribute("aria-keyshortcuts", "Space");
    else b.removeAttribute("aria-keyshortcuts");
    const descriptionKey =
      !foggedTiles.has(t.id) && (p || (t.feature && state.owned.includes(t.id)))
        ? JSON.stringify([p, p ? troopCount(state, p) : t.feature, rune])
        : "";
    if (descriptionKey !== (tileDescriptionKeys.get(t.id) ?? "")) {
      b.replaceChildren();
      b.removeAttribute("aria-describedby");
      const tip = descriptionKey ? tileTooltip(state, t.id) : null;
      if (tip) {
        const description = document.createElement("span");
        description.id = `tile-description-${t.id}`;
        description.hidden = true;
        description.innerHTML = tip.body;
        description.prepend((tip.tags ?? []).join(" ") + " ");
        b.append(description);
        b.setAttribute("aria-describedby", description.id);
      }
      tileDescriptionKeys.set(t.id, descriptionKey);
    }
    // Tiles are only interactive while preparing; in battle they leave the tab order.
    b.tabIndex =
      state.phase.kind === "prepare" && t.id === (focusedTile ?? startTile)
        ? 0
        : -1;
  }
}

const actionsPopup = document.createElement("div");
actionsPopup.className = "tile-actions";
actionsPopup.hidden = true;
app.append(actionsPopup);
const seasonHeader = app.querySelector<HTMLElement>(".hud-season");
if (!seasonHeader) throw new Error("Missing season header");
const popupLayout = { width: 0, height: 0, top: 8 };
let popupProjection = "";
const popupResize = new ResizeObserver(() => {
  popupLayout.top = seasonHeader.getBoundingClientRect().bottom + 8;
  app.style.setProperty("--polis-header-bottom", `${popupLayout.top}px`);
  const width = actionsPopup.offsetWidth;
  const height = actionsPopup.offsetHeight;
  if (!width || !height) return;
  popupLayout.width = width;
  popupLayout.height = height;
  popupProjection = "";
  projectPopup();
});
for (const node of [actionsPopup, app, seasonHeader]) popupResize.observe(node);
controller.signal.addEventListener("abort", () => popupResize.disconnect(), {
  once: true,
});
let actionsKey = "";
function syncActions(state: PlayState, preparing: boolean) {
  const p =
    picked === null ? null : state.placements.find((x) => x.tile === picked);
  const feature =
    picked === null || !state.owned.includes(picked)
      ? null
      : tileById.get(picked)?.feature;
  const rune = state.featureRunes.find(([tile]) => tile === picked)?.[1];
  // Structures with nothing to assign or read have no popup: they move and sell by dragging.
  const content = p
    ? Boolean(p.rune || buildings[p.id].workerSlots)
    : Boolean(feature);
  actionsPopup.hidden = !content || !preparing;
  const key = p
    ? JSON.stringify([
        p,
        state.workers,
        state.blessings,
        preparing,
        p.rune ? troopCount(state, p) : null,
      ])
    : feature
      ? JSON.stringify([picked, feature, rune, preparing])
      : "";
  if (!content || key === actionsKey) return;
  actionsKey = key;
  actionsPopup.replaceChildren();
  if (!p) {
    if (!feature) return;
    const tip = featureTooltip(feature, rune);
    const heading = document.createElement("strong");
    heading.textContent = tip.title;
    const charm = document.createElement("div");
    charm.className = "item-details";
    charm.innerHTML = tip.body;
    actionsPopup.append(heading, charm);
    return;
  }
  const d = buildings[p.id];
  if (p.rune) {
    const tip = placementTooltip(state, p);
    const heading = document.createElement("strong");
    heading.textContent = `${tip.title} · ${tip.rarity}`;
    const details = document.createElement("div");
    details.className = "item-details";
    const tags = document.createElement("p");
    tags.textContent = tip.tags?.join(" · ") ?? "";
    details.innerHTML = tip.body;
    details.prepend(tags);
    actionsPopup.append(heading, details);
  }
  if (d.workerSlots) {
    const role = villagerRole(p.id);
    if (role) {
      const line = document.createElement("p");
      line.className = "role";
      line.textContent = role;
      actionsPopup.append(line);
    }
    const b = document.createElement("button");
    b.id = "assign";
    b.dataset.focus = "assign";
    b.innerHTML = `${icons.worker}<span>Assign villager</span><small>${p.workers}/${d.workerSlots}${d.minimumWorkers ? ` · min ${d.minimumWorkers}` : ""}</small>`;
    b.disabled = !state.workers || p.workers >= d.workerSlots;
    b.addEventListener("click", () => void act({ op: "assign", tile: p.tile }));
    actionsPopup.append(b);
  }
}

async function choose(id: TileId) {
  const state = game.state;
  if (state.phase.kind !== "prepare") return;
  if (game.connection?.pending) {
    hud.notice("Waiting for your last order to be confirmed…");
    return;
  }
  audio.play("select");
  if (selection.shop !== null) {
    if (await act({ op: "buy", slot: selection.shop, tile: id }))
      selection.shop = null;
  } else if (selection.fate !== null) {
    const offer = state.fate[selection.fate];
    if (offer && !fateTargets(state, offer, tileById).includes(id)) {
      audio.play("error");
      hud.notice(
        `${fates[offer].name} cannot target this ${fates[offer].kind === "rune" ? "item" : "structure"}`,
      );
    } else if (await act({ op: "fate", slot: selection.fate, tile: id }))
      selection.fate = null;
  } else if (mode?.kind === "villager") {
    const owned = state.owned.includes(id);
    if (
      await act(
        owned ? { op: "assign", tile: id } : { op: "colonize", tile: id },
      )
    )
      if (!game.state.workers) mode = null;
  } else if (!state.owned.includes(id) && state.workers > 0) {
    // With a villager to spare, an unclaimed bordering tile can be colonised directly.
    if (state.fog[id] === "unlockable") await act({ op: "colonize", tile: id });
  } else {
    picked =
      state.placements.some((p) => p.tile === id) ||
      (state.owned.includes(id) && Boolean(tileById.get(id)?.feature))
        ? picked === id
          ? null
          : id
        : null;
  }
  render();
}
// A structure held with the pointer (pressed, then lifted once the pointer travels) or the
// keyboard (Space on its tile). Dropped on another owned tile it moves (a different structure
// swaps places); on the villager hex, which then shows the sale price, it is sold; anywhere else
// nothing happens.
type Hold = {
  tile: TileId;
  // The held placement as picked up: a refresh that changes it (another tab) ends the hold.
  placement: string;
  // null while held from the keyboard.
  pointer: number | null;
  x: number;
  y: number;
  lifted: boolean;
  sale: { drachmas: number; label: string } | null;
  overSale: boolean;
};
type Drop = { sale: boolean; tile: TileId | null };
let held: Hold | null = null;
let enterEndedHold = false;
// Pointers whose next click belongs to a structure drag (another pointer's events leave it).
const suppressed = new Set<number>();
const holdThreshold = 6;
function canHold(state: PlayState) {
  return (
    state.phase.kind === "prepare" &&
    !game.connection?.pending &&
    dragged === null &&
    selection.shop === null &&
    selection.fate === null &&
    !mode
  );
}
function pickUp(
  p: PlayState["placements"][number],
  pointer: number | null,
  x = 0,
  y = 0,
): Hold {
  return {
    tile: p.tile,
    placement: JSON.stringify(p),
    pointer,
    x,
    y,
    lifted: false,
    sale: saleQuote(game.state, p),
    overSale: false,
  };
}
// What selling the placement returns now (blessings can change it while it is held).
function saleQuote(state: PlayState, p: PlayState["placements"][number]) {
  const returned = saleReturns(state, p);
  return (
    returned && {
      drachmas: returned.drachmas,
      label: `Sell ${buildings[p.id].name} for ${[
        `${returned.drachmas} Drachmas`,
        ...(returned.workers
          ? [`${returned.workers} Villager${returned.workers === 1 ? "" : "s"}`]
          : []),
        ...(returned.insight ? [`${returned.insight} Insight`] : []),
      ].join(", ")}`,
    }
  );
}
function lift(h: Hold) {
  h.lifted = true;
  picked = null;
  audio.play("select");
  hud.notice("");
  hud.tooltip(null);
  if (h.sale) hud.sell({ ...h.sale, hot: false });
  syncHeld();
  render();
}
function syncHeld() {
  const lifted = held?.lifted ? held.tile : null;
  for (const [key, b] of troops)
    b.group.visible =
      battleState.key === "" && key.split(":")[0] !== String(lifted);
  labelsDirty = true;
}
// Shows the held structure over a ground point and highlights the tile it would land on.
function hover(h: Hold, ground: { x: number; z: number } | null, over: Drop) {
  if (ground) structures.hold("polis", String(h.tile), ground);
  const tile =
    over.tile !== null && moveTargets(game.state, h.tile).includes(over.tile)
      ? tileById.get(over.tile)
      : undefined;
  overlay.setHover(tile ?? null);
  const overSale = Boolean(h.sale) && over.sale;
  if (h.sale && overSale !== h.overSale) {
    h.overSale = overSale;
    hud.sell({ ...h.sale, hot: overSale });
  }
}
function release(drop: Drop | null) {
  const h = held;
  if (!h) return;
  const state = game.state;
  held = null;
  overlay.setHover(null);
  canvas.style.cursor = "";
  hud.sell(null);
  // The click that follows the pointer's release belongs to the drag; an abandoned press (Escape,
  // a shop pick, a pinch) clicks nothing either, lifted or not.
  if (h.pointer !== null && (h.lifted || !drop)) suppressed.add(h.pointer);
  if (!h.lifted) return;
  // Keyboard instructions end with the hold; later error notices still show.
  if (h.pointer === null) hud.notice("");
  structures.hold("polis", String(h.tile), null);
  syncHeld();
  const action: Command | null =
    state.phase.kind !== "prepare" || !drop
      ? null
      : drop.sale && h.sale
        ? { op: "sell", tile: h.tile }
        : drop.tile !== null && moveTargets(state, h.tile).includes(drop.tile)
          ? { op: "move", from: h.tile, to: drop.tile }
          : null;
  if (action) {
    audio.play("select");
    void act(action).then(render);
  } else render();
}
function abandonHold() {
  release(null);
}

function dropAt(x: number, y: number): Drop {
  const under = document.elementFromPoint(x, y);
  return {
    sale: Boolean(under?.closest("#villager")),
    tile: under === canvas ? (tileAt(x, y)?.id ?? null) : null,
  };
}
world.claimPress((event, pinch) => {
  if (held || pinch) {
    // A pinch, another finger, or a press while holding from the keyboard abandons the hold. A
    // pinch's fingers then click nothing, lifted or not (no camera drag marks them).
    if (pinch) {
      suppressed.add(event.pointerId);
      if (held?.pointer != null) suppressed.add(held.pointer);
    }
    if (held && event.pointerId !== held.pointer) abandonHold();
    return false;
  }
  const state = game.state;
  if (event.button !== 0 || !canHold(state)) return false;
  const tile = tileAtPointer(event);
  const p = tile && state.placements.find((x) => x.tile === tile.id);
  if (!p) return false;
  held = pickUp(p, event.pointerId, event.clientX, event.clientY);
  canvas.setPointerCapture(event.pointerId);
  return true;
});
addEventListener(
  "pointermove",
  (event) => {
    const h = held;
    if (!h || event.pointerId !== h.pointer) return;
    if (!h.lifted) {
      if (Math.hypot(event.clientX - h.x, event.clientY - h.y) < holdThreshold)
        return;
      canvas.style.cursor = "grabbing";
      lift(h);
    }
    hover(
      h,
      world.groundPoint(event.clientX, event.clientY),
      dropAt(event.clientX, event.clientY),
    );
  },
  { signal: controller.signal },
);
addEventListener(
  "pointerup",
  (event) => {
    if (held && event.pointerId === held.pointer)
      release(dropAt(event.clientX, event.clientY));
    const id = event.pointerId;
    if (suppressed.has(id)) setTimeout(() => suppressed.delete(id), 0);
  },
  { signal: controller.signal },
);
addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter" && event.repeat && enterEndedHold) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
  { capture: true, signal: controller.signal },
);
addEventListener(
  "keyup",
  (event) => {
    if (event.key === "Enter") enterEndedHold = false;
  },
  { signal: controller.signal },
);
// A pointer's new press starts a new gesture: no click of its own left to swallow.
addEventListener("pointerdown", (event) => suppressed.delete(event.pointerId), {
  capture: true,
  signal: controller.signal,
});
addEventListener(
  "pointercancel",
  (event) => {
    if (held && event.pointerId === held.pointer) abandonHold();
  },
  { signal: controller.signal },
);
canvas.addEventListener("lostpointercapture", (event) => {
  if (held && event.pointerId === held.pointer) abandonHold();
});
// Keyboard: Space on a structure's tile picks it up; Space or Enter on another tile drops it
// there, Enter on the villager hex sells it, Escape puts it back.
function holdByKey(id: TileId) {
  const state = game.state;
  const p = state.placements.find((x) => x.tile === id);
  // One hold at a time: a pointer may already be carrying a structure.
  if (!p || held || !canHold(state)) return false;
  const h = pickUp(p, null);
  held = h;
  lift(h);
  hoverTile(id);
  hud.notice(
    `Holding ${buildings[p.id].name}: Space on a tile moves it${h.sale ? ", Enter on the villager sells it" : ""}`,
  );
  return true;
}
// Keyboard holds follow tile focus.
function hoverTile(id: TileId) {
  const c = tileCentres.get(id);
  if (held?.pointer === null && c) hover(held, c, { sale: false, tile: id });
}
canvas.addEventListener("click", (event) => {
  // Clicks are PointerEvents carrying their pointer; one without is treated as the drag's.
  const id =
    (event as Partial<PointerEvent>).pointerId ??
    suppressed.values().next().value;
  if (id !== undefined && suppressed.delete(id)) return;
  if (world.dragged()) return;
  const tile = tileAtPointer(event);
  if (tile) void choose(tile.id);
  else {
    cancelModes();
    render();
  }
});
// Right-click cancels on release: on macOS and Linux contextmenu fires on press, before a
// right-drag pan could be told apart from a click.
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("pointerup", (event) => {
  if (event.button !== 2 || world.dragged()) return;
  cancelModes();
  render();
});
addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") return;
    // Esc first closes an open "Partial" details popover, not the Fate dialog under it.
    if (document.querySelector(".fate-unknown:popover-open")) return;
    if (screens.settingsOpen) {
      screens.settings(false);
      return;
    }
    if (screens.fateOpen) {
      cancelFateAudio();
      screens.fate(null);
    }
    hud.cancelDrag();
    cancelModes();
    render();
  },
  { signal: controller.signal },
);
let hovered: TileId | null = null;
canvas.addEventListener("pointermove", (event) => {
  // A held structure owns the cursor and the hover highlight.
  if (held?.lifted) return;
  const tile = tileAtPointer(event);
  const id = tile?.id ?? null;
  if (id === hovered) return;
  hovered = id;
  tooltipTile = id;
  const state = game.state;
  overlay.setHover(tile && state.phase.kind === "prepare" ? tile : null);
  showTileTooltip(state, id);
  canvas.style.cursor =
    tile && targets(state).includes(tile.id) ? "pointer" : "";
});
canvas.addEventListener("pointerleave", () => {
  hovered = null;
  tooltipTile = null;
  overlay.setHover(null);
  hud.tooltip(null);
});

// --- Settlement presentation ----------------------------------------------
const badges = new Map<TileId, { el: HTMLElement; key: string }>();
function badgeAt(tile: TileId) {
  let badge = badges.get(tile);
  if (!badge) {
    const el = document.createElement("div");
    el.className = "badge";
    labels.append(el);
    badge = { el, key: "" };
    badges.set(tile, badge);
  }
  return badge;
}
const troops = new Map<string, Billboard>();
function modelFor(clan: PlayState["clan"], id: keyof typeof buildings) {
  return id === "polis-hall" && clan === "raven"
    ? "arcadia-hall"
    : buildings[id].sprite;
}
// Across the water: the rival's frozen settlement (territory and buildings) while its PvP replay
// is on screen. Nothing about a rival is shown before its battle is resolved. The ground stays
// the fixed scenery: every map shares the same hex grid, and rebuilding the island's terrain at
// battle start froze the page for over a second on laptop GPUs.
function rivalSettlement(state: PlayState) {
  // A replay that only arrives while a saved result is being claimed is never played, so its
  // settlement is not shown either.
  const claimingSaved =
    battleState.claimed && battleState.key === `${state.battleId}:saved`;
  const layout =
    state.phase.kind === "result" && !claimingSaved
      ? (state.phase.encounter?.opponentLayout ?? null)
      : null;
  if (!layout) return { owned: [], fog: UNEXPLORED, placed: [] };
  const byId = new Map(layout.map.map(([id, q, r]) => [id, { q, r }] as const));
  return {
    owned: layout.owned.flatMap((id) => byId.get(id) ?? []),
    fog: engineFog(layout.owned),
    placed: layout.placements.flatMap(([tile, id, level]) => {
      const t = byId.get(tile);
      if (!t) return [];
      const model = modelFor(layout.clan, id);
      return [{ key: String(tile), q: t.q, r: t.r, model, level }];
    }),
  };
}
// Fog of war comes from the engine: unlocked tiles are clear, unlockable ones show through a
// thin mist, hidden and out-of-bounds tiles stay covered.
const fogDensity: Record<FogState, number> = {
  unlocked: 0,
  unlockable: 0.4,
  hidden: 1,
  "out-of-bounds": 1,
};
const UNEXPLORED = engineFog([]);
let foggedTiles = new Set<TileId>();
// Each tile's last fog ("side:q,r"): fog that clears fades, fog that returns (a new run, a rival
// leaving) is instant so the terrain under it never shows.
let lastFog = new Map<string, number>();
function fogCells(
  side: Side,
  tiles: readonly { id: TileId; q: number; r: number }[],
  states: readonly FogState[],
): FogCell[] {
  return tiles.map(({ id, q, r }) => ({
    side,
    q,
    r,
    fog: fogDensity[states[id] ?? "hidden"],
  }));
}
function syncFog(state: PlayState, rivalFog: readonly FogState[]) {
  const polis = fogCells("polis", mapTiles, state.fog);
  // The rival's island is fogged too, around its settlement while that is on screen.
  const rival = fogCells("opponent", RIVAL_MAP, rivalFog);
  const cells = [...polis, ...rival];
  const next = new Map(cells.map((c) => [`${c.side}:${c.q},${c.r}`, c.fog]));
  const returns = [...next].some(
    ([key, fog]) => fog > (lastFog.get(key) ?? -1),
  );
  lastFog = next;
  world.clouds.fog(cells, reduced || returns);
  island.setFogged(
    new Set([...next].flatMap(([key, fog]) => (fog === 1 ? [key] : []))),
  );
  // How many rival tiles show through the fog (0 outside a loaded PvP replay).
  screensRoot.dataset.rivalExplored = String(
    rival.filter((c) => c.fog < 1).length,
  );
  foggedTiles = new Set(
    mapTiles.flatMap((t) =>
      fogDensity[state.fog[t.id] ?? "hidden"] === 1 ? [t.id] : [],
    ),
  );
}
function syncSettlement(state: PlayState) {
  const rival = rivalSettlement(state);
  island.build({
    polis: { tiles: mapScenery },
    opponent: { tiles: RIVAL_SCENERY },
  });
  syncFog(state, rival.fog);
  const placed = state.placements.flatMap((p) => {
    const t = tileById.get(p.tile);
    return t ? [{ p, t }] : [];
  });
  island.setOccupied([
    ...placed.map(({ t }) => ({ side: "polis" as const, q: t.q, r: t.r })),
    ...rival.placed.map((p) => ({ side: "opponent" as const, q: p.q, r: p.r })),
  ]);
  overlay.setTerritory(
    "polis",
    state.owned.flatMap((id) => tileById.get(id) ?? []),
  );
  overlay.setTerritory("opponent", rival.owned);
  structures.set("opponent", rival.placed);
  // How many rival buildings stand across the water (0 outside a loaded PvP replay).
  screensRoot.dataset.rivalBuildings = String(rival.placed.length);
  const models: BuildingPlacement[] = placed.map(({ p, t }) => ({
    key: String(p.tile),
    q: t.q,
    r: t.r,
    model: modelFor(state.clan, p.id),
    level: Math.min(p.level, 4),
  }));
  structures.set("polis", models);
  // Structures the Agora offers again can level up: they glow while preparing.
  const offered = new Set(
    state.shop.flatMap((item) => (item ? [item.id] : [])),
  );
  structures.glow(
    "polis",
    new Set(
      state.phase.kind === "prepare"
        ? placed.flatMap(({ p }) =>
            offered.has(p.id) && p.level < 3 ? [String(p.tile)] : [],
          )
        : [],
    ),
  );
  // Badges: category hex, villager pips and level, like the source settlement labels.
  const keep = new Set<TileId>();
  for (const { p } of placed) {
    keep.add(p.tile);
    const badge = badgeAt(p.tile);
    const key = JSON.stringify(p);
    if (badge.key === key) continue;
    badge.key = key;
    badge.el.removeAttribute("role");
    badge.el.removeAttribute("aria-label");
    const d = buildings[p.id];
    const pips = d.workerSlots
      ? `<span class="pips">${Array.from({ length: d.workerSlots }, (_, i) => `<i class="${i < p.workers ? "on" : ""}">${icons.worker}</i>`).join("")}</span>`
      : "";
    badge.el.innerHTML = `<span class="hex ${d.tags[0] ?? ""}">${p.rune ? `<img src="${fates[p.rune].art}" alt="">` : ""}</span>${pips}<b>${p.level}</b>`;
  }
  for (const [tile, rune] of state.featureRunes) {
    keep.add(tile);
    const badge = badgeAt(tile);
    const key = `feature:${rune}`;
    if (badge.key === key) continue;
    badge.key = key;
    badge.el.setAttribute("role", "img");
    badge.el.setAttribute("aria-label", `Charm: ${fates[rune].name}`);
    badge.el.innerHTML = `<span class="hex"><img src="${fates[rune].art}" alt=""></span><b>Charm</b>`;
  }
  for (const [tile, badge] of badges)
    if (!keep.has(tile)) {
      badge.el.remove();
      badges.delete(tile);
    }
  // Idle troops stand in front of their camps; the chief waits by the hall.
  const wanted = new Map<
    string,
    { sprite: string; chief: boolean; at: THREE.Vector3 }
  >();
  for (const { p, t } of placed) {
    const c = hexToWorld(t.q, t.r);
    const sprite =
      p.id === "polis-hall"
        ? clans[state.clan].portrait
        : buildings[p.id].troop?.id;
    if (!sprite) continue;
    const count = troopCount(state, p);
    for (let i = 0; i < count; i++)
      wanted.set(`${p.tile}:${sprite}:${i}`, {
        sprite,
        chief: p.id === "polis-hall",
        at: new THREE.Vector3(c.x + 0.45 + i * 0.22, 0, c.z + 0.5 - i * 0.12),
      });
  }
  for (const [key, b] of troops)
    if (!wanted.has(key)) {
      world.scene.remove(b.group);
      b.dispose();
      troops.delete(key);
    }
  for (const [key, w] of wanted) {
    let b = troops.get(key);
    if (!b) {
      b = createBillboard(w.sprite, world.upload, w.chief ? 1.15 : 0.9);
      b.group.visible = battleState.key === "";
      world.scene.add(b.group);
      troops.set(key, b);
    }
    b.group.position.copy(w.at);
  }
  labelsDirty = true;
}

let seasonGoal = { snow: 0, autumn: 0, summer: 0 };
function applySeason(state: PlayState) {
  seasonGoal = seasonBlend(state.season);
  weather.set(state.season);
  // One streaming ambience loop per season; repeated calls with the same season are idempotent.
  audio.setSeason(state.season);
}

// --- Render ----------------------------------------------------------------
let lastMessage = "";
let announced = "";
function announceRound(state: PlayState) {
  if (state.phase.kind !== "prepare") return;
  const key = `${state.round}:${state.season}`;
  if (key === announced) return;
  const first = announced === "";
  const newSeason = !first && !announced.endsWith(`:${state.season}`);
  announced = key;
  if (first) return;
  const title = newSeason
    ? `${seasonNames[state.season]} arrives`
    : `Round ${state.round}`;
  const detail = newSeason ? `Round ${state.round}` : seasonNames[state.season];
  hud.announce(title, detail);
  hud.notice(`${title} · ${detail}`);
}
function render() {
  if (rendererFailed) return;
  // Rebuilt controls must not swallow keyboard focus: remember it and restore by key.
  const active = document.activeElement;
  const focusKey =
    active instanceof HTMLElement ? (active.dataset.focus ?? active.id) : "";
  const inPopup =
    active instanceof HTMLElement && actionsPopup.contains(active);
  const state = game.state;
  if (state.tutorial && state.tutorial.stage !== tutorialStage) {
    const previous = tutorialStage;
    tutorialStage = state.tutorial.stage;
    if (state.phase.kind === "prepare" && tutorialStage === "fate")
      screens.fate(state, state.insight);
    else if (previous === "fate") screens.fate(null);
  }
  refreshMap();
  if (
    held &&
    (state.phase.kind !== "prepare" ||
      !state.placements.some((p) => JSON.stringify(p) === held!.placement))
  )
    abandonHold();
  else if (held) {
    const p = state.placements.find((x) => x.tile === held!.tile)!;
    const sale = saleQuote(state, p);
    if (JSON.stringify(sale) !== JSON.stringify(held.sale)) {
      held.sale = sale;
      if (held.lifted)
        hud.sell(sale && { ...sale, hot: held.overSale && Boolean(sale) });
    }
  }
  const context = preparationKey(state);
  if (context !== selectionContext) {
    selectionContext = context;
    selection.shop = selection.fate = null;
    if (mode?.kind === "villager" && !state.workers) mode = null;
  }
  // Background polls mark the session busy; only an unresolved request blocks the controls
  // (actions already serialise on the session lock), so polls never flicker the HUD.
  const busy = Boolean(game.connection?.busy);
  const blocked = Boolean(game.connection?.pending);
  const preparing = state.phase.kind === "prepare";
  syncSettlement(state);
  syncTileButtons(state);
  applySeason(state);
  announceRound(state);
  overlay.setTargets(targets(state).flatMap((id) => tileById.get(id) ?? []));
  hud.render(state, selection, {
    preparing,
    locked: blocked,
    // Async rivals see the server guest name, which may predate a preference rename.
    playerName: game.connection?.guest ?? preferences().name,
    villagerSelected: mode?.kind === "villager",
  });
  if (state.tutorial) {
    const ready = document.querySelector<HTMLButtonElement>("#ready");
    if (ready)
      ready.disabled ||=
        state.tutorial.stage !== "prepare" || tutorialBlocked(state.tutorial);
  }
  if (screens.fateOpen) {
    if (state.phase.kind !== "prepare") cancelFateAudio();
    screens.fate(state.phase.kind === "prepare" ? state : null, state.insight);
  }
  screens.season(state.phase.kind === "season" ? state : null);
  screens.income(state.phase.kind === "income");
  screens.finished(
    state.phase.kind === "finished" ? state : null,
    network ? (game.connection?.queue ?? "unranked") : null,
  );
  if (network && state.phase.kind === "finished") showAward(state.revision);
  syncActions(state, preparing && !blocked);
  if (tooltipTile !== null) {
    showTileTooltip(state, tooltipTile);
  }
  // Async connection status.
  const connection = game.connection;
  const status = !network
    ? ""
    : connection?.message ||
      (connection?.pending
        ? connection.pending.status === "waiting"
          ? "Waiting for another player's warband this round…"
          : "Confirming your saved request…"
        : "");
  // A poll clears the message while it runs; keep the last banner until it settles.
  if (status || !busy)
    screens.connection(
      status,
      connection?.pending || connection?.message
        ? {
            retry: () => void game.recover(),
            ...(connection?.pending?.status === "waiting"
              ? { cancel: () => void game.recover(true) }
              : {}),
          }
        : {},
      busy,
    );
  // Battle lifecycle: a replay that arrives after its result restarts the presentation.
  if (state.phase.kind === "result") {
    const key = `${state.phase.battleId}:${state.phase.encounter ? "replay" : "saved"}`;
    // Claiming loads a missing replay first; the result was already shown, so do not restart.
    const keepSaved =
      battleState.claimed &&
      battleState.key === `${state.phase.battleId}:saved`;
    if (key !== battleState.key && !keepSaved) beginBattle(state);
    if (!state.phase.encounter || keepSaved) savedResult(state);
    else if (battleState.resultShown) showResult();
  } else if (battleState.key !== "") endBattle();
  // Each distinct message is announced once, even if polling clears and restores it.
  const message = game.message;
  if (message && message !== lastMessage) {
    hud.notice(message);
    lastMessage = message;
  }
  lesson?.refresh(state, battleState.resultShown);
  const popupClosed = inPopup && actionsPopup.hidden;
  if (
    focusKey &&
    active instanceof HTMLElement &&
    (!active.isConnected || popupClosed)
  ) {
    const replacement = [
      ...document.querySelectorAll<HTMLElement>("[data-focus], button[id]"),
    ].find(
      (el) =>
        (el.dataset.focus ?? el.id) === focusKey &&
        !(el instanceof HTMLButtonElement && el.disabled) &&
        !el.closest("[hidden]"),
    );
    if (replacement) replacement.focus();
    else if (inPopup && focusedTile !== null)
      moveTileFocus(picked ?? focusedTile);
  }
  // A control that just disappeared (result banner after Continue, HUD hidden by a saved
  // result, run screen after Restart) hands focus to the screen that replaced it.
  // A control removed outright (an emptied connection banner) drops focus onto the page.
  const dropped =
    document.activeElement === active ||
    document.activeElement === document.body;
  if (
    active instanceof HTMLElement &&
    dropped &&
    (!active.isConnected || !visible(active) || active.matches(":disabled")) &&
    // An open dialog keeps focus inside itself rather than handing it to the HUD behind.
    !screens.focusDialog()
  ) {
    const next =
      state.phase.kind === "income"
        ? "#income-status"
        : state.phase.kind === "season"
          ? ".season-option:not(:disabled)"
          : state.phase.kind === "result"
            ? "#continue-battle"
            : state.phase.kind === "finished"
              ? "#restart"
              : "#ready";
    const target = document.querySelector<HTMLElement>(next);
    if (target && visible(target)) target.focus();
  }
}
// checkVisibility() needs Safari 17.4; older engines fall back to having layout boxes.
function visible(element: HTMLElement) {
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility()
    : (element as Element).getClientRects().length > 0;
}

function beginBattle(state: PlayState) {
  preparedBattle = null;
  const encounter =
    state.phase.kind === "result" ? state.phase.encounter : null;
  battleState.key = `${state.battleId}:${encounter ? "replay" : "saved"}`;
  battleState.resultShown = false;
  battleState.resultClock = 0;
  battleState.skipped = false;
  battleState.settled = false;
  battleState.claiming = false;
  battleState.claimed = false;
  battleState.paused = false;
  battleState.pausedAt = 0;
  audio.reset();
  cancelModes();
  battle.clear();
  vfx.clear();
  screens.result(null);
  screens.battle(false);
  screens.versus(null);
  for (const b of troops.values()) b.group.visible = false;
  world.flyTo(ARENA);
  // The opening receipt is taken again for each battle.
  delete screensRoot.dataset.framedOpening;
  if (!encounter) return;
  // Fighters march out of their buildings: polis tiles from our map, rival tiles from the
  // frozen opponent settlement. Synthetic warbands (no origin) wait in formation.
  const rivalTiles = new Map(
    (encounter.opponentLayout?.map ?? []).map(([id, q, r]) => [id, { q, r }]),
  );
  battle.start(encounter, (fighter) => {
    if (!fighter.origin) return null;
    const { side, tile } = fighter.origin;
    const at = side === "polis" ? tileById.get(tile) : rivalTiles.get(tile);
    if (!at) return null;
    const c = hexToWorld(at.q, at.r, side);
    return new THREE.Vector3(c.x, 0, c.z);
  });
  const now = performance.now();
  const marching = battle.marches && !reduced;
  battleState.introClock = 0;
  battleState.introAt = now;
  battleState.startAt = reduced
    ? now
    : marching
      ? now + VERSUS_MS - VERSUS_FADE_MS + MARCH_MS
      : now + VERSUS_MS;
  battleState.marchAt = marching
    ? battleState.startAt - MARCH_MS
    : battleState.startAt;
  if (!reduced)
    screens.versus(
      state,
      state.battle?.opponent ?? "Opponent",
      game.connection?.guest ?? preferences().name,
    );
  // The battle-start cue plays once, when a real replay begins.
  audio.play("battle-start");
}
function endBattle() {
  preparedBattle = null;
  battleState.key = "";
  battleState.resultClock = 0;
  battle.clear();
  vfx.clear();
  screens.battle(false);
  screens.result(null);
  screens.versus(null);
  for (const b of troops.values()) b.group.visible = true;
  world.flyTo(home());
}
function battleLabel(kind: string | undefined) {
  return kind === "pve"
    ? "Mythical beasts"
    : kind === "training"
      ? "Training"
      : "Rival polis";
}
// A saved result whose replay is not loaded. While the session is still fetching it, the
// winner stays hidden; once settled without a replay, the authoritative winner is shown.
function savedResult(state: PlayState) {
  if (game.connection?.busy && !battleState.settled) {
    screens.result("loading", "Your result is saved. Loading the replay…");
    return;
  }
  screens.result(
    state.battle?.winner ?? "draw",
    `Your result is saved. · ${battleLabel(state.battle?.kind)}`,
    true,
    battleState.claiming,
  );
  if (battleState.settled) return;
  battleState.settled = true;
  // Focus parked on the page while Continue was disabled moves onto it.
  if (document.activeElement === document.body)
    document.querySelector<HTMLElement>("#continue-without-replay")?.focus();
}
function showResult() {
  const c = battle.combat;
  if (!c?.result) return;
  screens.result(
    c.result.winner,
    `${c.result.survivors[0]} of your warriors stand · ${battleLabel(game.state.battle?.kind)}`,
    false,
    battleState.claiming || Boolean(game.connection?.pending),
  );
}

// Labels follow the camera; reproject only when it or the settlement changed.
let labelsDirty = true;
const lastCamera = new THREE.Matrix4();
const lastProjection = new THREE.Matrix4();
let lastResize = -1;
const scratch = new THREE.Vector3();
function projectLabels(fighting: boolean) {
  world.camera.updateMatrixWorld();
  // Resizes change the projection (aspect, portrait field of view) without moving the camera.
  if (
    !labelsDirty &&
    lastCamera.equals(world.camera.matrixWorld) &&
    lastProjection.equals(world.camera.projectionMatrix) &&
    lastResize === world.resizes
  )
    return;
  lastResize = world.resizes;
  labelsDirty = false;
  lastCamera.copy(world.camera.matrixWorld);
  lastProjection.copy(world.camera.projectionMatrix);
  for (const [tile, badge] of badges) {
    const c = tileCentres.get(tile);
    if (!c) continue;
    const s = world.project(scratch.set(c.x, 0, c.z + 0.62));
    badge.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    badge.el.hidden =
      !s.visible || fighting || (held?.lifted === true && held.tile === tile);
  }
  for (const [id, b] of tileButtons) {
    const c = tileCentres.get(id);
    if (!c) continue;
    const s = world.project(c);
    b.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
  }
}
// The open tile popup follows its structure every frame; it is a single element.
function projectPopup() {
  const c = picked === null ? undefined : tileCentres.get(picked);
  if (!c || actionsPopup.hidden) return;
  const s = world.project(scratch.set(c.x, 1.3, c.z));
  const { width, height } = popupLayout;
  if (!width || !height) return;
  const x = Math.max(8, Math.min(innerWidth - width - 8, s.x - width / 2));
  const y = Math.max(
    8,
    Math.min(innerHeight - height - 8, Math.max(popupLayout.top, s.y - height)),
  );
  const projection = `${x},${y}`;
  if (projection === popupProjection) return;
  popupProjection = projection;
  actionsPopup.style.transform = `translate(${x}px, ${y}px)`;
}

const clearZone = new THREE.Vector4();
let wasFighting = false;
// A hidden tab draws no frames. A paused intro is held by its pause (card frozen by CSS).
// Unpaused, the versus card's CSS keeps time while hidden, so only the march is held: it
// resumes where it stood when the tab was hidden (or begins, if the card ran out).
let hiddenAt = 0;
document.addEventListener(
  "visibilitychange",
  () => {
    const now = performance.now();
    if (document.hidden) {
      hiddenAt = now;
      return;
    }
    const since = hiddenAt;
    hiddenAt = 0;
    // The pause hold and walk cycle measure from here, not across the hidden time.
    lastFrame = now;
    if (!since || !battleState.key || since >= battleState.startAt) return;
    // A paused intro is already held by its pause; a battle that began while hidden is held
    // only from its own start.
    if (battleState.paused) return;
    const from = Math.max(since, battleState.introAt);
    if (!battle.marches || now < battleState.marchAt) return;
    const progress = Math.min(
      1,
      Math.max(0, (from - battleState.marchAt) / MARCH_MS),
    );
    battleState.marchAt = now - progress * MARCH_MS;
    battleState.startAt = battleState.marchAt + MARCH_MS;
  },
  { signal: controller.signal },
);
// Refit live formations at a bounded cadence; a distance deadband avoids step-by-step zoom.
let framedFighters = false;
let framedBattleAt = -1;
let framedResizes = -1;
let framedStarted = false;
let framingElapsed = 0;
let framedFit: ReturnType<typeof world.fitPoints> | null = null;
const FRAMING_FAR = 80;
world.onFrame((dt) => {
  // Season blend and cloud opening follow the phase smoothly.
  const k = reduced ? 1 : 1 - Math.exp(-dt * 1.5);
  shared.uSnow.value += (seasonGoal.snow - shared.uSnow.value) * k;
  shared.uAutumn.value += (seasonGoal.autumn - shared.uAutumn.value) * k;
  shared.uSummer.value += (seasonGoal.summer - shared.uSummer.value) * k;
  const fighting = battleState.key !== "";
  world.setIdle(!fighting);
  if (fighting !== wasFighting) labelsDirty = true;
  wasFighting = fighting;
  // A rotation or resize across portrait re-frames an unsteered preparation camera.
  if (
    !fighting &&
    world.camera.aspect < 1 !== homedPortrait &&
    world.steeredAt <= homedAt
  )
    world.flyTo(home(), true);
  if (fighting) clearZone.set(0, 0, 21.5, 9.5);
  else clearZone.set(HOME.x, 0, 9, 7.5);
  world.clouds.clear.value.lerp(clearZone, reduced ? 1 : 1 - Math.exp(-dt * 2));
  world.clouds.lift(fighting);
  world.clouds.tick(dt, reduced);
  structures.tick();
  syncPreparationArt();
  if (!fighting)
    for (const b of troops.values()) {
      b.face(world.camera);
      b.show("idle", 0, 1);
    }
  projectLabels(fighting);
  projectPopup();
  const now = performance.now();
  const elapsed = now - lastFrame;
  lastFrame = now;
  const preparingAssets =
    Boolean(battle.combat && !battle.combat.result) &&
    battleAssetStatus() !== "ready" &&
    !battleState.skipped;
  const heldForPresentation =
    !battleState.skipped && (preparingAssets || !world.available);
  vfx.setRate(
    fighting && (battleState.paused || heldForPresentation)
      ? 0
      : fighting
        ? battleState.speed
        : 1,
  );
  if (fighting && battle.combat && heldForPresentation && !battleState.paused) {
    battleState.startAt += elapsed;
    battleState.marchAt += elapsed;
  }
  const loadingPresentation = String(fighting && heldForPresentation);
  if (screensRoot.dataset.loadingPresentation !== loadingPresentation)
    screensRoot.dataset.loadingPresentation = loadingPresentation;
  const clock = battleState.paused ? battleState.pausedAt : now;
  // The intro stage is published for styling and checks: versus card, then the march-out.
  const intro =
    !fighting || !battle.combat || clock >= battleState.startAt
      ? ""
      : clock < battleState.marchAt
        ? "versus"
        : "march";
  if (screensRoot.dataset.intro !== intro) screensRoot.dataset.intro = intro;
  if (intro !== "march" && screensRoot.dataset.march)
    delete screensRoot.dataset.march;
  // Paused screens freeze their CSS animations (the versus card) along with the intro.
  const paused = String(fighting && battleState.paused);
  if (screensRoot.dataset.paused !== paused)
    screensRoot.dataset.paused = paused;
  if (!fighting || !battle.combat) {
    if (framedFighters) screensRoot.dataset.framing = "";
    framedFighters = false;
    return;
  }
  const started = clock >= battleState.startAt;
  const unsteered = world.steeredAt < battleState.introAt;
  const framing = unsteered && battle.combat.units.length > 0;
  if (framing && battle.assetStatus === "ready") {
    framingElapsed += dt;
    const changed =
      framedBattleAt !== battleState.introAt ||
      framedResizes !== world.resizes ||
      started !== framedStarted;
    if (changed || (started && framingElapsed >= 0.25)) {
      const fit = world.fitPoints(battle.framingPoints(!started, !started));
      if (
        !changed &&
        framedFit &&
        fit.distance < framedFit.distance &&
        fit.distance > framedFit.distance * 0.9
      )
        fit.distance = framedFit.distance;
      framedFit = fit;
      framingElapsed = 0;
      world.flyTo(fit, false, Math.max(FRAMING_FAR, fit.distance));
      framedBattleAt = battleState.introAt;
      framedResizes = world.resizes;
      framedStarted = started;
    }
    if (
      started &&
      framedFit &&
      Math.abs(world.focus.distance - framedFit.distance) < 0.02 &&
      Math.abs(world.focus.x - framedFit.x) < 0.02 &&
      Math.abs(world.focus.z - framedFit.z) < 0.02 &&
      screensRoot.dataset.framedOpening === undefined
    ) {
      const points = battle.framingPoints(false);
      let seen = 0;
      for (let i = 0; i < points.length; i += 4) {
        if (
          points.slice(i, i + 4).every((p) => {
            const ndc = p.project(world.camera);
            return (
              Math.abs(ndc.x) <= 1 &&
              ndc.y >= -0.65 &&
              ndc.y <= 0.75 &&
              ndc.z < 1
            );
          })
        )
          seen++;
      }
      screensRoot.dataset.framedOpening = `${seen}/${points.length / 4}`;
    }
  }
  if (framing !== framedFighters)
    screensRoot.dataset.framing = framing ? "fighters" : "";
  framedFighters = framing;
  if (
    !battleState.paused &&
    !heldForPresentation &&
    clock < battleState.startAt
  )
    battleState.introClock += elapsed / 1000;
  if (!started) {
    const progress = Math.min(
      1,
      Math.max(0, (clock - battleState.marchAt) / MARCH_MS),
    );
    battle.march(progress, battleState.introClock);
    // March progress in tenths, published (like the stage) only while marching.
    const step = (Math.floor(progress * 10) / 10).toFixed(1);
    if (intro === "march" && screensRoot.dataset.march !== step)
      screensRoot.dataset.march = step;
  }
  if (started) {
    screens.versus(null);
    if (!battleState.paused && !heldForPresentation) {
      const fresh = battle.step(dt, battleState.speed, reduced);
      // Only this frame's new events sound. Skipped and reduced-motion battles resolve at
      // once, so theirs stay silent (and are not replayed if reduced motion is switched off).
      if (!battleState.skipped && !reduced)
        audio.consume(fresh, battle.combat.units);
    }
    const c = battle.combat;
    if (
      c.result &&
      !battleState.resultShown &&
      !battleState.paused &&
      !heldForPresentation
    ) {
      battleState.resultClock += dt;
      if (
        battleState.resultClock >= (battleState.skipped || reduced ? 0 : 0.9)
      ) {
        battleState.resultShown = true;
        battleState.resultClock = 0;
        if (!battleState.skipped)
          audio.play(c.result.winner === "polis" ? "victory" : "defeat");
        showResult();
        // Keyboard users land on Continue when the battle bar they were using disappears.
        const focused = document.activeElement;
        if (
          focused === document.body ||
          (focused instanceof HTMLElement && focused.closest(".battle-bar"))
        )
          document.querySelector<HTMLElement>("#continue-battle")?.focus();
        lesson?.refresh(game.state, true);
      }
    }
  }
  screens.battle(
    !battleState.resultShown,
    battle.balance(),
    battleState.speed,
    battleState.paused,
    battle.combat.ticks * tickSeconds,
    battleAssetStatus(),
    world.available,
  );
});

world.flyTo(home(), true);
game.subscribe(render);
render();
// Shaders compile behind the loading veil rather than mid-battle, including every building
// surface a rival's settlement might use and the arrow projectile. A restored GPU context has
// lost them all, so it warms up again.
async function warmShaders() {
  const samples = surfaceSamples();
  const sampleFighter = battle.sample();
  samples.group.add(vfx.sample(), sampleFighter.group);
  samples.group.position.set(HOME.x, -0.5, HOME.z);
  try {
    await world.precompile(samples.group);
  } finally {
    samples.dispose();
    sampleFighter.dispose();
  }
}
function failRenderer(error: unknown) {
  if (rendererFailed) return;
  rendererFailed = true;
  controller.abort();
  world.stop();
  audio.dispose();
  cancelFateAudio();
  game.subscribe(() => {});
  console.error("3D view warmup failed", error);
  app!.innerHTML = `<div class="loading" id="loading"><div class="loading-mark" aria-hidden="true">Ω</div><h1 id="renderer-startup-error" tabindex="-1">The 3D view could not start</h1><p id="startup-error" role="status">Reload to try again, or return to the menu. Your saved campaigns are kept.</p><nav class="startup-actions" aria-label="3D view recovery"><button id="reload-renderer">Reload</button><a href="${appUrl("/")}">Back to menu</a></nav></div>`;
  app!
    .querySelector("#reload-renderer")!
    .addEventListener("click", () => location.reload());
  app!.querySelector<HTMLElement>("#renderer-startup-error")!.focus();
}
canvas.addEventListener(
  "webglcontextlost",
  () => {
    preparedBattle = null;
  },
  { signal: controller.signal },
);
canvas.addEventListener(
  "webglcontextrestored",
  () => {
    void (async () => {
      for (const b of troops.values()) b.upload();
      battle.uploadAssets();
      await warmShaders();
    })().catch(failRenderer);
  },
  { signal: controller.signal },
);
await warmShaders().catch(failRenderer);
// A battle restored at startup began its intro under the veil; start it again in view.
if (!rendererFailed) {
  if (battleState.key) {
    battleState.key = "";
    render();
  }
  const loading = app.querySelector("#loading");
  loading?.classList.add("done");
  setTimeout(() => loading?.remove(), 900);
}
addEventListener("pagehide", (event) => {
  if (network || !event.persisted) controller.abort();
  if (network) {
    world.stop();
    audio.dispose();
    app.replaceChildren();
  }
});
addEventListener("pageshow", (event) => {
  if (network && event.persisted) location.replace(appUrl("/"));
});
