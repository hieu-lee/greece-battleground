import { appUrl } from "../urls.ts";
import { clans, skillUpgradeText } from "../clans.ts";
import { fates, levelCaps } from "../rules.ts";
import type { PlayState } from "../read-model.ts";
import type { Command } from "../game.ts";
import { escapeHtml, fateKindNames, richText } from "./hud.ts";
import { icons } from "./icons.ts";
import { rivalClan, seasonNames } from "./display.ts";
import { preferences, savePreferences } from "../preferences.ts";

// Modal dialogs in stacking order (later ones open above earlier ones). One document-level
// listener keeps Tab inside the topmost open dialog, including focus that slipped out of it
// (a pressed control became disabled, or the dialog opened while the page had focus).
const modals: HTMLElement[] = [];
const focusable = "input, select, button:not(:disabled), a[href]";
// Controls a dialog can focus right now (rendered, enabled).
const controlsIn = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(focusable)].filter(
    (control) => control.getClientRects().length > 0,
  );
addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const top = modals.findLast((modal) => !modal.hidden);
  if (!top) return;
  const controls = controlsIn(top);
  const first = controls[0],
    last = controls.at(-1);
  if (!top.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
function trapFocus(container: HTMLElement) {
  modals.push(container);
}
// A background phase arriving under Settings must not take its keyboard focus.
function enter(container: HTMLElement) {
  if (modals.findLast((modal) => !modal.hidden) !== container) return;
  if (
    !container.contains(document.activeElement) ||
    document.activeElement?.matches(":disabled")
  )
    controlsIn(container)[0]?.focus();
}

function layer(root: HTMLElement, className: string) {
  const node = document.createElement("div");
  node.className = "screen " + className;
  node.hidden = true;
  root.append(node);
  return node;
}

const patronNames = { zeus: "Zeus", athena: "Athena", apollo: "Apollo" };
const tierNames = { 4: "Base", 8: "Bronze", 16: "Silver", 32: "Gold" };

export function createScreens(
  root: HTMLElement,
  handlers: {
    act(command: Command): Promise<boolean>;
    closeFate(): void;
    // A Charm or spell offer: close the dialog and pick its target structure.
    targetFate(slot: number): void;
    speed(value: number): void;
    pause(): void;
    incomePause(paused: boolean): void;
    skip(): void;
    retryBattleAssets(): void;
    continueBattle(): void;
    restart(): void;
  },
) {
  const income = layer(root, "income-screen");
  income.innerHTML = `<section id="income-status" class="income-card" role="status" tabindex="-1"><h2>Collecting income…</h2><p class="sr-only">The shop opens when collection finishes.</p></section>`;
  const fate = layer(root, "fate-screen");
  fate.setAttribute("role", "dialog");
  fate.setAttribute("aria-modal", "true");
  fate.setAttribute("aria-label", "Fate offers");
  let fateOpener: HTMLElement | null = null;
  trapFocus(fate);
  const season = layer(root, "season-screen");
  season.setAttribute("role", "dialog");
  season.setAttribute("aria-modal", "true");
  season.setAttribute("aria-label", "Season improvement");
  trapFocus(season);
  const versus = layer(root, "versus-screen");
  const battleBar = layer(root, "battle-bar");
  const result = layer(root, "result-banner");
  const finished = layer(root, "run-screen");
  finished.setAttribute("role", "dialog");
  finished.setAttribute("aria-modal", "true");
  finished.setAttribute("aria-label", "Campaign ended");
  finished.setAttribute("aria-labelledby", "run-title");
  finished.setAttribute("aria-describedby", "run-detail run-recap run-next");
  trapFocus(finished);
  const connection = layer(root, "connection-banner");
  // The connection banner moves into the topmost open dialog, so its Retry and Cancel stay
  // reachable by Tab (and exposed to assistive tech) while an aria-modal dialog is up.
  new MutationObserver(() => {
    const home = modals.findLast((modal) => !modal.hidden) ?? root;
    if (connection.parentElement !== home) home.append(connection);
  }).observe(root, {
    subtree: true,
    // Child changes too: a dialog rebuilt with innerHTML would otherwise drop the banner.
    childList: true,
    attributeFilter: ["hidden"],
  });
  const settings = layer(root, "settings-screen");
  settings.setAttribute("role", "dialog");
  settings.setAttribute("aria-modal", "true");
  settings.setAttribute("aria-label", "Settings");
  settings.innerHTML = `<form class="settings-card" id="game-settings"><h2>Settings</h2>
<label>Master volume<input type="range" name="master" min="0" max="100"></label>
<label>Effects volume<input type="range" name="effects" min="0" max="100"></label>
<label>Music volume<input type="range" name="music" min="0" max="100"></label>
<label class="check"><input type="checkbox" name="muted">Mute all sound</label>
<label class="check"><input type="checkbox" name="reduce">Reduce motion</label>
<fieldset><legend>Video</legend><label>Render resolution<select name="resolution"><option value="auto">Auto</option><option value="lower">Lower (1×)</option></select></label></fieldset>
<fieldset><legend>Input</legend><label>Camera pan speed <output id="game-pan-speed-value"></output><input type="range" name="panSpeed" min="0.5" max="2" step="0.1"></label><label class="check"><input type="checkbox" name="reverseWheel">Reverse mouse-wheel zoom</label><small>Pan speed changes drag and keyboard movement. Touch pinch keeps its natural direction.</small></fieldset>
<output id="settings-status" role="status"></output>
<div class="settings-actions"><button type="button" id="settings-give-up" class="give-up">Give Up</button></div>
<div class="settings-actions"><button type="button" id="settings-resume">Resume</button><a href="${appUrl("/")}" id="settings-menu">Main menu</a></div></form>`;
  const form = settings.querySelector("form")!;
  const giveUp = form.querySelector<HTMLButtonElement>("#settings-give-up")!;
  let giveUpBlocked = false;
  const status = form.querySelector("#settings-status")!;
  const panValue = form.querySelector("#game-pan-speed-value")!;
  const resolution = form.querySelector<HTMLSelectElement>(
    '[name="resolution"]',
  )!;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  function fill() {
    const p = preferences();
    field("master").value = String(Math.round(p.master * 100));
    field("effects").value = String(Math.round(p.effects * 100));
    field("music").value = String(Math.round(p.music * 100));
    field("muted").checked = p.muted;
    field("reduce").checked = p.motion === "reduce";
    resolution.value = p.resolution;
    field("panSpeed").value = String(p.panSpeed);
    panValue.textContent = p.panSpeed.toFixed(1) + "×";
    field("reverseWheel").checked = p.reverseWheel;
  }
  form.addEventListener("input", () => {
    try {
      savePreferences({
        ...preferences(),
        resolution: resolution.value,
        panSpeed: Number(field("panSpeed").value),
        reverseWheel: field("reverseWheel").checked,
        master: Number(field("master").value) / 100,
        effects: Number(field("effects").value) / 100,
        music: Number(field("music").value) / 100,
        muted: field("muted").checked,
        motion: field("reduce").checked ? "reduce" : "system",
      });
      panValue.textContent = Number(field("panSpeed").value).toFixed(1) + "×";
      status.textContent = "";
    } catch {
      fill();
      status.textContent =
        "Settings could not be saved. Your settings were not changed. Allow browser storage and try again.";
    }
  });
  addEventListener("storage", () => {
    if (!settings.hidden) fill();
  });
  form.addEventListener("submit", (event) => event.preventDefault());
  // Modal settings: focus stays inside while open and returns to its opener on close.
  let opener: HTMLElement | null = null;
  function closeSettings() {
    if (settings.hidden) return;
    settings.hidden = true;
    handlers.incomePause(false);
    const top = modals.findLast((modal) => !modal.hidden);
    if (top) enter(top);
    else opener?.focus();
    opener = null;
  }
  settings
    .querySelector("#settings-resume")!
    .addEventListener("click", closeSettings);
  giveUp.addEventListener("click", async () => {
    if (
      !confirm(
        "Give up this campaign? This ends your run and cannot be undone. Online runs use the usual abandonment rating and XP rules.",
      )
    )
      return;
    giveUp.disabled = true;
    const ended = await handlers.act({ op: "give-up" });
    giveUp.disabled = giveUpBlocked;
    if (ended) closeSettings();
    else
      status.textContent =
        "Could not give up. Check the connection message and try again.";
  });
  settings.addEventListener("click", (event) => {
    if (event.target === settings) closeSettings();
  });
  trapFocus(settings);

  fate.innerHTML = `<div class="fate-backdrop"></div><header><p id="fate-error" role="alert" hidden></p></header><div class="fate-cards" id="fate-cards"></div><footer><button class="fate-reroll" id="reroll-fate">${icons.reroll}<b><img src="${appUrl(`/ui/insight.webp`)}" alt=""><span id="fate-reroll-price"></span></b></button><button class="fate-close" id="close-fate" aria-label="Return to polis" title="Return to polis">${icons.eye}</button></footer>`;
  fate
    .querySelector("#close-fate")!
    .addEventListener("click", () => handlers.closeFate());
  fate
    .querySelector("#reroll-fate")!
    .addEventListener("click", () => handlers.act({ op: "reroll-fate" }));

  battleBar.innerHTML = `<div class="balance"><span class="side polis" id="balance-polis"></span><i>${icons.swords}</i><span class="side opponent" id="balance-opponent"></span></div><div class="speeds"><button data-speed="1" aria-label="Normal speed">${icons.speed1}</button><button data-speed="2" aria-label="Double speed">${icons.speed2}</button><button data-speed="4" aria-label="Fast speed">${icons.speed3}</button><button data-pause id="pause-battle" aria-label="Pause">${icons.pause}</button><button data-skip id="skip-battle" class="skip">Skip</button></div>`;
  const balancePolis = battleBar.querySelector<HTMLElement>("#balance-polis")!;
  const balanceOpponent =
    battleBar.querySelector<HTMLElement>("#balance-opponent")!;
  const speedButtons = [
    ...battleBar.querySelectorAll<HTMLButtonElement>("[data-speed]"),
  ];
  const pauseButton =
    battleBar.querySelector<HTMLButtonElement>("[data-pause]")!;
  const clock = document.createElement("output");
  clock.id = "battle-clock";
  clock.setAttribute("aria-label", "Elapsed battle time");
  battleBar.append(clock);
  const artStatus = document.createElement("p");
  artStatus.id = "battle-art-status";
  artStatus.setAttribute("role", "status");
  const retryArt = document.createElement("button");
  retryArt.id = "retry-battle-assets";
  retryArt.textContent = "Retry battle images";
  retryArt.addEventListener("click", () => handlers.retryBattleAssets());
  battleBar.append(artStatus, retryArt);
  for (const b of battleBar.querySelectorAll<HTMLButtonElement>("[data-speed]"))
    b.addEventListener("click", () => handlers.speed(Number(b.dataset.speed)));
  battleBar
    .querySelector("[data-pause]")!
    .addEventListener("click", () => handlers.pause());
  battleBar
    .querySelector("[data-skip]")!
    .addEventListener("click", () => handlers.skip());

  // The ribbon announces each outcome, and Continue is described by it when focused.
  result.innerHTML = `<div class="ribbon" role="status"><h2 id="result-title"></h2><p id="result-detail"></p></div><button class="continue" id="continue-battle" aria-describedby="result-title result-detail">Continue</button>`;
  result
    .querySelector("#continue-battle")!
    .addEventListener("click", () => handlers.continueBattle());
  const continueWithoutReplay = document.createElement("button");
  continueWithoutReplay.id = "continue-without-replay";
  continueWithoutReplay.className = "continue";
  continueWithoutReplay.textContent = "Continue without replay";
  continueWithoutReplay.hidden = true;
  continueWithoutReplay.setAttribute(
    "aria-describedby",
    "result-title result-detail",
  );
  continueWithoutReplay.addEventListener("click", () =>
    handlers.continueBattle(),
  );
  result.append(continueWithoutReplay);

  finished.innerHTML = `<div class="run-card"><h2 id="run-title"></h2><p id="run-polis" class="run-polis"></p><p id="run-detail"></p><dl id="run-recap" class="run-recap"><div><dt>Season reached</dt><dd id="run-season"></dd></div><div><dt>Lives remaining</dt><dd id="run-lives"></dd></div><div><dt>Polis Hall</dt><dd id="run-hall"></dd></div><div><dt>Structures settled</dt><dd id="run-structures"></dd></div></dl><p id="run-award" role="status"></p><p id="run-next" class="run-next sr-only">Found a new polis to begin a fresh campaign, or return to the main menu.</p><div class="run-actions"><button id="restart">Found a new polis</button><a href="${appUrl("/")}">Main menu</a></div></div>`;
  finished
    .querySelector("#restart")!
    .addEventListener("click", () => handlers.restart());

  const fateError = fate.querySelector<HTMLElement>("#fate-error")!;
  function showFateError(message: string) {
    fateError.textContent = message;
    fateError.hidden = !message;
  }
  return {
    giveUp(available: boolean, blocked: boolean) {
      giveUpBlocked = blocked;
      giveUp.parentElement!.hidden = !available;
      giveUp.disabled = blocked;
      giveUp.title = blocked
        ? "Resolve your pending order or cancel waiting first."
        : "";
    },
    income(active: boolean) {
      income.hidden = !active;
    },
    fateError: showFateError,
    fate(state: PlayState | null, insight = 0) {
      const opening = Boolean(state) && fate.hidden;
      if (opening || !state) showFateError("");
      if (!state) {
        if (!fate.hidden) {
          fate.hidden = true;
          fate.dataset.key = "";
          fateOpener?.focus();
          fateOpener = null;
        }
        return;
      }
      if (opening)
        fateOpener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      fate.hidden = false;
      const reroll = state.rerollCosts[1];
      const woven = state.fateChosen;
      const empty = state.fate.every((id) => id === null);
      fate.querySelector("#fate-reroll-price")!.textContent =
        reroll === null ? "–" : String(reroll);
      const rerollButton =
        fate.querySelector<HTMLButtonElement>("#reroll-fate")!;
      rerollButton.disabled = woven || reroll === null || insight < reroll;
      rerollButton.setAttribute(
        "aria-label",
        reroll === null
          ? "Reroll offers, none left"
          : `Reroll offers, ${reroll} Insight`,
      );
      rerollButton.title = woven
        ? "Your Fate is woven this round"
        : reroll === null
          ? "No Fate rerolls remain this round"
          : "";
      const key = JSON.stringify([state.fate, woven, insight]);
      if (fate.dataset.key !== key) {
        fate.dataset.key = key;
        const cards = fate.querySelector("#fate-cards")!;
        cards.classList.toggle("woven", woven);
        cards.replaceChildren(
          ...(woven || empty
            ? [
                Object.assign(document.createElement("p"), {
                  className: "fate-woven",
                  textContent: woven
                    ? "Your Fate is woven. New offers arrive next round."
                    : "No eligible offers on this roll. Reroll again or return to your polis.",
                }),
              ]
            : []),
          ...state.fate.map((id, slot) => {
            const offer = document.createElement("div");
            offer.className = "fate-offer";
            const card = document.createElement("button");
            card.className = "fate-card";
            card.dataset.focus = `fate:${slot}`;
            card.dataset.fateSlot = String(slot);
            offer.append(card);
            if (!id) {
              card.classList.add("taken");
              card.disabled = true;
              card.innerHTML = `<span class="taken-label">${woven ? "Woven" : "No eligible offer"}</span>`;
              if (woven || empty) offer.hidden = true;
              return offer;
            }
            const f = fates[id];
            const god =
              f.favor[0] ??
              f.unlock.map(([patron]) => patron).find((p) => p !== "generic") ??
              "apollo";
            // Each favour entry raises that patron's counter in the HUD's top-left corner.
            const patrons = [...new Set(f.favor)].map(
              (p) => [p, f.favor.filter((x) => x === p).length] as const,
            );
            const gained = patrons.map(([p, n]) => `+${n} ${patronNames[p]}`);
            const targeted = f.kind === "rune" || f.kind === "spell";
            card.dataset.kind = f.kind;
            card.dataset.god = god;
            card.dataset.tier = tierNames[f.cost].toLowerCase();
            card.dataset.status = f.status;
            card.style.setProperty(
              "--art",
              `url("${appUrl(`/ui/card-${god}.webp`)}")`,
            );
            card.innerHTML = `<span class="card-art"><img src="${appUrl(f.art)}" alt=""></span>${patrons.length ? `<span class="card-gods">${patrons.map(([p, n]) => `<span class="card-god" data-god="${p}"><img src="${appUrl(`/ui/god-${p}.webp`)}" alt="">${n > 1 ? `<b>${n}</b>` : ""}</span>`).join("")}</span>` : ""}<span class="cost"><img src="${appUrl(`/ui/insight.webp`)}" alt="">${f.cost}</span><h3>${escapeHtml(f.name)}</h3><span class="card-body"><span class="kind">${fateKindNames[f.kind]}</span><span class="text">${richText(f.text)}</span></span>`;
            card.setAttribute(
              "aria-label",
              `${f.name}, ${fateKindNames[f.kind]}, ${f.cost} Insight. ${f.text}${gained.length ? ` ${gained.join(" ")} favour.` : ""}${targeted ? " Then choose its structure." : ""}${f.unknown.length ? " Partial: some source effects are not applied." : ""}`,
            );
            card.dataset.affordable = String(insight >= f.cost);
            card.addEventListener("click", async () => {
              if (targeted) handlers.targetFate(slot);
              else if (await handlers.act({ op: "fate", slot }))
                handlers.closeFate();
            });
            if (f.unknown.length) {
              // Unknown source pieces stay one tap away (native popover: touch, keyboard, Esc).
              const panel = document.createElement("div");
              panel.id = `fate-unknown-${slot}`;
              panel.className = "fate-unknown";
              panel.popover = "auto";
              panel.innerHTML = `<b>Partial: not applied</b><ul>${f.unknown.map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul>`;
              const toggle = document.createElement("button");
              toggle.className = "fate-partial";
              toggle.type = "button";
              toggle.textContent = "Partial";
              toggle.dataset.focus = `fate-partial:${slot}`;
              toggle.setAttribute("popovertarget", panel.id);
              toggle.setAttribute(
                "aria-label",
                `${f.name}: show the source effects that are not applied`,
              );
              offer.append(toggle, panel);
            }
            return offer;
          }),
        );
      }
      // Availability toggles in place so focused cards survive.
      for (const card of fate.querySelectorAll<HTMLButtonElement>(
        ".fate-card[data-affordable]",
      ))
        card.disabled = card.dataset.affordable !== "true";
      if (opening)
        (
          fate.querySelector<HTMLElement>(".fate-card:not(:disabled)") ??
          fate.querySelector<HTMLElement>("#close-fate")
        )?.focus();
    },
    season(state: PlayState | null) {
      const opening = Boolean(state) && season.hidden;
      season.hidden = !state;
      if (!state) return;
      // Rebuild only when the choices change so polling keeps focus.
      const key = JSON.stringify([
        state.clan,
        state.skills,
        state.season,
        state.placements,
      ]);
      if (season.dataset.key !== key) {
        season.dataset.key = key;
        const clan = clans[state.clan];
        const hallMaxed = state.placements.some(
          (p) => p.id === "polis-hall" && p.level === levelCaps.hall,
        );
        const options: {
          choice: Extract<Command, { op: "upgrade" }>["choice"];
          title: string;
          text: string;
          icon: string;
          tier: string;
          disabled: boolean;
        }[] = [
          {
            choice: "hall",
            title: "Polis Hall",
            text: "Improve your Hall: +2 Drachmas and +1 Insight base income.",
            icon: "/art/icon-drachma.webp",
            tier: hallMaxed ? "Maximum level" : "Improve your Hall",
            disabled: hallMaxed,
          },
          ...clan.skills.map((skill, i) => ({
            choice: (["skill-0", "skill-1", "skill-2"] as const)[i]!,
            title: skill.name,
            text: skillUpgradeText(skill, state.skills[i] ?? levelCaps.skill),
            tier:
              state.skills[i] === levelCaps.skill
                ? "Maximum level"
                : `Level ${state.skills[i]} → ${Math.min(levelCaps.skill, (state.skills[i] ?? levelCaps.skill) + 1)}`,
            icon: `/art/icon-${skill.icon}.webp`,
            disabled: state.skills[i] === levelCaps.skill,
          })),
        ];
        season.innerHTML = `<div class="season-card"><h2>${seasonNames[state.season]} arrives</h2><p>Choose one improvement for your polis.</p><div class="season-options" id="season-choices"></div></div>`;
        season.querySelector(".season-options")!.replaceChildren(
          ...options.map((o) => {
            const b = document.createElement("button");
            b.className = "season-option";
            b.dataset.focus = `season:${o.choice}`;
            b.dataset.allowed = String(!o.disabled);
            b.innerHTML = `<img src="${appUrl(o.icon)}" alt=""><b>${escapeHtml(o.title)}</b><span class="season-tier">${escapeHtml(o.tier)}</span><span class="season-effect">${escapeHtml(o.text)}</span>`;
            b.addEventListener("click", () =>
              handlers.act({ op: "upgrade", choice: o.choice }),
            );
            return b;
          }),
        );
      }
      for (const b of season.querySelectorAll<HTMLButtonElement>(
        ".season-option",
      ))
        b.disabled = b.dataset.allowed !== "true";
      if (opening) enter(season);
    },
    versus(state: PlayState | null, opponent = "", player = "You") {
      if (versus.hidden !== !state) versus.hidden = !state;
      if (!state) return;
      const clan = clans[state.clan];
      // Only a rival polis's chief gets a portrait; practice and beast warbands get a banner.
      const foe = rivalClan(state);
      const rival = foe
        ? `<img src="${appUrl(`/ui/chief-${foe.portrait}.webp`)}" alt=""><div class="banner"><span class="shield"><img src="${appUrl(`/art/icon-${foe.crest}.webp`)}" alt=""></span><b>${escapeHtml(opponent)}</b></div>`
        : `<div class="banner"><b>${escapeHtml(opponent)}</b></div>`;
      versus.innerHTML = `<div class="versus-side left"><img src="${appUrl(`/ui/chief-${clan.portrait}.webp`)}" alt=""><div class="banner"><b>${escapeHtml(player)}</b><span class="shield"><img src="${appUrl(`/art/icon-${clan.crest}.webp`)}" alt=""></span></div></div><div class="versus-emblem">${icons.swords}</div><div class="versus-side right">${rival}</div>`;
      versus.classList.remove("play");
      void versus.offsetWidth;
      versus.classList.add("play");
    },
    battle(
      visible: boolean,
      balance: readonly [number, number] = [0, 0],
      speed = 1,
      paused = false,
      seconds = 0,
      assets: "loading" | "ready" | "failed" = "ready",
      graphicsAvailable = true,
    ) {
      const elapsed = `${seconds.toFixed(1)}s`;
      if (clock.textContent !== elapsed) clock.textContent = elapsed;
      const notice = !graphicsAvailable
        ? "Graphics interrupted. Waiting to restore your battle…"
        : assets === "loading"
          ? "Preparing battle images…"
          : assets === "failed"
            ? "Battle images could not load. Retry or skip to your saved result."
            : "";
      if (artStatus.textContent !== notice) artStatus.textContent = notice;
      artStatus.hidden = !notice;
      retryArt.hidden = assets !== "failed";
      if (battleBar.hidden === visible) battleBar.hidden = !visible;
      if (!visible) return;
      const total = Math.max(1, balance[0] + balance[1]);
      const share = Math.round((balance[0] / total) * 1000) / 1000;
      // Called every frame during battle: touch the DOM only when something changed.
      const key = `${share}:${speed}:${paused}`;
      if (battleBar.dataset.key === key) return;
      battleBar.dataset.key = key;
      balancePolis.style.flexGrow = String(share);
      balanceOpponent.style.flexGrow = String(1 - share);
      for (const b of speedButtons)
        b.setAttribute(
          "aria-pressed",
          String(Number(b.dataset.speed) === speed && !paused),
        );
      pauseButton.setAttribute("aria-pressed", String(paused));
    },
    /** A missing replay keeps normal Continue disabled and offers an explicit fallback. */
    result(
      outcome: "polis" | "opponent" | "draw" | "loading" | null,
      detail = "",
      replayMissing = false,
      claiming = false,
    ) {
      result.hidden = !outcome;
      if (!outcome) {
        result.dataset.key = "";
        continueWithoutReplay.hidden = true;
        return;
      }
      // Rewrite only on change: the ribbon is a live region and renders repeat on every poll.
      const key = JSON.stringify([outcome, detail, replayMissing, claiming]);
      if (result.dataset.key === key) return;
      result.dataset.key = key;
      result.dataset.outcome = outcome;
      result.querySelector("#result-title")!.textContent =
        outcome === "polis"
          ? "Victory"
          : outcome === "opponent"
            ? "Defeat"
            : outcome === "draw"
              ? "Draw"
              : "Battle fought";
      result.querySelector("#result-detail")!.textContent = detail;
      // Claiming before the replay arrives would skip the battle the player has yet to see.
      result.querySelector<HTMLButtonElement>("#continue-battle")!.disabled =
        outcome === "loading" || replayMissing || claiming;
      continueWithoutReplay.hidden = !replayMissing;
      continueWithoutReplay.disabled = claiming;
    },
    finished(
      state: PlayState | null,
      queue: "ranked" | "unranked" | null = null,
    ) {
      const opening = Boolean(state) && finished.hidden;
      finished.hidden = !state;
      if (!state || state.phase.kind !== "finished") return;
      if (opening) enter(finished);
      const { outcome } = state.phase;
      // Surviving to the round limit is an honourable end, shown with the victory art.
      finished.dataset.outcome = outcome === "defeat" ? "defeat" : "victory";
      finished.querySelector("#run-title")!.textContent =
        outcome === "victory"
          ? "Glory to your polis"
          : outcome === "round-limit"
            ? "Your campaign is complete"
            : "Your polis has fallen";
      // The round counter has already advanced past the last round fought.
      const rounds = outcome === "round-limit" ? state.round - 1 : state.round;
      finished.querySelector("#run-detail")!.textContent =
        `${state.wins} victories in ${rounds} rounds · ${queue === "ranked" ? "Ranked Play" : queue ? "Freeplay" : state.mode === "tutorial" ? "Tutorial" : "Practice"}`;
      const clan = clans[state.clan];
      finished.querySelector("#run-polis")!.textContent =
        `${clan.name} · ${clan.chief}`;
      finished.querySelector("#run-season")!.textContent =
        seasonNames[state.season];
      finished.querySelector("#run-lives")!.textContent = `${state.lives} of 5`;
      finished.querySelector("#run-hall")!.textContent =
        `Level ${state.placements.find((p) => p.id === "polis-hall")?.level}`;
      finished.querySelector("#run-structures")!.textContent = String(
        state.placements.length,
      );
      if (!queue) finished.querySelector("#run-award")!.textContent = "";
    },
    award(text: string) {
      finished.querySelector("#run-award")!.textContent = text;
    },
    connection(
      text: string,
      actions: { retry?: () => void; cancel?: () => void } = {},
      busy = false,
    ) {
      connection.hidden = !text;
      // A hidden banner keeps no buttons, so dialogs it sits in never trap focus on them.
      if (!text) {
        connection.replaceChildren();
        connection.dataset.key = "";
        return;
      }
      // Rebuild only when the message or offered actions change, so polling keeps focus.
      const key = JSON.stringify([text, !!actions.retry, !!actions.cancel]);
      if (connection.dataset.key !== key) {
        connection.dataset.key = key;
        const focused = connection.contains(document.activeElement);
        connection.innerHTML = `<p role="status" id="connection-status" tabindex="-1"></p>`;
        connection.querySelector("p")!.textContent = text;
        for (const [id, label, run] of [
          ["retry-connection", "Retry", actions.retry],
          ["cancel-waiting", "Cancel waiting", actions.cancel],
        ] as const) {
          if (!run) continue;
          const b = document.createElement("button");
          b.textContent = label;
          b.id = id;
          b.addEventListener("click", run);
          connection.append(b);
        }
        const menu = document.createElement("a");
        menu.href = appUrl("/");
        menu.textContent = "Return to menu";
        connection.append(menu);
        if (focused) connection.querySelector<HTMLElement>("p")!.focus();
      }
      if (
        busy &&
        document.activeElement instanceof HTMLButtonElement &&
        connection.contains(document.activeElement)
      )
        connection.querySelector<HTMLElement>("p")!.focus();
      for (const button of connection.querySelectorAll<HTMLButtonElement>(
        "button",
      ))
        button.disabled = busy;
    },
    settings(open: boolean) {
      if (!open) return closeSettings();
      if (settings.hidden) handlers.incomePause(true);
      opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      settings.hidden = false;
      fill();
      field("master").focus();
    },
    /** Moves focus into the topmost open dialog, if any; true when one exists. */
    focusDialog() {
      const top = modals.findLast((modal) => !modal.hidden);
      if (top) enter(top);
      return Boolean(top);
    },
    get settingsOpen() {
      return !settings.hidden;
    },
    get fateOpen() {
      return !fate.hidden;
    },
  };
}
