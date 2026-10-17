import { z } from "zod";
import {
  tutorialState,
  tutorialChapterId,
  tutorialChapter,
  tutorialBlocked,
} from "./tutorial-domain.ts";
import {
  encodePlacement,
  featureRunes,
  placement,
} from "./encounter-layout.ts";
import { canCharmTarget, validFeatureRunes, itemHolds } from "./charm-targets.ts";
import type { CharmTarget } from "./charm-targets.ts";
import {
  advanceIncomeClock,
  createIncomeClock,
  createDropQueue,
  queueTask,
  runDropPass,
  assignDropDelays,
} from "./income-runtime.ts";
import {
  addEntry,
  itemEntries,
  removeEntry,
  validateEntries,
} from "./item-entries.ts";
import { clanId } from "./clans.ts";
import { battle, outcome, resolveBattle } from "./combat.ts";
import type { Battle } from "./combat.ts";
import { practiceMatch, ordinaryIncome, boardOf } from "./warband.ts";
import { pveMatch } from "./pve.ts";
import { seasonId } from "./workshop.ts";
import {
  adjacent,
  fog,
  grid,
  sourceMap,
  startTile,
  tileCount,
  tileId,
} from "./map.ts";
import {
  sourceEconomy,
  sourceItemCosts,
  sourceSeasonWeights,
} from "./source-numbers.ts";
import {
  rulesVersion,
  saveVersion,
  sourceRoundLimit,
  seasonForRound,
  sourceEncounterKind,
  sourceCalendar,
} from "./rules-version.ts";
import {
  buildingId,
  buildings,
  level,
  levelCaps,
  runeId,
  blessingId,
  fateId,
  fates,
  god,
  holds,
  rarity,
} from "./rules.ts";
import type { Currency, Fate, FateId, ShopBuildingId, Tag } from "./rules.ts";
export { hasTag } from "./rules.ts";

const workerLimit = 208;
const money = z.number().int().min(0).max(1_000_000);
const phase = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("prepare") }).strict(),
  z.object({ kind: z.literal("income") }).strict(),
  z
    .object({
      kind: z.literal("result"),
      battleId: z.number().int().nonnegative(),
      encounter: battle,
      outcome,
    })
    .strict(),
  z.object({ kind: z.literal("season") }).strict(),
  z
    .object({
      kind: z.literal("finished"),
      outcome: z.enum(["victory", "defeat", "round-limit"]),
    })
    .strict(),
]);
const offer = z
  .object({ id: buildingId.exclude(["polis-hall"]), price: money })
  .strict();
const coreSnapshot = z
  .object({
    version: z.literal(saveVersion),
    rulesVersion: z.literal(rulesVersion),
    revision: z.number().int().nonnegative(),
    seed: z.number().int().min(0).max(0xffffffff),
    clan: clanId,
    round: z.number().int().min(1).max(sourceRoundLimit),
    season: seasonId,
    lives: z.number().int().min(0).max(5),
    wins: z.number().int().min(0).max(10),
    mode: z.enum(["practice", "tutorial", "async"]),
    tutorial: tutorialState.nullable(),
    phase,
    fateChosen: z.boolean(),
    skills: z.tuple([level, level, level]),
    stagIncomePosition: z.number().int().min(0).max(100).nullable(),
    chiefBattles: z.number().int().min(0).max(sourceRoundLimit),
    drachmas: z.number().int().min(-1_000_000).max(1_000_000),
    insight: money,
    workers: z.number().int().min(0).max(workerLimit),
    villagerPurchases: z.number().int().min(0).max(100),
    freeRerolls: z.number().int().min(0).max(3),
    shopRolls: z.number().int().nonnegative(),
    fateRolls: z.number().int().nonnegative(),
    paidShopRerolls: z.number().int().min(0).max(6),
    // Paid Fate rerolls this round; 7 = the serialized ladder is exhausted.
    paidFateRerolls: z
      .number()
      .int()
      .min(0)
      .max(sourceEconomy.fateRerolls.length),
    owned: z.array(tileId).min(1).max(tileCount),
    placements: z.array(placement).min(1).max(tileCount),
    featureRunes,
    itemEntries: itemEntries.optional(),
    shop: z.tuple([
      offer.nullable(),
      offer.nullable(),
      offer.nullable(),
      offer.nullable(),
    ]),
    fate: z.tuple([fateId.nullable(), fateId.nullable(), fateId.nullable()]),
    blessings: z.array(blessingId).max(100),
    shopAppearanceSnapshot: z.array(blessingId).max(3),
    favor: z.record(god, z.number().int().min(0).max(100)),
    // Permanent chief growth from Growing Might of Heracles.
    chiefGrowth: z.object({ damage: money, health: money }).strict(),
  })
  .strict();
const snapshot = coreSnapshot
  .extend({ incomeCheckpoint: coreSnapshot.nullable() })
  .strict();
export type Game = z.infer<typeof snapshot>;
export const preparationCosts = {
  villager: {
    base: sourceEconomy.villagerBase,
    increase: sourceEconomy.villagerIncrease,
  },
};
export const command = z.discriminatedUnion("op", [
  z.object({ op: z.literal("restart"), clan: clanId }).strict(),
  z.object({ op: z.literal("ready") }).strict(),
  z.object({ op: z.literal("continue") }).strict(),
  z.object({ op: z.literal("tutorial-close") }).strict(),
  z
    .object({ op: z.literal("tutorial-chapter"), chapter: tutorialChapterId })
    .strict(),
  z
    .object({
      op: z.literal("upgrade"),
      choice: z.enum(["hall", "skill-0", "skill-1", "skill-2"]),
    })
    .strict(),
  z
    .object({
      op: z.literal("buy"),
      slot: z.number().int().min(0).max(3),
      tile: tileId,
    })
    .strict(),
  z.object({ op: z.literal("villager") }).strict(),
  z.object({ op: z.literal("assign"), tile: tileId }).strict(),
  z.object({ op: z.literal("sell"), tile: tileId }).strict(),
  z.object({ op: z.literal("colonize"), tile: tileId }).strict(),
  z.object({ op: z.literal("move"), from: tileId, to: tileId }).strict(),
  z.object({ op: z.literal("reroll-shop") }).strict(),
  z.object({ op: z.literal("reroll-fate") }).strict(),
  // Charms and spells name their target structure; the purchase is one atomic step.
  z
    .object({
      op: z.literal("fate"),
      slot: z.number().int().min(0).max(2),
      tile: tileId.optional(),
    })
    .strict(),
]);
export type Command = z.infer<typeof command>;
export const transaction = z
  .object({
    revision: z.number().int().nonnegative(),
    actions: z.array(command).min(1).max(16),
  })
  .strict();

export function parseGame(input: unknown): Game {
  const game = snapshot.parse(input);
  if (game.incomeCheckpoint) {
    if (
      game.phase.kind !== "income" ||
      game.incomeCheckpoint.phase.kind !== "income"
    )
      throw new Error("Invalid Income checkpoint phase");
    parseGame({ ...game.incomeCheckpoint, incomeCheckpoint: null });
  }
  if (
    (game.clan === "stag") !== (game.stagIncomePosition !== null) ||
    (game.stagIncomePosition ?? 0) > game.blessings.length
  )
    throw new Error("Invalid Stag power position");
  if ((game.mode === "tutorial") !== (game.tutorial !== null))
    throw new Error("Tutorial state does not match game mode");
  if (game.fateChosen && game.fate.some((id) => id !== null))
    throw new Error("Chosen Fate cannot retain offers");
  if (
    new Set(game.owned).size !== game.owned.length ||
    new Set(game.placements.map((p) => p.tile)).size !== game.placements.length
  )
    throw new Error("Duplicate territory or structures");
  if (new Set(game.blessings).size !== game.blessings.length)
    throw new Error("Duplicate Blessings");
  if (
    new Set(game.shopAppearanceSnapshot).size !==
      game.shopAppearanceSnapshot.length ||
    game.shopAppearanceSnapshot.some(
      (id) => !game.blessings.includes(id) || !fates[id].appearance,
    )
  )
    throw new Error("Invalid Shop appearance snapshot");
  const halls = game.placements.filter((p) => p.id === "polis-hall");
  if (halls.length !== 1)
    throw new Error("Settlement must contain one Polis Hall");
  validateEntries(game);
  const map = sourceMap(game.seed);
  if (
    !validFeatureRunes(
      game.featureRunes,
      game.owned,
      (tile) => map.tiles[tile]?.feature,
    )
  )
    throw new Error("Invalid feature Charm target");
  for (const p of game.placements) {
    const definition = buildings[p.id];
    if (definition.clan && definition.clan !== game.clan)
      throw new Error(`${definition.name} belongs to another clan`);
    if (!definition.available)
      throw new Error(`${definition.name} is held and cannot be placed`);
    if (!game.owned.includes(p.tile))
      throw new Error("Structure outside owned territory");
    if (p.workers > definition.workerSlots) throw new Error("Too many workers");
    if (p.workers < definition.minimumWorkers)
      throw new Error("Too few workers");
    if (p.rune && !canCharmTarget(p.rune, p.id))
      throw new Error("Charm target mismatch");
  }
  for (const offer of game.shop) {
    const owner = offer && buildings[offer.id].clan;
    if (owner && owner !== game.clan)
      throw new Error("Shop offer belongs to another clan");
  }
  const terminal =
    game.wins === 10 || game.lives === 0 || game.round === sourceRoundLimit;
  const pendingTerminal =
    game.phase.kind === "result" &&
    game.round < sourceRoundLimit &&
    game.phase.encounter.kind !== "pve" &&
    (game.phase.outcome.winner === "polis"
      ? game.wins === 10 && game.lives > 0
      : game.lives === 0 && game.wins < 10);
  if (terminal !== (game.phase.kind === "finished" || pendingTerminal))
    throw new Error("Run outcome does not match lives and wins");
  if (
    game.phase.kind === "finished" &&
    game.phase.outcome !==
      (game.lives === 0
        ? "defeat"
        : game.wins === 10
          ? "victory"
          : "round-limit")
  )
    throw new Error("Invalid run outcome");
  if (game.season !== seasonForRound(game.round))
    throw new Error("Season does not match the round");
  if (game.phase.kind === "season" && ![5, 9, 13].includes(game.round))
    throw new Error("No seasonal choice on this round");
  if (
    game.phase.kind === "result" &&
    game.phase.encounter.kind !==
      (sourceEncounterKind(game.round) === "pve"
        ? "pve"
        : game.mode !== "async"
          ? "training"
          : "pvp")
  )
    throw new Error("Encounter does not match game mode");
  if (game.owned.some((id) => !grid[id]?.playable))
    throw new Error("Territory outside the playable map");
  if (map.owned.some((id) => !game.owned.includes(id)))
    throw new Error("Starting territory is missing");
  if (game.placements.some((p) => map.tiles[p.tile]?.feature))
    throw new Error("Structure on a map feature");
  const reached = new Set([startTile]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const id of game.owned)
      if (!reached.has(id) && [...reached].some((from) => adjacent(from, id))) {
        reached.add(id);
        expanded = true;
      }
  }
  if (reached.size !== game.owned.length)
    throw new Error("Disconnected territory");
  return game;
}

function random(seed: number) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}
type OfferIndex = (
  context: {
    kind: "shop" | "fate" | "income";
    seed: number;
    round: number;
    roll: number;
    slot: number;
    // Shop slots draw a rarity, then an entry, on each of up to 50 attempts.
    draw: "rarity" | "entry" | "delay";
    attempt: number;
  },
  upperBound: number,
) => number;
type GameAuthority = {
  encounter: (game: Game) => Battle;
  offerIndex: OfferIndex;
};
const shopAttempts = 50;
// Clan pool in serialized order (39 shared, then the clan's two uniques), bucketed by rarity.
export function shopPool(clan: Game["clan"]) {
  const items = buildingId
    .exclude(["polis-hall"])
    .options.filter((id) => (buildings[id].clan ?? clan) === clan);
  return rarity.options.map((r) =>
    items.filter((id) => buildings[id].rarity === r),
  );
}
// One entry per item, plus one when any active appearance power's tag matches (never stacked).
function drawPiles(clan: Game["clan"], appearanceTags: readonly Tag[]) {
  return shopPool(clan).map((pile) =>
    pile.flatMap((id) =>
      buildings[id].tags.some((t) => appearanceTags.includes(t))
        ? [id, id]
        : [id],
    ),
  );
}
// Nominal single-draw probability weight[r]/total * entries(item)/entries(r), before exclusions.
export function offerProbability(
  clan: Game["clan"],
  season: Game["season"],
  id: ShopBuildingId,
  appearanceTags: readonly Tag[] = [],
) {
  const weights: readonly number[] = sourceSeasonWeights[season];
  const index = rarity.options.findIndex((r) => r === buildings[id].rarity);
  const pile = drawPiles(clan, appearanceTags)[index] ?? [];
  const entries = pile.filter((entry) => entry === id).length;
  const total = weights.reduce((sum, w) => sum + w, 0);
  return entries
    ? ((weights[index] ?? 0) * entries) / (total * pile.length)
    : 0;
}
// GetNextShopItem (handoffs active-shop-next, active-offer-weight-closure-next): roll the
// season's rarity weights, pick a uniform entry of that rarity's pile (an extra entry when an
// appearance power's tag matches; never stacked), reject excluded or unavailable items. Rejections
// keep their mass and use one of 50 attempts; after 50 the slot stays empty.
function shop(
  state: Pick<Game, "seed" | "round" | "shopRolls" | "clan" | "season"> & {
    shop?: Game["shop"];
  },
  offerIndex?: OfferIndex,
  appearanceTags: readonly Tag[] = [],
): Game["shop"] {
  const weights: readonly number[] = sourceSeasonWeights[state.season];
  const total = weights.reduce((sum, w) => sum + w, 0);
  const piles = drawPiles(state.clan, appearanceTags);
  // ponytail: whether a bought offer stays excluded is UNKNOWN; only unbought offers are.
  const excluded = new Set(state.shop?.flatMap((o) => (o ? [o.id] : [])));
  let cursor =
    state.shopRolls === 0 ? state.seed : random(state.seed + state.shopRolls);
  const draw = (
    context: Omit<
      Parameters<OfferIndex>[0],
      "kind" | "seed" | "round" | "roll"
    >,
    upperBound: number,
  ) => {
    if (offerIndex)
      return offerIndex(
        {
          kind: "shop",
          seed: state.seed,
          round: state.round,
          roll: state.shopRolls,
          ...context,
        },
        upperBound,
      );
    cursor = random(cursor);
    return Math.floor((cursor / 0x100000000) * upperBound);
  };
  const slot = (index: number) => {
    for (let attempt = 0; attempt < shopAttempts; attempt++) {
      const k = draw({ slot: index, draw: "rarity", attempt }, total);
      let cumulative = 0;
      const chosen = weights.findIndex((w) => k < (cumulative += w));
      const pile = piles[chosen] ?? [];
      const e = draw({ slot: index, draw: "entry", attempt }, pile.length);
      const id = pile[e];
      if (!id) return null;
      if (excluded.has(id) || !buildings[id].available) continue;
      excluded.add(id);
      return { id, price: sourceItemCosts[id] };
    }
    return null;
  };
  return [slot(0), slot(1), slot(2), slot(3)];
}
const favorFor = (favor: Game["favor"], patron: Fate["unlock"][number][0]) =>
  patron === "generic"
    ? Math.max(favor.athena, favor.zeus, favor.apollo)
    : favor[patron];
// An entry joins the pool when any collection listing it has reached its favor threshold;
// GenericPatron reads the highest single favor (handoff active-fate-binding-closure-next).
export function unlockedFates(favor: Game["favor"]) {
  return fateId.options.filter((id) =>
    fates[id].unlock.some(([patron, at]) => favorFor(favor, patron) >= at),
  );
}
type FateState = Pick<
  Game,
  | "seed"
  | "round"
  | "fateRolls"
  | "favor"
  | "blessings"
  | "placements"
  | "owned"
>;
// IsValid: a Blessing once per run, a Charm needs a compatible structure, a spell a structure it
// can still upgrade (no spell targets the Hall). Gifts are always valid here; see fate().
function offerable(
  state: FateState,
  id: FateId,
  targets: readonly CharmTarget[],
) {
  const card = fates[id];
  if (card.kind === "blessing") return !state.blessings.some((b) => b === id);
  const holder = card.holders;
  if (card.kind === "gift") return true;
  if (card.kind === "rune")
    return targets.some((target) => canCharmTarget(id, target));
  return state.placements.some(
    (p) =>
      holder &&
      holds(p.id, holder) &&
      p.id !== "polis-hall" &&
      p.level < levelCaps.building,
  );
}
function validFates(state: FateState, candidates: readonly FateId[]) {
  const targets: CharmTarget[] = [
    ...state.placements.map((p) => p.id),
    ...sourceMap(state.seed).tiles.flatMap((tile) =>
      tile.feature && state.owned.includes(tile.id) ? [tile.feature] : [],
    ),
  ];
  return candidates.filter((id) => offerable(state, id, targets));
}
export function fatePool(state: FateState) {
  return validFates(state, unlockedFates(state.favor));
}
function tutorialFate(state: Game): Game["fate"] {
  const collection: FateId[] = ["call-to-war", "well-fed", "ruins-of-delphi"];
  const eligible = validFates(state, collection).filter(
    (id) => !state.tutorial?.previousFate.includes(id),
  );
  return [eligible[0] ?? null, eligible[1] ?? null, eligible[2] ?? null];
}
// Three independent draws from the eligible pool (weights and slot distinctness are UNKNOWN). A
// Drachma gift (CurrencyEvent) is invalid while another one is already on screen.
function fate(state: FateState, offerIndex?: OfferIndex): Game["fate"] {
  const pool = fatePool(state);
  let cursor = random(state.seed + state.fateRolls);
  const offers: FateId[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const eligible = pool.filter(
      (id) => !(fates[id].drachmas && offers.some((o) => fates[o].drachmas)),
    );
    if (!offerIndex) cursor = random(cursor);
    const id =
      eligible[
        offerIndex
          ? offerIndex(
              {
                kind: "fate",
                seed: state.seed,
                round: state.round,
                roll: state.fateRolls,
                slot,
                draw: "entry",
                attempt: 0,
              },
              eligible.length,
            )
          : Math.floor((cursor / 0x100000000) * eligible.length)
      ];
    if (!id) throw new Error("Empty Fate pool");
    offers.push(id);
  }
  const [a = null, b = null, c = null] = offers;
  return [a, b, c];
}
const appearanceTags = (game: Pick<Game, "shopAppearanceSnapshot">) =>
  game.shopAppearanceSnapshot.flatMap((id) => fates[id].appearance ?? []);
export function newGame(
  seed = 42,
  clan: z.infer<typeof clanId> = "stag",
  mode: Game["mode"] = "practice",
  offerIndex?: OfferIndex,
): Game {
  if (mode === "async" && !offerIndex)
    throw new Error("Async offers require authoritative randomness");
  const favor = {
    athena: clan === "raven" ? 1 : 0,
    zeus: 0,
    apollo: clan === "stag" ? 1 : 0,
  };
  const owned = sourceMap(seed).owned;
  const placements: Game["placements"] = [
    { tile: startTile, id: "polis-hall", level: 1, workers: 0, rune: null },
  ];
  return parseGame({
    version: saveVersion,
    rulesVersion,
    revision: 0,
    seed,
    clan,
    round: 1,
    season: "spring",
    mode,
    tutorial:
      mode === "tutorial"
        ? {
            stage: "welcome",
            chapter: tutorialChapter(1, "welcome"),
            postBattleShown: false,
            ending: "none",
            shopCursors: [0, 0],
            previousFate: [],
          }
        : null,
    phase: { kind: "prepare" },
    fateChosen: false,
    skills: [1, 1, 1],
    stagIncomePosition: clan === "stag" ? 0 : null,
    incomeCheckpoint: null,
    chiefBattles: 0,
    lives: 5,
    wins: 0,
    drachmas: mode === "tutorial" ? 0 : 11,
    insight: mode === "tutorial" ? 0 : 4,
    workers: 0,
    villagerPurchases: 0,
    freeRerolls: clan === "stag" ? 1 : 0,
    shopRolls: 0,
    fateRolls: 0,
    paidShopRerolls: 0,
    paidFateRerolls: 0,
    owned,
    featureRunes: [],
    placements,
    shop:
      mode === "tutorial"
        ? [null, null, null, null]
        : shop(
            { seed, clan, round: 1, season: "spring", shopRolls: 0 },
            offerIndex,
          ),
    fate:
      mode === "tutorial"
        ? [null, null, null]
        : fate(
            {
              seed,
              round: 1,
              fateRolls: 0,
              favor,
              blessings: [],
              placements,
              owned,
            },
            offerIndex,
          ),
    blessings: [],
    shopAppearanceSnapshot: [],
    favor,
    chiefGrowth: { damage: 0, health: 0 },
  });
}
export function saleReturns(
  state: Pick<Game, "blessings">,
  p: Pick<Game["placements"][number], "id" | "level" | "workers">,
) {
  if (p.id === "polis-hall") return null;
  const drachmas =
    Math.ceil(Math.fround(sourceItemCosts[p.id] * 0.5)) * p.level;
  return {
    drachmas,
    insight: state.blessings.some((id) => fates[id].saleInsight) ? drachmas : 0,
    workers: p.workers - buildings[p.id].initialWorkers,
  };
}

export function price(game: Game, item: NonNullable<Game["shop"][number]>) {
  const discount = game.blessings.reduce((sum, id) => {
    const { discount = 0, holders } = fates[id];
    return sum + (holders && holds(item.id, holders) ? discount : 0);
  }, 0);
  return item.price <= 0 ? 0 : Math.max(1, item.price - discount);
}
export function villagerPrice(game: Game) {
  return (
    preparationCosts.villager.base +
    preparationCosts.villager.increase * game.villagerPurchases
  );
}
export function shopRerollPrice(game: Game) {
  if (game.freeRerolls > 0) return 0;
  const listed = sourceEconomy.shopRerolls[game.paidShopRerolls];
  if (listed === undefined) return null;
  const mountain = sourceMap(game.seed).tiles.some(
    (tile) => tile.feature === "mountain" && game.owned.includes(tile.id),
  );
  return Math.max(1, listed - (mountain ? 1 : 0));
}
// Serialized ladder 1..64 (DefaultGlobalSettings). An 8th paid reroll is unobserved: provisionally
// rejected, mirroring the shop ladder.
export function fateRerollPrice(game: Pick<Game, "paidFateRerolls">) {
  return sourceEconomy.fateRerolls[game.paidFateRerolls] ?? null;
}

function rollShop(next: Game, authority?: GameAuthority): Game["shop"] {
  const guide = next.tutorial;
  const scripted = [1, 4].includes(next.round)
    ? 0
    : next.round === 3
      ? 1
      : null;
  if (scripted === null || !guide)
    return shop(next, authority?.offerIndex, appearanceTags(next));
  const lists = [
    ["javelin-camp", "defense-tower", "spear-camp", "shield-camp"],
    ["hunters-lodge", "silver-mine", "farm", "woodcutter"],
  ] as const;
  const list = lists[scripted];
  const draw = () => {
    const index = guide.shopCursors[scripted];
    const id = list[index];
    if (!id) throw new Error("Invalid scripted shop cursor");
    guide.shopCursors[scripted] = (index + 1) % list.length;
    return { id, price: sourceItemCosts[id] };
  };
  return [draw(), draw(), draw(), draw()];
}
function enterTutorial(
  next: Game,
  stage: NonNullable<Game["tutorial"]>["stage"],
) {
  if (!next.tutorial) return;
  next.tutorial.stage = stage;
  next.tutorial.chapter = tutorialChapter(next.round, stage);
}
function prepareRound(next: Game): Game {
  const tiles = sourceMap(next.seed).tiles;
  next.placements = next.placements.map((p) => {
    const growth = "growth" in p ? p.growth : 0;
    if (p.id === "farm" && tiles[p.tile]?.terrain === "fertile")
      return { ...p, id: p.id, growth: growth + 5 * p.level };
    if (p.id === "offering-well") return { ...p, id: p.id, growth: growth + 1 };
    return p;
  });
  for (const id of next.blessings) {
    const { growth } = fates[id];
    if (growth) {
      next.chiefGrowth.damage += growth.damage;
      next.chiefGrowth.health += growth.health;
    }
  }
  next.villagerPurchases = 0;
  next.paidShopRerolls = 0;
  next.paidFateRerolls = 0;
  next.freeRerolls = next.clan === "stag" ? next.skills[1] : 0;
  next.phase = { kind: "income" };
  const { incomeCheckpoint: _previous, ...checkpoint } = next;
  next.incomeCheckpoint = structuredClone(checkpoint);
  return next;
}

function openShop(next: Game, authority?: GameAuthority): Game {
  next.incomeCheckpoint = null;
  next.shopAppearanceSnapshot = next.blessings.filter(
    (id) => fates[id].appearance,
  );
  next.shopRolls++;
  next.shop = rollShop(next, authority);
  next.fateChosen = false;
  if (next.tutorial) {
    next.tutorial.previousFate = [];
    next.fate = [null, null, null];
  } else {
    next.fateRolls++;
    next.fate = fate(next, authority?.offerIndex);
  }
  next.phase = { kind: "prepare" };
  enterTutorial(next, "shop");
  return next;
}

export function apply(
  game: Game,
  action: Command,
  authority?: GameAuthority,
): Game {
  if (game.mode === "async" && !authority)
    throw new Error("Async actions require the authoritative owner");
  const next = structuredClone(game);
  if (action.op === "restart") {
    if (next.phase.kind !== "finished")
      throw new Error("Finish this run before starting another");
    const fresh = newGame(
      random(game.seed),
      action.clan,
      game.mode,
      authority?.offerIndex,
    );
    fresh.revision = game.revision;
    return fresh;
  }
  if (action.op === "tutorial-chapter") {
    if (!next.tutorial) throw new Error("No tutorial is active");
    if (
      tutorialBlocked(next.tutorial) &&
      next.tutorial.chapter?.origin === "automatic"
    )
      throw new Error("Close the current chapter first");
    next.tutorial.chapter =
      next.tutorial.chapter?.origin === "manual" &&
      next.tutorial.chapter.id === action.chapter
        ? null
        : { id: action.chapter, origin: "manual" };
    return next;
  }
  if (action.op === "tutorial-close") {
    if (!next.tutorial?.chapter) throw new Error("No tutorial chapter is open");
    const chapter = next.tutorial.chapter;
    if (chapter.origin === "automatic" && chapter.id === "ending")
      throw new Error("Choose Continue or Leave the tutorial");
    if (chapter.origin === "automatic" && chapter.id === "post-battle")
      next.tutorial.postBattleShown = true;
    next.tutorial.chapter = null;
    return next;
  }
  if (action.op === "continue" && next.tutorial) {
    if (
      next.tutorial.chapter?.origin === "automatic" &&
      next.tutorial.chapter.id === "ending"
    ) {
      next.tutorial.ending = "continued";
      next.tutorial.chapter = null;
      return next;
    }
    if (
      next.phase.kind === "prepare" &&
      next.tutorial.stage === "welcome" &&
      next.tutorial.chapter?.origin !== "manual"
    )
      return prepareRound(next);
  }
  if (tutorialBlocked(next.tutorial))
    throw new Error("Close the tutorial chapter first");
  if (
    action.op === "continue" &&
    next.tutorial &&
    next.phase.kind === "prepare"
  ) {
    if (next.tutorial.stage === "shop") {
      enterTutorial(next, "fate");
      next.fateRolls++;
      if (!next.fateChosen)
        next.fate =
          next.round === 1
            ? tutorialFate(next)
            : fate(next, authority?.offerIndex);
    } else if (next.tutorial.stage === "fate") enterTutorial(next, "prepare");
    else throw new Error("Ready for battle to continue");
    return next;
  }
  if (action.op === "ready") {
    if (next.phase.kind !== "prepare")
      throw new Error("Finish the current phase first");
    if (next.tutorial && next.tutorial.stage !== "prepare")
      throw new Error("Finish the tutorial preparation stages first");
    const encounter = battle.parse(
      sourceEncounterKind(next.round) === "pve"
        ? pveMatch(next)
        : authority
          ? authority.encounter(next)
          : practiceMatch(next),
    );
    const expectedKind =
      sourceEncounterKind(next.round) === "pve"
        ? "pve"
        : next.mode !== "async"
          ? "training"
          : "pvp";
    if (encounter.kind !== expectedKind)
      throw new Error("Encounter does not match game mode");
    next.phase = {
      kind: "result",
      battleId: next.revision + 1,
      encounter,
      outcome: resolveBattle(encounter),
    };
    next.insight += next.phase.outcome.insight ?? 0;
    if (encounter.kind !== "pve") {
      if (next.phase.outcome.winner === "polis") next.wins++;
      else next.lives--;
    }
    if (next.tutorial)
      next.tutorial.chapter =
        next.round === 2 && !next.tutorial.postBattleShown
          ? tutorialChapter(2, "result")
          : null;
    return next;
  }
  if (action.op === "continue") {
    if (next.phase.kind !== "result")
      throw new Error("No battle result to continue");
    next.chiefBattles++;
    if (next.wins === 10 || next.lives === 0) {
      next.phase = {
        kind: "finished",
        outcome: next.lives === 0 ? "defeat" : "victory",
      };
      return next;
    }
    next.round++;
    next.season = seasonForRound(next.round);
    if (next.round === sourceRoundLimit) {
      next.phase = { kind: "finished", outcome: "round-limit" };
      return next;
    }
    if ([5, 9, 13].includes(next.round)) {
      next.phase = { kind: "season" };
      enterTutorial(next, "welcome");
      return next;
    }
    return prepareRound(next);
  }
  if (action.op === "upgrade") {
    if (next.phase.kind !== "season")
      throw new Error("No seasonal upgrade available");
    if (action.choice === "hall") {
      const hall = next.placements.find((p) => p.id === "polis-hall");
      if (!hall || hall.id !== "polis-hall" || hall.level === levelCaps.hall)
        throw new Error("Polis Hall is fully improved");
      const nextLevel = { 1: 2, 2: 3, 3: 4, 4: 4 } satisfies Record<
        1 | 2 | 3 | 4,
        1 | 2 | 3 | 4
      >;
      hall.level = nextLevel[hall.level];
    } else {
      const i = { "skill-0": 0, "skill-1": 1, "skill-2": 2 }[action.choice];
      const current = next.skills[i];
      if (current === undefined || current === levelCaps.skill)
        throw new Error("Clan skill is fully improved");
      next.skills[i] = current === 1 ? 2 : 3;
      if (i === 0 && next.clan === "stag")
        next.stagIncomePosition = next.blessings.length;
    }
    return prepareRound(next);
  }
  if (next.phase.kind !== "prepare")
    throw new Error("Preparation actions are unavailable in this phase");
  if (
    next.tutorial &&
    next.tutorial.stage !== "fate" &&
    (action.op === "fate" || action.op === "reroll-fate")
  )
    throw new Error(
      "Visit the tutorial Fate stage before choosing or rerolling Fate",
    );
  switch (action.op) {
    case "buy": {
      const item = next.shop[action.slot];
      if (!item) throw new Error("Shop offer is empty");
      const owner = buildings[item.id].clan;
      if (owner && owner !== next.clan)
        throw new Error(`${buildings[item.id].name} belongs to another clan`);
      if (!buildings[item.id].available)
        throw new Error("This structure is unavailable in practice");
      if (!next.owned.includes(action.tile))
        throw new Error("Colonize this tile first");
      if (sourceMap(next.seed).tiles[action.tile]?.feature)
        throw new Error("A map feature occupies this tile");
      const occupant = next.placements.find((p) => p.tile === action.tile);
      if (occupant && occupant.id !== item.id)
        throw new Error("Tile is occupied by another structure");
      if (occupant?.level === levelCaps.building)
        throw new Error("Structure is already level 3");
      const cost = price(next, item);
      if (next.drachmas < cost) throw new Error("Not enough Drachmas");
      next.drachmas -= cost;
      next.shop[action.slot] = null;
      if (occupant) occupant.level = occupant.level === 1 ? 2 : 3;
      else {
        addEntry(next, action.tile);
        next.placements.push({
          tile: action.tile,
          id: item.id,
          level: 1,
          workers: buildings[item.id].initialWorkers,
          rune: null,
        });
      }
      return next;
    }
    case "sell": {
      const p = next.placements.find((p) => p.tile === action.tile);
      if (!p || !next.owned.includes(action.tile))
        throw new Error("Choose an owned structure");
      const returned = saleReturns(next, p);
      if (!returned) throw new Error("The Polis Hall cannot be sold");
      next.drachmas += returned.drachmas;
      next.insight += returned.insight;
      next.workers += returned.workers;
      removeEntry(next, action.tile);
      next.placements = next.placements.filter((p) => p.tile !== action.tile);
      return next;
    }
    case "villager": {
      const cost = villagerPrice(next);
      if (next.drachmas < cost) throw new Error("Not enough Drachmas");
      if (next.workers === workerLimit)
        throw new Error("Villager inventory is full");
      next.drachmas -= cost;
      next.workers++;
      if (next.villagerPurchases === 100)
        throw new Error("Villager purchase limit reached");
      next.villagerPurchases++;
      return next;
    }
    case "assign": {
      const p = next.placements.find((p) => p.tile === action.tile);
      if (!p) throw new Error("Choose a structure");
      if (p.workers >= buildings[p.id].workerSlots)
        throw new Error("No worker slots available");
      if (!next.workers) throw new Error("No unassigned Villager");
      next.workers--;
      p.workers++;
      return next;
    }
    case "colonize": {
      if (next.owned.includes(action.tile))
        throw new Error("Tile is already owned");
      if (!grid[action.tile]?.playable)
        throw new Error("Tile lies beyond the map");
      if (!next.owned.some((id) => adjacent(id, action.tile)))
        throw new Error("Tile must border your territory");
      if (!next.workers) throw new Error("No unassigned Villager");
      next.workers--;
      next.owned.push(action.tile);
      if (next.clan === "raven") {
        const amount = { 1: 1, 2: 3, 3: 6 }[next.skills[0]];
        next.drachmas += amount;
        next.insight += amount;
      }
      return next;
    }
    case "move": {
      const p = next.placements.find((p) => p.tile === action.from);
      if (!p) throw new Error("Source tile is empty");
      if (!next.owned.includes(action.to))
        throw new Error("Colonize this tile first");
      if (sourceMap(next.seed).tiles[action.to]?.feature)
        throw new Error("A map feature occupies this tile");
      const displaced = next.placements.find((p) => p.tile === action.to);
      if (displaced?.id === p.id)
        throw new Error("Same-item movement and merging are unavailable");
      removeEntry(next, action.from);
      if (displaced) removeEntry(next, action.to);
      addEntry(next, action.to);
      if (displaced) {
        addEntry(next, action.from);
        displaced.tile = action.from;
      }
      p.tile = action.to;
      return next;
    }
    case "reroll-shop": {
      const cost = shopRerollPrice(next);
      if (cost === null) throw new Error("No shop rerolls remain this round");
      if (next.drachmas < cost) throw new Error("Not enough Drachmas");
      next.drachmas -= cost;
      if (next.freeRerolls > 0) next.freeRerolls--;
      else next.paidShopRerolls++;
      next.shopRolls++;
      next.shop = rollShop(next, authority);
      return next;
    }
    case "reroll-fate": {
      // One choice per roll (inferred from 3/3 witnessed purchases): a purchase spends the round.
      if (next.fateChosen)
        throw new Error("This round's Fate is already woven");
      const cost = fateRerollPrice(next);
      if (cost === null) throw new Error("No Fate rerolls remain this round");
      if (next.insight < cost) throw new Error("Not enough Insight");
      next.insight -= cost;
      next.paidFateRerolls++;
      next.fateRolls++;
      if (next.tutorial && next.round === 1) {
        next.tutorial.previousFate = next.fate.filter((id) => id !== null);
        next.fate = tutorialFate(next);
      } else next.fate = fate(next, authority?.offerIndex);
      return next;
    }
    case "fate": {
      const id = next.fate[action.slot];
      if (!id) throw new Error("Fate offer is empty");
      const card = fates[id];
      const target = next.placements.find((p) => p.tile === action.tile);
      const feature =
        action.tile === undefined
          ? null
          : sourceMap(next.seed).tiles[action.tile]?.feature;
      if (card.kind === "rune" || card.kind === "spell") {
        if (action.tile === undefined)
          throw new Error("Choose a target structure first");
        if (
          card.kind === "rune"
            ? !next.owned.includes(action.tile) ||
              !(target
                ? canCharmTarget(id, target.id)
                : feature && canCharmTarget(id, feature))
            : !target || !card.holders || !holds(target.id, card.holders)
        )
          throw new Error(`${card.name} cannot target that structure`);
        if (
          card.upgrade &&
          target &&
          (target.id === "polis-hall" || target.level === levelCaps.building)
        )
          throw new Error("Structure is already level 3");
      } else if (action.tile !== undefined)
        throw new Error(`${card.name} takes no target`);
      if (next.insight < card.cost) throw new Error("Not enough Insight");
      if (card.kind === "blessing" && next.blessings.some((b) => b === id))
        throw new Error("Blessing is already owned");
      if (card.villagers && next.workers + card.villagers > workerLimit)
        throw new Error("Inventory is full");
      next.insight -= card.cost;
      // Every entry in the card's favor list grants one favor (engine cap 100).
      for (const patron of card.favor)
        next.favor[patron] = Math.min(100, next.favor[patron] + 1);
      next.drachmas += card.drachmas ?? 0;
      next.workers += card.villagers ?? 0;
      if (card.kind === "blessing") next.blessings.push(blessingId.parse(id));
      // A new Charm replaces (destroys) the structure's previous one.
      if (target && card.kind === "rune") target.rune = runeId.parse(id);
      else if (feature && action.tile !== undefined && card.kind === "rune") {
        next.featureRunes = next.featureRunes.filter(
          ([tile]) => tile !== action.tile,
        );
        next.featureRunes.push([action.tile, runeId.parse(id)]);
      }
      if (target && card.upgrade && target.id !== "polis-hall")
        target.level = target.level === 1 ? 2 : 3;
      next.fate = [null, null, null];
      next.fateChosen = true;
      return next;
    }
    default: {
      const impossible: never = action;
      return impossible;
    }
  }
}

export function inspection(state: Game) {
  return {
    r: state.revision,
    rulesVersion: state.rulesVersion,
    calendar: structuredClone(sourceCalendar),
    round: state.round,
    season: state.season,
    clan: state.clan,
    mode: state.mode,
    tutorial: state.tutorial
      ? {
          stage: state.tutorial.stage,
          chapter: structuredClone(state.tutorial.chapter),
          postBattleShown: state.tutorial.postBattleShown,
          ending: state.tutorial.ending,
        }
      : null,
    phase: state.phase.kind,
    battleId: state.phase.kind === "result" ? state.phase.battleId : null,
    skills: [...state.skills],
    battle:
      state.phase.kind === "result"
        ? {
            opponent: state.phase.encounter.opponent,
            kind: state.phase.encounter.kind,
            ...state.phase.outcome,
          }
        : null,
    outcome: state.phase.kind === "finished" ? state.phase.outcome : null,
    lives: state.lives,
    wins: state.wins,
    balance: [state.drachmas, state.insight],
    workers: state.workers,
    villagerPrice: villagerPrice(state),
    freeRerolls: state.freeRerolls,
    rerollCosts: [shopRerollPrice(state), fateRerollPrice(state)],
    owned: [...state.owned],
    fog: fog(state.owned),
    placements: state.placements.map(encodePlacement),
    featureRunes: structuredClone(state.featureRunes),
    shop: state.shop.map((p) => (p ? [p.id, price(state, p)] : null)),
    fate: [...state.fate],
    fateChosen: state.fateChosen,
    blessings: [...state.blessings],
    favor: { ...state.favor },
  };
}

type Change = { r: number; delta: Record<string, unknown> };
const asyncCommitBoundaries = new Set<Command["op"]>([
  "reroll-shop",
  "reroll-fate",
  "ready",
  "continue",
  "upgrade",
  "restart",
]);

type Payment = { currency: Currency; amount: number };
type IncomeStep =
  | ({ kind: "pay" } & Payment)
  | { kind: "memory"; tile: Game["owned"][number] }
  | { kind: "stag" }
  | { kind: "gather"; threshold: number };
type IncomeTask = { kind: "ordinary" } | ({ kind: "drop" } & Payment);
export type IncomeRuntime = {
  clock: ReturnType<typeof createIncomeClock>;
  queue: ReturnType<typeof createDropQueue<IncomeTask>>;
  cursor: { steps: IncomeStep[]; index: number } | null;
  random: number;
  draws: number;
};
function incomeRuntime(game: Game, now: number): IncomeRuntime {
  return {
    clock: createIncomeClock(now),
    queue: createDropQueue<IncomeTask>(),
    cursor: null,
    random: game.seed,
    draws: 0,
  };
}
function incomeSteps(game: Game): IncomeStep[] {
  const board = boardOf(game);
  const groups = new Map(
    ordinaryIncome(game).map((group) => [group.tile, group.payments]),
  );
  const eligible = board.placements.filter((p) => p.level === 3);
  const bound = eligible.at(-1)?.tile;
  return (board.items ?? []).flatMap((item): IncomeStep[] => {
    const steps: IncomeStep[] = (groups.get(item.tile) ?? []).map(
      (payment) => ({ kind: "pay", ...payment }),
    );
    if (item.rune === "memory-of-the-polis")
      steps.push({ kind: "memory", tile: item.tile });
    for (let position = 0; position <= game.blessings.length; position++) {
      if (
        game.clan === "stag" &&
        position === game.stagIncomePosition &&
        item.tile === bound
      )
        steps.push({ kind: "stag" });
      const id = game.blessings[position];
      if (!id) continue;
      const threshold = fates[id].storedInsight;
      if (threshold && !("feature" in item) && item.id === "polis-hall")
        steps.push({ kind: "gather", threshold });
    }
    return steps;
  });
}
function gain(game: Game, payment: Payment) {
  if (payment.currency === "villagers")
    game.workers = Math.min(workerLimit, game.workers + payment.amount);
  else game[payment.currency] += payment.amount;
}
function advanceIncome(
  game: Game,
  runtime: IncomeRuntime,
  authority?: GameAuthority,
) {
  const cursor = runtime.cursor;
  if (!cursor) return;
  const now = Math.fround(runtime.clock.elapsed / 1000);
  const queueDrops = (payments: Payment[]) => {
    const delayed = assignDropDelays(
      payments.map((value) => ({ value, amount: value.amount })),
      () => {
        const index = runtime.draws++;
        runtime.random = random(runtime.random);
        const draw = authority
          ? authority.offerIndex(
              {
                kind: "income",
                seed: game.seed,
                round: game.round,
                roll: index,
                slot: 0,
                draw: "delay",
                attempt: 0,
              },
              0x100000000,
            )
          : runtime.random;
        return Math.fround((draw / 0x100000000) * 0.5);
      },
    );
    for (const drop of delayed)
      queueTask(runtime.queue, {
        value: { kind: "drop", ...drop.value },
        start: now,
        delay: drop.delay,
      });
  };
  while (cursor.index < cursor.steps.length) {
    const step = cursor.steps[cursor.index++];
    if (!step) break;
    switch (step.kind) {
      case "pay":
        gain(game, step);
        queueTask(runtime.queue, {
          value: { kind: "ordinary" },
          start: now,
          delay: 0.5,
        });
        return;
      case "gather":
        game.insight += Math.max(0, Math.trunc(game.insight / step.threshold));
        break;
      case "memory": {
        const payments: Payment[] = [];
        for (const target of boardOf(game).items ?? []) {
          if (
            !adjacent(step.tile, target.tile) ||
            !itemHolds("feature" in target ? target.feature : target.id, {
              any: ["civilian"],
            })
          )
            continue;
          payments.push(
            { currency: "insight", amount: 1 },
            { currency: "drachmas", amount: 1 },
          );
        }
        queueDrops(payments);
        break;
      }
      case "stag": {
        const payments: Payment[] = [];
        for (const target of boardOf(game).placements) {
          if (target.level !== 3) continue;
          payments.push({
            currency: "drachmas",
            amount: game.skills[0] === 3 ? 2 : 1,
          });
          payments.push({
            currency: "insight",
            amount: game.skills[0] >= 2 ? 1 : 0,
          });
        }
        queueDrops(payments);
        break;
      }
      default: {
        const exhaustive: never = step;
        return exhaustive;
      }
    }
  }
  runtime.cursor = null;
  openShop(game, authority);
}
// Only a genuinely recreated owner uses this checkpoint; live clones keep their runtime.
export function recreateGame(saved: Game): Game {
  const game = parseGame(saved);
  if (!game.incomeCheckpoint) return game;
  return parseGame({
    ...game.incomeCheckpoint,
    revision: game.revision + 1,
    incomeCheckpoint: game.incomeCheckpoint,
  });
}

export function gameSession(
  initial: Game,
  persist: (game: Game) => void,
  changed: () => void,
  authority?: GameAuthority,
  options: { now?: number; runtime?: IncomeRuntime } = {},
) {
  let state = parseGame(initial);
  let runtime = structuredClone(
    options.runtime ?? incomeRuntime(state, options.now ?? performance.now()),
  );
  let disposed = false;
  const journal: Change[] = [];
  function inspect(): ReturnType<typeof inspection>;
  function inspect(
    since: number | undefined,
  ): ReturnType<typeof inspection> | { r: number; changes: Change[] };
  function inspect(since?: number) {
    if (since === state.revision) return { r: state.revision, changes: [] };
    if (
      since !== undefined &&
      since < state.revision &&
      journal.length &&
      since >= (journal[0]?.r ?? 1) - 1
    )
      return {
        r: state.revision,
        changes: structuredClone(journal.filter((e) => e.r > since)),
      };
    return inspection(state);
  }
  function commit(next: Game, candidate: IncomeRuntime, notify = true) {
    const different = JSON.stringify(next) !== JSON.stringify(state);
    if (!different) {
      runtime = candidate;
      return;
    }
    next.revision = state.revision + 1;
    next = parseGame(next);
    const before = new Map(Object.entries(inspection(state)));
    const delta = Object.fromEntries(
      Object.entries(inspection(next)).filter(
        ([key, value]) =>
          key !== "r" &&
          JSON.stringify(value) !== JSON.stringify(before.get(key)),
      ),
    );
    persist(next);
    state = next;
    runtime = candidate;
    const entry = { r: state.revision, delta };
    journal.push(entry);
    if (journal.length > 32) journal.shift();
    if (notify) changed();
  }
  function startIncome(next: Game, candidate: IncomeRuntime) {
    if (next.phase.kind === "income" && !candidate.cursor) {
      candidate.cursor = { steps: incomeSteps(next), index: 0 };
      advanceIncome(next, candidate, authority);
    }
  }
  if (!options.runtime && state.phase.kind === "income") {
    const next = structuredClone(state);
    startIncome(next, runtime);
    commit(next, runtime, false);
  }
  return {
    get state() {
      return structuredClone(state);
    },
    get runtime() {
      return structuredClone(runtime);
    },
    get pending() {
      return (
        !disposed &&
        (runtime.cursor !== null ||
          runtime.queue.active.length > 0 ||
          runtime.queue.deferred.length > 0)
      );
    },
    update(now: number) {
      if (disposed) return;
      const candidate = structuredClone(runtime);
      const time = advanceIncomeClock(candidate.clock, now);
      const next = structuredClone(state);
      runDropPass(candidate.queue, time, (task) => {
        if (task.kind === "drop") gain(next, task);
        else advanceIncome(next, candidate, authority);
      });
      commit(next, candidate);
    },
    pause(paused: boolean, now: number) {
      if (disposed) return;
      advanceIncomeClock(runtime.clock, now);
      runtime.clock.paused = paused;
    },
    saveAndExit() {
      if (disposed) return;
      const next = structuredClone(state);
      if (next.phase.kind === "income") openShop(next, authority);
      const candidate = incomeRuntime(next, runtime.clock.last);
      commit(next, candidate);
      disposed = true;
    },
    dispose() {
      disposed = true;
    },
    inspect,
    act(input: unknown) {
      if (disposed) throw new Error("This game owner is closed");
      const request = transaction.parse(input);
      if (request.revision !== state.revision)
        throw new Error("Stale revision; inspect the game again");
      if (state.mode === "async") {
        const boundary = request.actions
          .slice(0, -1)
          .find((action) => asyncCommitBoundaries.has(action.op));
        if (boundary) throw new Error(`${boundary.op} must end an async batch`);
      }
      let next = state;
      for (const action of request.actions)
        next = apply(next, action, authority);
      const candidate = request.actions.some(
        (action) => action.op === "restart",
      )
        ? incomeRuntime(next, runtime.clock.last)
        : structuredClone(runtime);
      startIncome(next, candidate);
      // A successful command remains an observable transaction even if its fields did not change.
      next.revision++;
      commit(next, candidate);
      const entry = journal.at(-1);
      return {
        r: state.revision,
        changes: entry ? structuredClone([entry]) : [],
      };
    },
  };
}
