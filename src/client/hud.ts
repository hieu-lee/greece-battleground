import { appUrl } from "../urls.ts";
import "../fonts.css";
import "./hud.css";
import { clans } from "../clans.ts";
import {
  buildings,
  describeEffect,
  fates,
  featureTags,
  patronNames,
  troopNames,
} from "../rules.ts";
import type { BuildingId, Count, FateId, Rarity, TroopId } from "../rules.ts";
import {
  sourceCampCounts,
  sourceSpawn,
  sourceUnit,
} from "../source-numbers.ts";
import { retainedAura } from "../warband.ts";
import { unlockedFates } from "../game.ts";
import type { PlayState } from "../read-model.ts";
import type { Feature, TileId } from "../map.ts";
import { canCharmTarget, itemHolds } from "../charm-targets.ts";
import { icons } from "./icons.ts";
import { rivalClan, seasonNames } from "./display.ts";
import { thumbnail } from "./thumbnails.ts";

// `fate`: a Charm or spell offer slot waiting for its target structure.
export type HudSelection = {
  shop: number | null;
  fate: number | null;
};

export function preparationKey(state: PlayState) {
  return JSON.stringify([
    state.phase.kind,
    state.round,
    state.tutorial?.stage,
    state.placements,
    state.featureRunes,
    state.owned,
    state.shop,
    state.fate,
    state.fateChosen,
    state.workers,
    state.blessings,
    state.skills,
  ]);
}

type HudHandlers = {
  shop(slot: number): void;
  // A shop offer dragged out over the island and released (or abandoned) at a screen point.
  drag(
    slot: number,
    phase: "start" | "move" | "end",
    x: number,
    y: number,
  ): void;
  reroll(): void;
  villager(): void;
  ready(): void;
  fate(): void;
  settings(): void;
  hover(content: Tooltip | null): void;
};

export type Tooltip = {
  anchor?: "item" | "favour";
  title: string;
  rarity?: string;
  // Colours the rarity line by shop tier.
  tier?: Rarity | null;
  tags?: readonly string[];
  body: string;
  accent?: "gold" | "blue" | "purple" | "green";
};

const seasonIndex = { spring: 0, summer: 1, autumn: 2, winter: 3 };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  html = "",
) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Highlights stat words and numbers (level triples like +3/6/9 included) the way the source
// tooltips do.
export function richText(text: string) {
  return escapeHtml(text)
    .replace(
      /(?<![\w./])([+-]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*%?)\s*(Health|Damage|Armor|Ward|Burn|Poison|Regen|Crit Chance|Action Speed|Attack Speed|Drachmas?|Insight|Healing)\b/g,
      (_, n: string, stat: string) =>
        `<b class="stat stat-${stat.split(" ")[0]!.toLowerCase()}">${n} ${stat}</b>`,
    )
    .replace(
      /\b(Melee|Ranged|Warband|Civilian|Knowledge|Divine|Economy|Unit|Units|Support|Tower|Mythical|Sacrificial|Nature|Beast|Healer|Mercenary|Terrain|Wildland|Rocky|Fertile|Mountain|Forest)\b/g,
      '<b class="tag">$1</b>',
    );
}

export const rarityNames = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
} satisfies Record<Rarity, string>;
// Favour thresholds that unlock more Fate offers, read from the offers themselves. Generic
// Gifts read the highest single favour, so their thresholds count for every patron.
export const favorSteps = [
  ...new Set(
    Object.values(fates).flatMap((f) =>
      f.unlock.flatMap(([, at]) => (at > 0 ? [at] : [])),
    ),
  ),
].sort((a, b) => a - b);
export const nextFavorStep = (favor: number) =>
  favorSteps.find((step) => step > favor);
const irregularPlurals: Partial<Record<TroopId, string>> = {
  peripolos: "Peripoloi",
  misthophoros: "Misthophoroi",
  spartoi: "Spartoi",
  erinys: "Erinyes",
  cyclops: "Cyclopes",
  "drakon-colossus": "Drakon Colossi",
  "arcadian-wolf": "Arcadian Wolves",
};
const troopLabel = (id: TroopId, n: number) =>
  n === 1 ? troopNames[id] : (irregularPlurals[id] ?? `${troopNames[id]}s`);

// The deployment rule troopCount (src/warband.ts) evaluates, in words.
function deployRule(troop: { id: TroopId; count: Count }) {
  switch (troop.count) {
    case "workers":
      return "1 per Villager";
    case "fixed":
      return `Fixed: ${sourceSpawn[troop.id].amount}`;
    case "civilian-structures":
      return `1 per Civilian structure (max ${sourceCampCounts.peripolos.cap})`;
    case "stored-drachmas":
      return `1 per ${Math.round(1 / sourceCampCounts.misthophoros.coefficient)} stored Drachmas (max ${sourceCampCounts.misthophoros.cap})`;
    case "adjacent-circle-of-stone":
      return `1 per adjacent Circle of Stone (max ${sourceSpawn[troop.id].cap})`;
  }
}

// The deployed troop's combat profile at the structure's level, as the source tooltips show it.
function troopStats(id: BuildingId, level = 1) {
  const troop = buildings[id].troop;
  if (!troop) return "";
  const unit = sourceUnit(troop.id, level);
  const round = (n: number) => String(Math.round(n * 10) / 10);
  const stats: [string, string, string][] = [
    ["damage", "Damage", round(unit.damage)],
    ["health", "Health", round(unit.health)],
    ["speed", "Attack speed", round(unit.speed)],
    ["range", "Range", round(unit.range)],
    ...(
      [
        ["armor", "Armor", unit.armor],
        ["crit", "Crit Chance", unit.crit],
        ["burn", "Burn", unit.burn],
        ["poison", "Poison", unit.poison],
        ["healing", "Healing", unit.healing],
      ] as const
    ).flatMap(([key, label, value]): [string, string, string][] =>
      value > 0
        ? [[key, label, round(value) + (key === "crit" ? "%" : "")]]
        : [],
    ),
  ];
  return `<ul class="tip-stats">${stats.map(([key, label, value]) => `<li class="stat-${key}" title="${label}"><i aria-hidden="true">${icons.stat[key as keyof typeof icons.stat] ?? ""}</i><span class="sr-only">${label} </span>${value}</li>`).join("")}</ul>`;
}

function deploymentText(id: BuildingId, deployment?: number) {
  const troop = buildings[id].troop;
  if (!troop) return id === "polis-hall" ? "Deploys your chief" : "";
  if (deployment !== undefined)
    return `Deploys ${deployment} ${troopLabel(troop.id, deployment)}${troop.count === "fixed" ? "" : ` (${deployRule(troop)})`}`;
  if (troop.count === "fixed") {
    const amount = sourceSpawn[troop.id].amount;
    return `Fixed: ${amount} ${troopLabel(troop.id, amount)}`;
  }
  return `${troopLabel(troop.id, 2)}: ${deployRule(troop)}`;
}

// What a structure's Villagers do: deploy its troops, or produce what its per-Villager effects
// yield (Altar of Olympus: Insight; Silver Mine: Drachmas).
export function villagerRole(id: BuildingId) {
  const b = buildings[id];
  if (b.troop?.count === "workers")
    return `Villagers deploy ${troopLabel(b.troop.id, 2)}`;
  const made = new Set(
    b.effects.flatMap((e) =>
      e.per && "workers" in e.per
        ? [e.stat[0]!.toUpperCase() + e.stat.slice(1)]
        : [],
    ),
  );
  return made.size ? `Villagers produce ${[...made].join(" and ")}` : null;
}

export function buildingTooltip(
  id: BuildingId,
  level?: number,
  workers?: number,
  deployment?: number,
  growth?: number,
  rune: PlayState["placements"][number]["rune"] = null,
): Tooltip {
  const b = buildings[id];
  const tier = b.rarity ? rarityNames[b.rarity] : "";
  const deploy = deploymentText(id, deployment);
  const stored =
    level !== undefined && (id === "farm" || id === "offering-well")
      ? retainedAura(id, level, growth)
      : null;
  return {
    ...(rune ? { anchor: "item" as const } : {}),
    title: b.name,
    rarity: [level ? `Level ${level}` : "", tier].filter(Boolean).join(" · "),
    tier: b.rarity,
    tags: b.tags.map((t) => t.replace("-", " ")),
    body:
      richText(b.description) +
      (b.effects.length
        ? `<ul class="tip-effects">${b.effects.map((e) => `<li>${richText(describeEffect(e))}</li>`).join("")}</ul>`
        : "") +
      (stored
        ? `<p class="tip-effects">${richText(`Stored aura: +${stored.health} Health${id === "offering-well" ? ` and +${stored.damage} Damage` : ""}`)}</p>`
        : "") +
      (deploy
        ? `<div class="tip-troop"><p class="tip-deploy">${icons.swords}${richText(deploy)}</p>${troopStats(id, level)}</div>`
        : "") +
      (workers !== undefined && b.workerSlots
        ? `<p class="tip-workers">${icons.worker} Villagers ${workers}/${b.workerSlots}${b.minimumWorkers ? ` (min ${b.minimumWorkers})` : ""}</p>`
        : "") +
      (b.unknown.length
        ? `<div class="tip-unknown"><b>Provisional</b><ul>${b.unknown.map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul></div>`
        : "") +
      (rune
        ? `<p>Charm: <b>${escapeHtml(fates[rune].name)}</b></p><div>${fateTooltip(rune).body}</div><p>One Charm per item; a new Charm replaces it.</p>`
        : ""),
  };
}

export function featureTooltip(
  feature: Feature,
  rune: PlayState["featureRunes"][number][1] | null = null,
): Tooltip {
  return {
    anchor: "item",
    title:
      feature === "circle-of-stone"
        ? "Circle of Stone"
        : feature.slice(0, 1).toUpperCase() + feature.slice(1),
    tags: featureTags[feature],
    body:
      `<p>Charm: <b>${rune ? escapeHtml(fates[rune].name) : "None"}</b></p>` +
      (rune ? `<div>${fateTooltip(rune).body}</div>` : "") +
      "<p>One Charm per item; a new Charm replaces it.</p>",
  };
}

// The engine re-checks the shared item eligibility on purchase.
export function fateTargets(
  state: PlayState,
  id: FateId,
  tiles: ReadonlyMap<TileId, { feature: Feature | null }>,
) {
  const card = fates[id];
  const holder = card.holders;
  if (!holder || (card.kind !== "rune" && card.kind !== "spell")) return [];
  const targets = state.placements
    .filter(
      (p) =>
        (card.kind === "rune"
          ? canCharmTarget(id, p.id)
          : itemHolds(p.id, holder)) &&
        (card.kind === "rune" || (p.id !== "polis-hall" && p.level < 3)),
    )
    .map((p) => p.tile);
  if (card.kind === "rune")
    for (const tile of state.owned) {
      const feature = tiles.get(tile)?.feature;
      if (feature && canCharmTarget(id, feature)) targets.push(tile);
    }
  return targets;
}
export const fateKindNames = {
  rune: "Charm",
  blessing: "Blessing",
  spell: "Spell",
  gift: "Gift",
} as const;
function fateTooltip(id: FateId): Tooltip {
  const f = fates[id];
  return {
    title: f.name,
    rarity: fateKindNames[f.kind],
    body:
      richText(f.text) +
      (f.unknown.length
        ? `<div class="tip-unknown"><b>Partial: not applied</b><ul>${f.unknown.map((u) => `<li>${escapeHtml(u)}</li>`).join("")}</ul></div>`
        : ""),
    accent: f.kind === "rune" ? "purple" : f.kind === "gift" ? "green" : "blue",
  };
}

function favourTooltip(
  god: keyof PlayState["favor"],
  favour: PlayState["favor"],
): Tooltip {
  const unlocked = new Set(unlockedFates(favour));
  const tiers = [0, ...favorSteps]
    .map((at) => {
      const offers = Object.values(fates).filter((f) =>
        f.unlock.some(
          ([patron, threshold]) =>
            (patron === god || patron === "generic") && threshold === at,
        ),
      );
      if (!offers.length) return "";
      const example = offers[0]!;
      const prices = [...new Set(offers.map((f) => f.cost))].join("/");
      const entries = offers
        .map((f) => {
          const alternative = f.unlock
            .map(
              ([patron, threshold]) =>
                `${escapeHtml(patron === "generic" ? "Any god" : patronNames[patron])} ${threshold}`,
            )
            .join(" or ");
          const shared = f.unlock.some(([patron]) => patron === "generic")
            ? "<p>Shared gift pool: uses your highest favour with any god.</p>"
            : f.unlock.length > 1
              ? `<p>Unlock through either god: ${alternative}.</p>`
              : "";
          return `<li><b>${escapeHtml(f.name)}</b> · ${fateKindNames[f.kind]} · ${f.cost} Insight · ${unlocked.has(f.id) ? "Unlocked" : "Locked"}<br>${fateTooltip(f.id).body}${shared}</li>`;
        })
        .join("");
      const available = offers.filter((f) => unlocked.has(f.id)).length;
      const availability =
        available === offers.length
          ? "Unlocked"
          : `${available}/${offers.length} unlocked`;
      return `<details><summary><b>${at} favour</b> · ${prices} Insight · ${availability}<small>${escapeHtml(example.name)}: ${richText(example.text)}</small></summary><ul>${entries}</ul></details>`;
    })
    .join("");
  return {
    anchor: "favour",
    title: `Favour of ${patronNames[god]}`,
    body: `<p>${favour[god]} favour. Buying Fate offers bearing this god earns favour.</p><p>Thresholds add offers to future Fate rolls. Buy an offer to gain its effect; favour itself grants no combat bonus. Charms and spells still need a valid target.</p><p>Click or tap to pin, then expand a tier for all effects. Shared offers unlock through either god.</p><div class="favour-tiers">${tiers}</div>`,
    accent: god === "athena" ? "blue" : "gold",
  };
}

export function createHud(root: HTMLElement, given: HudHandlers) {
  // While an order awaits confirmation the HUD is locked: controls stay focusable (so keyboard
  // focus survives) but presses are refused with a notice instead of being sent.
  const refuse = () =>
    api.notice("Waiting for your last order to be confirmed…");
  const unlocked =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) =>
      root.dataset.locked === "true" ? refuse() : fn(...args);
  const handlers: HudHandlers = {
    ...given,
    shop: unlocked(given.shop),
    reroll: unlocked(given.reroll),
    villager: unlocked(given.villager),
    ready: unlocked(given.ready),
    fate: unlocked(given.fate),
  };
  root.classList.add("hud");
  root.innerHTML = `
<div class="hud-crest" data-region="crest">
  <div class="crest-emblem"><img alt="" id="hud-crest-img"></div>
  <div class="crest-track">
    <div class="wins" id="hud-wins" role="img" aria-label="Victories"></div>
    <div class="lives" id="hud-lives" role="img" aria-label="Lives"></div>
  </div>
</div>
<div class="hud-favor" id="hud-favor" aria-label="Favour of the gods"></div>
<div class="hud-season">
  <div class="season-banner" id="hud-season-banner"><div class="season-marks" id="hud-season-marks"></div></div>
  <div class="season-label"><span id="hud-round"></span><button class="info" id="hud-season-info" aria-label="Season details">${icons.info}</button></div>
</div>
<div class="hud-resources">
  <span class="resource insight" role="img" aria-label="Insight"><img src="${appUrl(`/ui/insight.webp`)}" alt=""><b id="hud-insight"></b></span>
  <span class="resource drachma" role="img" aria-label="Drachmas"><img src="${appUrl(`/art/icon-drachma.webp`)}" alt=""><b id="hud-drachmas"></b></span>
  <button class="hud-gear" id="hud-settings" aria-label="Settings">${icons.gear}</button>
</div>
<div class="hud-tooltip" id="hud-tooltip" role="tooltip" hidden></div>
<nav class="hud-shop" aria-label="The Agora">
  <div class="shop-cards" id="shop"></div>
  <button class="reroll" id="reroll-shop">${icons.reroll}<span class="price"><img src="${appUrl(`/art/icon-drachma.webp`)}" alt=""><b id="hud-reroll-price"></b></span></button>
</nav>
<div class="hud-actions">
  <button class="hex-card villager" id="villager" aria-label="Buy a villager">
    <span class="hex-art"><img src="${appUrl(`/art/icon-villager.webp`)}" alt=""></span>
    <span class="price"><img src="${appUrl(`/art/icon-drachma.webp`)}" alt=""><b id="hud-villager-price"></b></span>
    <span class="count" id="hud-workers"></span>
    <span class="sell-value" aria-hidden="true">+<img src="${appUrl(`/art/icon-drachma.webp`)}" alt=""><b id="hud-sell"></b></span>
  </button>
  <button class="fate-orb" id="open-fate" aria-label="Weave your Fate"><img src="${appUrl(`/ui/insight.webp`)}" alt=""><span>Fate</span></button>
  <button class="ready" id="ready" aria-label="Ready for battle">${icons.next}</button>
</div>
<div class="hud-chief">
  <img class="chief-portrait" id="hud-portrait" alt="">
  <div class="chief-plate">
    <div class="chief-name"><span class="clan-shield"><img id="hud-shield" alt=""></span><b id="hud-player"></b></div>
    <div class="chief-skills" id="hud-skills"></div>
  </div>
  <div class="chief-slots" id="hud-slots" aria-label="Blessings"></div>
</div>
<div class="hud-rival" aria-hidden="true"><img class="chief-portrait" id="hud-rival-portrait" alt=""><div class="chief-plate"><div class="chief-name"><b id="hud-rival-name"></b></div></div></div>
<div class="hud-hints" aria-hidden="true">
  <span>${icons.mouseLeft} Select</span><span>${icons.mouseRight} Move camera</span><span>${icons.mouseWheel} Zoom camera</span>
</div>
<p class="hud-notice" id="hud-notice" role="status" aria-live="polite"></p>
<div class="hud-announce" id="hud-announce" aria-hidden="true"><h2></h2><p></p></div>`;
  const $ = (id: string) => {
    const node = root.querySelector<HTMLElement>("#" + id);
    if (!node) throw new Error("Missing HUD element " + id);
    return node;
  };
  const tooltip = $("hud-tooltip");
  const button = (id: string) => $(id) as HTMLButtonElement;
  button("reroll-shop").addEventListener("click", () => handlers.reroll());
  button("villager").addEventListener("click", () => handlers.villager());
  button("ready").addEventListener("click", () => handlers.ready());
  button("open-fate").addEventListener("click", () => handlers.fate());
  button("hud-settings").addEventListener("click", () => handlers.settings());
  let details: {
    node: HTMLButtonElement;
    tip: Tooltip;
    cancel: (() => void) | null;
    context: string;
  } | null = null;
  const clearDetails = () => {
    if (details?.node.hasAttribute("aria-expanded"))
      details.node.setAttribute("aria-expanded", "false");
    details?.node.removeAttribute("aria-describedby");
    details = null;
    delete tooltip.dataset.pinned;
  };
  const hideDetails = () => {
    clearDetails();
    handlers.hover(null);
  };
  const showDetails = (
    node: HTMLButtonElement,
    tip: Tooltip | null,
    cancel: (() => void) | null = null,
  ) => {
    clearDetails();
    if (tip && current) {
      details = { node, tip, cancel, context: preparationKey(current) };
      tooltip.dataset.pinned = "true";
      if (node.hasAttribute("aria-expanded"))
        node.setAttribute("aria-expanded", "true");
      node.setAttribute("aria-describedby", "hud-tooltip");
    }
    handlers.hover(tip);
  };
  const hoverable = (
    node: HTMLElement,
    content: () => Tooltip | null,
    touchHover = true,
  ) => {
    node.addEventListener("pointerenter", (event) => {
      if (touchHover || event.pointerType !== "touch")
        handlers.hover(content());
    });
    node.addEventListener("pointerleave", (event) => {
      if (
        (touchHover || event.pointerType !== "touch") &&
        details?.node !== node
      )
        handlers.hover(null);
    });
    // Keyboard focus only: focus handed back after a dialog closes (a tap on Fate, say) would
    // otherwise leave the tooltip up over the board.
    node.addEventListener("focus", () => {
      if (node.matches(":focus-visible")) handlers.hover(content());
    });
    node.addEventListener("blur", () => handlers.hover(null));
  };
  const disclosure = (
    node: HTMLButtonElement,
    content: () => Tooltip | null,
  ) => {
    node.type = "button";
    node.setAttribute("aria-controls", "hud-tooltip");
    node.setAttribute("aria-expanded", "false");
    hoverable(node, content, false);
    node.addEventListener("click", () => {
      const tip = details?.node === node ? null : content();
      showDetails(node, tip);
    });
  };
  let current: PlayState | null = null;
  // Fading ribbons; with reduced motion they simply appear and hide after a pause.
  const timers = new WeakMap<HTMLElement, number>();
  function flash(node: HTMLElement) {
    clearTimeout(timers.get(node));
    node.classList.remove("show", "still");
    void node.offsetWidth;
    if (document.documentElement.dataset.motion === "reduce") {
      node.classList.add("still");
      timers.set(
        node,
        window.setTimeout(() => node.classList.remove("still"), 2800),
      );
    } else node.classList.add("show");
  }
  // Each section rebuilds only when its inputs change, so re-renders keep focus and hover.
  const drawn = new Map<string, string>();
  const changed = (section: string, ...inputs: unknown[]) => {
    const key = JSON.stringify(inputs);
    if (drawn.get(section) === key) return false;
    drawn.set(section, key);
    return true;
  };
  // While a structure is held, the villager hex becomes the sale zone showing what it fetches.
  let sale: { drachmas: number; label: string; hot: boolean } | null = null;
  let villagerTooltip: { tip: Tooltip; workers: number } | null = null;
  const villagerTip = () => {
    // While a structure is held the hex is its sale zone.
    if (sale) {
      // Marked stale (no worker count matches) so the next render swaps it back after the sale.
      const tip = { title: "Sell", body: `${sale.label}.` };
      villagerTooltip = { tip, workers: -1 };
      return tip;
    }
    const workers = current?.workers ?? 0;
    const tip = {
      title: "Villager",
      body: `Assign to a structure's free slot, or spend one to colonise a bordering tile.<p class="tip-workers">${icons.worker} ${workers} unassigned</p>`,
    };
    villagerTooltip = { tip, workers };
    return tip;
  };
  hoverable(button("villager"), villagerTip);
  hoverable(button("open-fate"), () => ({
    title: "Weave your Fate",
    body: `Spend <b class="stat stat-insight">4–32 Insight</b> (by tier) on one Gift, Blessing, Charm or Spell from the Moirai each round.${current ? ` You have ${current.balance[1]}.` : ""}`,
    accent: "purple",
  }));
  hoverable(button("reroll-shop"), () => ({
    title: "Reroll the Agora",
    body: rerollText(current),
  }));
  const seasonInfo = button("hud-season-info");
  // Season tooltips, so a tooltip from anywhere else is told apart from them.
  const seasonTips = new WeakSet<Tooltip>();
  const seasonTip = () => {
    if (!current) return null;
    const tip: Tooltip = {
      title: `Round ${current.round} · ${seasonNames[current.season]}`,
      body: `${current.lives} lives remain; ${current.wins} of 10 victories won. The campaign ends after round ${current.calendar.maxRoundExclusive - 1}.`,
    };
    seasonTips.add(tip);
    return tip;
  };
  disclosure(seasonInfo, seasonTip);
  let shownTip: Tooltip | null = null;
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !shownTip) return;
    if (
      details?.tip.anchor === "favour" &&
      tooltip.contains(document.activeElement)
    )
      details.node.focus({ preventScroll: true });
    hideDetails();
  });
  addEventListener("pointerdown", (event) => {
    if (
      !details ||
      (event.target instanceof Node &&
        (details.node.contains(event.target) || tooltip.contains(event.target)))
    )
      return;
    hideDetails();
  });

  // Shop offers can be dragged onto the island to buy (or level up) in one gesture. A press
  // that never travels past the threshold stays an ordinary click (select, then pick a tile).
  // A drag is refused only as it starts while locked; its release goes through `act`, which
  // refuses pending orders itself, so a lock arriving mid-drag cannot strand it.
  let drag: {
    slot: number;
    pointer: number;
    x: number;
    y: number;
    card: HTMLButtonElement;
    ghost: HTMLElement | null;
  } | null = null;
  // Pointers whose next click is swallowed after their drag, so neither a drop nor a later
  // release of an abandoned drag also selects the offer. Other pointers and keyboard
  // activations are unaffected.
  const suppressed = new Set<number>();
  const dragThreshold = 8;
  function moveGhost(ghost: HTMLElement, x: number, y: number) {
    ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }
  // Ends the gesture at its release point, or abandons it (`null`). An abandoned drag is
  // reported after the current task, since it can be ended from inside a render (the
  // shop rebuilding under it) or by Escape. `held` says whether the pointer is still down
  // (abandoned by Escape, a dialog or a rebuild) rather than released or cancelled.
  function finishDrag(point: { x: number; y: number } | null, held = true) {
    if (!drag) return;
    const { slot, ghost, card, pointer } = drag;
    drag = null;
    if (card.hasPointerCapture(pointer)) card.releasePointerCapture(pointer);
    if (!ghost) return;
    ghost.remove();
    root.classList.remove("dragging");
    const forget = () => suppressed.delete(pointer);
    if (point) {
      // The click dispatched with this release, in this same task.
      suppressed.add(pointer);
      setTimeout(forget);
      handlers.drag(slot, "end", point.x, point.y);
      return;
    }
    if (held) {
      // The click of this pointer's later release.
      suppressed.add(pointer);
      const release = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        removeEventListener("pointerup", release, true);
        removeEventListener("pointercancel", release, true);
        setTimeout(forget);
      };
      addEventListener("pointerup", release, true);
      addEventListener("pointercancel", release, true);
    }
    queueMicrotask(() => handlers.drag(slot, "end", NaN, NaN));
  }
  function endDrag(event: PointerEvent, cancelled: boolean) {
    if (drag?.pointer !== event.pointerId) return;
    finishDrag(
      cancelled ? null : { x: event.clientX, y: event.clientY },
      false,
    );
  }
  function startDrag(
    event: PointerEvent,
    card: HTMLButtonElement,
    slot: number,
  ) {
    if (event.button !== 0 || card.disabled || drag) return;
    drag = {
      slot,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      card,
      ghost: null,
    };
    card.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (!drag.ghost) {
      if (
        Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <
        dragThreshold
      )
        return;
      if (root.dataset.locked === "true") {
        finishDrag(null);
        refuse();
        return;
      }
      const ghost = el("div", "shop-ghost");
      ghost.setAttribute("aria-hidden", "true");
      const art = drag.card.querySelector(".hex-art");
      if (art) ghost.append(art.cloneNode(true));
      root.append(ghost);
      drag.ghost = ghost;
      root.classList.add("dragging");
      hideDetails();
      handlers.drag(drag.slot, "start", event.clientX, event.clientY);
    }
    moveGhost(drag.ghost, event.clientX, event.clientY);
    handlers.drag(drag.slot, "move", event.clientX, event.clientY);
  }

  function renderShop(
    state: PlayState,
    selection: HudSelection,
    preparing: boolean,
  ) {
    const cards = $("shop");
    if (!changed("shop", state.shop, selection.shop, preparing)) {
      for (const [slot, item] of state.shop.entries()) {
        if (!item) continue;
        const card = cards.querySelector<HTMLButtonElement>(
          `[data-slot="${slot}"]`,
        );
        const short = state.drachmas < item.price;
        card?.classList.toggle("unaffordable", short);
        card?.querySelector(".price")?.classList.toggle("short", short);
      }
      return;
    }
    // A dragged card is about to be replaced: its gesture cannot outlive it.
    finishDrag(null);
    cards.replaceChildren(
      ...state.shop.map((item, slot) => {
        const card = el("button", "hex-card shop-card shop-offer");
        card.dataset.slot = String(slot);
        card.dataset.focus = `shop:${slot}`;
        if (!item) {
          card.classList.add("empty");
          card.disabled = true;
          // Bought, or the weighted draw found nothing: the slot alone can't tell which.
          card.setAttribute("aria-label", "Empty");
          return card;
        }
        const b = buildings[item.id];
        const tier = b.rarity ? rarityNames[b.rarity] : "";
        if (b.rarity) card.dataset.rarity = b.rarity;
        card.setAttribute(
          "aria-label",
          `${b.name}, ${tier ? `${tier}, ` : ""}${item.price} Drachmas`,
        );
        card.setAttribute("aria-pressed", String(selection.shop === slot));
        card.innerHTML = `<span class="hex-art"><img class="model" alt=""></span><span class="price${state.drachmas < item.price ? " short" : ""}"><img src="${appUrl(`/art/icon-drachma.webp`)}" alt=""><b>${item.price}</b></span>`;
        const image = card.querySelector<HTMLImageElement>("img.model")!;
        void thumbnail(b.sprite, 1).then((url) => {
          if (url) image.src = url;
          else {
            // The sprite fallback is a strip of square level frames; show level 1.
            image.classList.add("strip");
            image.src = appUrl(`/art/${b.sprite}.webp`);
          }
        });
        card.disabled = !preparing || !b.available;
        card.classList.toggle("unaffordable", state.drachmas < item.price);
        // The offer's image must not start a native image drag, which cancels the pointer.
        card.addEventListener("dragstart", (event) => event.preventDefault());
        card.addEventListener("pointerdown", (event) =>
          startDrag(event, card, slot),
        );
        card.addEventListener("pointermove", moveDrag);
        card.addEventListener("pointerup", (event) => endDrag(event, false));
        card.addEventListener("pointercancel", (event) => endDrag(event, true));
        card.addEventListener("lostpointercapture", (event) =>
          endDrag(event, true),
        );
        card.addEventListener("click", (event) => {
          // Clicks are PointerEvents carrying their pointer; one without is treated as the
          // dragging pointer's (older engines).
          const id =
            (event as Partial<PointerEvent>).pointerId ??
            suppressed.values().next().value;
          if (id !== undefined && suppressed.delete(id)) return;
          handlers.shop(slot);
          const selected = cards.querySelector<HTMLButtonElement>(
            `[data-slot="${slot}"][aria-pressed="true"]`,
          );
          const tip = selected ? buildingTooltip(item.id) : null;
          showDetails(selected ?? card, tip, () => {
            handlers.shop(slot);
            const offer = cards.querySelector<HTMLButtonElement>(
              `[data-slot="${slot}"]`,
            );
            if (offer?.getAttribute("aria-pressed") === "false") {
              offer.focus({ preventScroll: true });
              hideDetails();
            }
          });
        });
        hoverable(card, () => buildingTooltip(item.id), false);
        return card;
      }),
    );
  }

  function renderSeason(state: PlayState) {
    if (!changed("season", state.round, state.season)) return;
    const marks = $("hud-season-marks");
    // A sliding window of rounds around the current one. Scheduled beast rounds show claws only
    // once the engine fields beasts; until then async meets rival poleis and practice trains.
    const { pveRounds, maxRoundExclusive, pveAvailable } = state.calendar;
    marks.replaceChildren(
      ...Array.from({ length: 8 }, (_, i) => {
        const round = state.round - 2 + i;
        const mark = el("span", "mark");
        if (round < 1 || round >= maxRoundExclusive) mark.classList.add("void");
        else {
          const scheduled = (pveRounds as readonly number[]).includes(round);
          const beast = scheduled && pveAvailable;
          mark.innerHTML = beast ? icons.claws : icons.helmet;
          mark.classList.toggle("beast", beast);
          mark.classList.toggle("past", round < state.round);
          mark.classList.toggle("current", round === state.round);
          const foe = beast
            ? "Beasts"
            : state.mode === "async"
              ? "Rival polis"
              : "Training warband";
          mark.title = `Round ${round} · ${foe}`;
        }
        return mark;
      }),
    );
    $("hud-season-banner").dataset.season = state.season;
    $("hud-season-banner").style.setProperty(
      "--season",
      String(seasonIndex[state.season]),
    );
    $("hud-round").textContent =
      `Round ${state.round}, ${seasonNames[state.season]}`;
  }

  function renderFavor(state: PlayState) {
    const node = $("hud-favor");
    const gods = Object.keys(state.favor) as (keyof PlayState["favor"])[];
    if (node.childElementCount !== gods.length)
      node.replaceChildren(
        ...gods.map((god) => {
          const item = el("button", "favor");
          item.dataset.god = god;
          item.innerHTML = `<img src="${appUrl(`/ui/god-${god}.webp`)}" alt=""><b></b>`;
          disclosure(item, () => {
            return favourTooltip(
              god,
              current?.favor ?? { athena: 0, zeus: 0, apollo: 0 },
            );
          });
          return item;
        }),
      );
    for (const item of node.querySelectorAll<HTMLElement>(".favor")) {
      const god = item.dataset.god as keyof PlayState["favor"];
      const favor = state.favor[god] ?? 0;
      const next = nextFavorStep(favor);
      item.querySelector("b")!.textContent =
        next === undefined ? String(favor) : `${favor}/${next}`;
      item.setAttribute(
        "aria-label",
        `${god} favour ${favor}${next === undefined ? "" : ` of ${next}`}`,
      );
    }
  }

  function renderChief(state: PlayState, playerName: string) {
    const clan = clans[state.clan];
    const portrait = $("hud-portrait") as HTMLImageElement;
    const art = appUrl(`/ui/chief-${clan.portrait}.webp`);
    if (!portrait.src.endsWith(art)) portrait.src = art;
    const foe = rivalClan(state);
    if (foe) {
      const rival = $("hud-rival-portrait") as HTMLImageElement;
      const rivalArt = appUrl(`/ui/chief-${foe.portrait}.webp`);
      if (!rival.src.endsWith(rivalArt)) rival.src = rivalArt;
    }
    $("hud-rival-name").textContent = state.battle?.opponent ?? "";
    root.dataset.rival = foe ? "chief" : "none";
    const crest = appUrl(`/art/icon-${clan.crest}.webp`);
    for (const id of ["hud-shield", "hud-crest-img"]) {
      const img = $(id) as HTMLImageElement;
      if (!img.src.endsWith(crest)) img.src = crest;
    }
    $("hud-player").textContent = playerName;
    if (!changed("skills", state.clan, state.skills)) return;
    const skills = $("hud-skills");
    skills.replaceChildren(
      ...clan.skills.map((skill, i) => {
        const level = state.skills[i] ?? 1;
        const node = el("button", "skill");
        node.dataset.focus = `skill:${i}`;
        node.innerHTML = `<img src="${appUrl(`/art/icon-${skill.icon}.webp`)}" alt=""><i>${"◆".repeat(level)}${"◇".repeat(3 - level)}</i>`;
        node.setAttribute("aria-label", `${skill.name}, level ${level} of 3`);
        disclosure(node, () => ({
          title: skill.name,
          rarity: `Level ${level}/3`,
          body: skill.parts
            .map((part) =>
              typeof part === "string"
                ? escapeHtml(part)
                : `<b class="stat stat-${part.stat}">${part.values
                    .map(
                      (v, j) =>
                        `<span class="${j + 1 === level ? "on" : ""}">${v}${"percent" in part && part.percent ? "%" : ""}</span>`,
                    )
                    .join(
                      "/",
                    )} ${part.stat[0]!.toUpperCase() + part.stat.slice(1)}</b>`,
            )
            .join(""),
          accent: "gold",
        }));
        return node;
      }),
    );
  }

  function renderSlots(state: PlayState) {
    const slots = $("hud-slots");
    // Owned Blessings; Charms live on their structures (badge icons).
    const items = state.blessings;
    if (!changed("slots", items)) return;
    slots.replaceChildren(
      ...Array.from({ length: Math.max(8, items.length) }, (_, i) => {
        const item = items[i];
        const slot = el("button", "slot");
        slot.dataset.focus = `slot:${i}`;
        if (!item) {
          slot.disabled = true;
          slot.setAttribute("aria-label", "Empty slot");
          return slot;
        }
        const f = fates[item];
        slot.classList.add("blessing");
        slot.innerHTML = `<img src="${f.art}" alt="">`;
        // Held Blessings stay focusable so keyboard players can read them.
        slot.setAttribute("aria-label", `${f.name} (Blessing). ${f.text}`);
        slot.setAttribute("aria-disabled", "true");
        hoverable(slot, () => fateTooltip(item));
        return slot;
      }),
    );
  }

  function applySell() {
    const zone = button("villager");
    zone.toggleAttribute("data-sell", sale !== null);
    zone.toggleAttribute("data-hot", Boolean(sale?.hot));
    if (!sale) return;
    $("hud-sell").textContent = String(sale.drachmas);
    zone.setAttribute("aria-label", sale.label);
    zone.setAttribute("aria-pressed", "false");
    zone.disabled = false;
  }

  const api = {
    render(
      state: PlayState,
      selection: HudSelection,
      options: {
        preparing: boolean;
        locked: boolean;
        playerName: string;
        villagerSelected: boolean;
      },
    ) {
      current = state;
      const { preparing } = options;
      root.dataset.locked = String(options.locked);
      root.dataset.phase = state.phase.kind;
      $("hud-insight").textContent = String(state.insight);
      $("hud-drachmas").textContent = String(state.drachmas);
      root
        .querySelector(".resource.insight")!
        .setAttribute("aria-label", `${state.insight} Insight`);
      root
        .querySelector(".resource.drachma")!
        .setAttribute("aria-label", `${state.drachmas} Drachmas`);
      $("hud-wins").setAttribute("aria-label", `${state.wins} of 10 victories`);
      $("hud-lives").setAttribute(
        "aria-label",
        `${state.lives} lives remaining`,
      );
      if (changed("pips", state.wins, state.lives)) {
        $("hud-wins").replaceChildren(
          ...Array.from({ length: 10 }, (_, i) =>
            el("i", i < state.wins ? "won" : ""),
          ),
        );
        $("hud-lives").replaceChildren(
          ...Array.from({ length: 5 }, (_, i) =>
            el("i", i < state.lives ? "alive" : ""),
          ),
        );
      }
      renderSeason(state);
      renderFavor(state);
      renderShop(state, selection, preparing);
      renderChief(state, options.playerName);
      renderSlots(state);
      if (
        details &&
        (details.context !== preparationKey(state) || !details.node.isConnected)
      )
        hideDetails();
      const reroll = state.rerollCosts[0];
      button("reroll-shop").setAttribute(
        "aria-label",
        `Reroll the Agora, ${reroll === null ? "unavailable" : reroll === 0 ? "free" : `${reroll} Drachmas`}`,
      );
      $("hud-reroll-price").textContent =
        reroll === null ? "–" : String(reroll);
      button("reroll-shop").disabled =
        !preparing || reroll === null || state.drachmas < reroll;
      button("villager").setAttribute(
        "aria-label",
        state.workers
          ? `${options.villagerSelected ? "Cancel villager assignment" : "Select a villager"}, ${state.workers} unassigned`
          : `Buy a villager, ${state.villagerPrice} Drachmas, 0 unassigned`,
      );
      button("villager").setAttribute(
        "aria-pressed",
        String(options.villagerSelected),
      );
      $("hud-villager-price").textContent = String(state.villagerPrice);
      $("hud-workers").textContent = state.workers ? String(state.workers) : "";
      // A spare villager can always be placed; buying needs Drachmas.
      button("villager").disabled =
        !preparing || (!state.workers && state.drachmas < state.villagerPrice);
      applySell();
      const fateAvailable =
        preparing && (!state.tutorial || state.tutorial.stage === "fate");
      button("open-fate").disabled = !fateAvailable;
      button("open-fate").classList.toggle(
        "glow",
        fateAvailable &&
          state.fate.some(
            (id) => id !== null && state.insight >= fates[id].cost,
          ),
      );
      button("ready").disabled = !preparing;
      button("ready").setAttribute(
        "aria-label",
        state.phase.kind === "income"
          ? "Collecting income"
          : "Ready for battle",
      );
      if (
        villagerTooltip &&
        shownTip === villagerTooltip.tip &&
        villagerTooltip.workers !== state.workers
      )
        api.tooltip(villagerTip());
    },
    tooltip(content: Tooltip | null) {
      if (details && content !== details.tip) return;
      shownTip = content;
      const season = content !== null && seasonTips.has(content);
      if (content !== details?.tip) clearDetails();
      // Season details sit clear of the round label they explain.
      tooltip.dataset.anchor = season ? "season" : (content?.anchor ?? "");
      tooltip.hidden = !content;
      const interactive =
        details && (details.cancel || content?.anchor === "favour");
      tooltip.setAttribute("role", interactive ? "region" : "tooltip");
      if (interactive && content)
        tooltip.setAttribute("aria-label", content.title);
      else tooltip.removeAttribute("aria-label");
      if (!content) return;
      tooltip.dataset.accent = content.accent ?? "gold";
      if (content.tier) tooltip.dataset.rarity = content.tier;
      else delete tooltip.dataset.rarity;
      const card = el(
        "div",
        "tip-card",
        `<header><span class="ribbon"></span><h3>${escapeHtml(content.title)}</h3>${content.rarity ? `<small>${escapeHtml(content.rarity)}</small>` : ""}</header>`,
      );
      const body = el(
        "div",
        content.anchor === "favour" ? "tip-body tip-favour" : "tip-body",
        `${content.tags?.length ? `<p class="tip-tags">${content.tags.map(escapeHtml).join(" ")}</p>` : ""}${content.body}`,
      );
      if (details?.cancel) {
        const placement = el("div", "tip-placement");
        const trigger = details.node;
        const showBoard = el("button", "", "Show board");
        showBoard.id = "hud-show-board";
        showBoard.type = "button";
        showBoard.addEventListener("click", () => {
          trigger.focus({ preventScroll: true });
          hideDetails();
        });
        const cancel = el("button", "", "Cancel");
        cancel.id = "hud-cancel-placement";
        cancel.type = "button";
        cancel.setAttribute("aria-label", "Cancel placement");
        cancel.addEventListener("click", details.cancel);
        placement.append(
          el("span", "", "Choose an owned tile."),
          showBoard,
          cancel,
        );
        body.append(placement);
      }
      card.append(body);
      tooltip.replaceChildren(card);
    },
    /** Large centre ribbon for round and season changes (screen readers get the notice). */
    announce(title: string, detail: string) {
      const node = $("hud-announce");
      node.querySelector("h2")!.textContent = title;
      node.querySelector("p")!.textContent = detail;
      flash(node);
    },
    /** Turns the villager hex into the sale zone for a held structure. Clearing it takes the next render. */
    sell(offer: { drachmas: number; label: string; hot: boolean } | null) {
      sale = offer;
      applySell();
    },
    /** Abandons a shop drag in progress (Escape). */
    cancelDrag() {
      finishDrag(null);
    },
    notice(text: string) {
      const node = $("hud-notice");
      node.textContent = text;
      if (text) flash(node);
    },
  };
  return api;
}

function rerollText(state: PlayState | null) {
  if (!state) return "Replace every offer in the Agora.";
  if (state.freeRerolls)
    return `${state.freeRerolls} free reroll${state.freeRerolls === 1 ? "" : "s"} left this round.`;
  const price = state.rerollCosts[0];
  return price === null
    ? "No rerolls remain this round."
    : `Replace every offer for <b class="stat stat-drachma">${price} Drachma${price === 1 ? "" : "s"}</b>. Each reroll this round costs more.`;
}
