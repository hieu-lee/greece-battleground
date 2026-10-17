import type { Game } from "./game.ts";
import {
  buildings,
  fates,
  featureTags,
  hasTag,
  hasSelectorTags,
  sourceWindupPercent,
  troopNames,
} from "./rules.ts";
import type {
  BuildingId,
  Counter,
  Currency,
  Effect,
  FateId,
  Stat,
  Tag,
} from "./rules.ts";
import { clans } from "./clans.ts";
import {
  adjacent,
  grid,
  neighbours,
  publicMap,
  sourceMap,
  start,
} from "./map.ts";
import type { Feature, Terrain, TileId } from "./map.ts";
import type { Fighter, Battle } from "./combat.ts";
import type { OpponentLayout } from "./encounter-layout.ts";
import { sourceUnit, sourceCampCounts, sourceSpawn } from "./source-numbers.ts";
import { statValue } from "./float-stat.ts";
import { entryTiles } from "./item-entries.ts";
import { itemHolds, sourceHasStatReceiver } from "./charm-targets.ts";
import { tutorialOpponent } from "./tutorial-opponents.ts";

type Placement = Game["placements"][number];
type FeatureItem = {
  feature: Feature;
  tile: TileId;
  level: 1;
  workers: 0;
  rune: Placement["rune"];
};
type Item = Placement | FeatureItem;
// Everything a structure or Fate effect can read. `tiles` (terrain and map items) comes from the
// engine map; callers without it (client previews) see no terrain or map-item bonuses.
export type Board = {
  owned: readonly TileId[];
  drachmas: number;
  placements: readonly Placement[];
  blessings: readonly FateId[];
  items?: readonly Item[];
  tiles?: readonly { terrain: Terrain | null; feature: Feature | null }[];
};
export function boardOf(game: Game): Board {
  const entries = entryTiles(game);
  const placed = new Map(game.placements.map((p) => [p.tile, p]));
  const runes = new Map(game.featureRunes);
  const tiles = sourceMap(game.seed).tiles;
  const items = entries.flatMap((tile): Item[] => {
    const placement = placed.get(tile);
    if (placement) return [placement];
    const feature = tiles[tile]?.feature;
    return feature && game.owned.includes(tile)
      ? [{ feature, tile, level: 1, workers: 0, rune: runes.get(tile) ?? null }]
      : [];
  });
  return {
    ...game,
    placements: entries.flatMap((tile) => placed.get(tile) ?? []),
    items,
    tiles,
  };
}
function featureAt(board: Board, tile: TileId) {
  return board.tiles?.[tile]?.feature ?? null;
}
function count(board: Board, source: Item, per: Counter) {
  if ("workers" in per) return source.workers;
  if ("drachmas" in per) return board.drachmas;
  const tiles =
    per.scope === "adjacent" ? neighbours(source.tile) : board.owned;
  return tiles.filter((tile) => {
    const placed = board.placements.find((p) => p.tile === tile);
    const feature = featureAt(board, tile);
    if ("empty" in per)
      return (
        (per.empty === "playable"
          ? grid[tile]?.playable
          : board.owned.includes(tile)) &&
        !placed &&
        !feature
      );
    if ("feature" in per) return feature === per.feature;
    const tags: readonly Tag[] = placed
      ? buildings[placed.id].tags
      : feature
        ? featureTags[feature]
        : [];
    return hasSelectorTags(tags, per);
  }).length;
}
function active(board: Board, source: Item, effect: Effect) {
  const when = effect.when;
  if (!when) return true;
  if ("tile" in when) return board.tiles?.[source.tile]?.terrain === when.tile;
  return count(board, source, when) > 0;
}
// Building tiers scale coefficients; Fate coefficients are fixed even on a level-4 Hall.
function amount(
  board: Board,
  source: Item,
  effect: Effect,
  coefficientLevel: Placement["level"],
) {
  const coefficient = Math.fround(effect.value[coefficientLevel - 1] ?? 0);
  if (!effect.per) return coefficient;
  const contextual = Math.fround(
    coefficient * Math.fround(count(board, source, effect.per)),
  );
  // One source modifier: combine its raw base before folding the Add list.
  return "base" in effect && effect.base !== undefined
    ? Math.fround(Math.fround(effect.base) + contextual)
    : contextual;
}
// One FloatStat modifier pipeline per stat (handoff 20261013-stat-operator-composition-closure-next):
// the Add list folds in binary32 from 0, the Multiply list from f32(1), each in list order, and
// each aggregate applies once, Add before Multiply; a zero aggregate skips its operator.
type Group = {
  add: number;
  subtract: number;
  multiply: number;
  multiplied: boolean;
};
type Modifiers = Record<Stat, Group>;
function grant(
  group: Group,
  value: number,
  operation: "add" | "subtract" | "multiply" = "add",
) {
  if (operation === "multiply") {
    group.multiply = Math.fround(group.multiply + value);
    group.multiplied = true;
  } else if (operation === "subtract")
    group.subtract = Math.fround(group.subtract + value);
  else group.add = Math.fround(group.add + value);
}
function basis(base: number, group: Group) {
  let value = Math.fround(base);
  if (group.add !== 0) value = Math.fround(group.add + value);
  if (group.subtract !== 0) value = Math.fround(value - group.subtract);
  return value;
}
function compose(base: number, group: Group) {
  return statValue({
    base,
    add: group.add,
    subtract: group.subtract,
    multiply: group.multiply,
  });
}
const statIds = [
  "damage",
  "crit",
  "armor",
  "health",
  "regen",
  "healing",
  "burn",
  "poison",
  "frost",
  "cleave",
  "thorn",
  "speed",
  "ward",
  "range",
  "revive",
  "count",
] as const satisfies readonly Stat[];
const isStat = (stat: Stat | Currency): stat is Stat =>
  statIds.some((id) => id === stat);
export function retainedAura(id: BuildingId, level: number, growth = 0) {
  if (id === "farm") return { health: growth, damage: 0 };
  if (id === "offering-well" && growth > 0)
    return {
      health: 15 * (growth + level - 1),
      damage: 3 * (growth + level - 1),
    };
  return { health: 0, damage: 0 };
}
// Every item retains its concrete type: map features are not structure placements.
function sources(board: Board): [Item, Effect, Placement["level"]][] {
  const found: [Item, Effect, Placement["level"]][] = [];
  const items = board.items ?? board.placements;
  for (const p of items) {
    if (!("feature" in p)) {
      const retained = retainedAura(
        p.id,
        p.level,
        "growth" in p ? p.growth : 0,
      );
      for (const effect of buildings[p.id].effects) {
        found.push([p, effect, p.level]);
        if (
          (effect.stat === "health" || effect.stat === "damage") &&
          effect.to &&
          retained[effect.stat] !== 0
        ) {
          const value = retained[effect.stat];
          found.push([
            p,
            { stat: effect.stat, value: [value, value, value], to: effect.to },
            p.level,
          ]);
        }
      }
    }
    // Memory pays deferred direct-wallet drops; ordinary item income cannot model it.
    if (p.rune && p.rune !== "memory-of-the-polis")
      for (const effect of fates[p.rune].effects ?? [])
        found.push([p, effect, 1]);
  }
  for (const id of board.blessings) {
    const { holders, effects = [] } = fates[id];
    for (const p of items)
      if (holders && itemHolds("feature" in p ? p.feature : p.id, holders))
        for (const effect of effects) found.push([p, effect, 1]);
  }
  return found;
}
// Every stat modifier a structure's troops receive, derived from the current board each time
// (never incremental), in source order: structure effects, Charms, then Blessings.
export function modifiers(board: Board, recipient: Placement): Modifiers {
  const result = Object.fromEntries(
    statIds.map((stat) => [
      stat,
      { add: 0, subtract: 0, multiply: Math.fround(1), multiplied: false },
    ]),
  ) as Modifiers;
  if (!sourceHasStatReceiver(recipient.id)) return result;
  for (const [source, effect, coefficientLevel] of sources(board)) {
    if (!isStat(effect.stat) || !active(board, source, effect)) continue;
    const to = "to" in effect ? effect.to : undefined;
    const receives = !to
      ? source.tile === recipient.tile
      : hasSelectorTags(buildings[recipient.id].tags, to) &&
        (to.scope === "adjacent"
          ? adjacent(source.tile, recipient.tile)
          : board.owned.includes(recipient.tile));
    if (!receives) continue;
    grant(
      result[effect.stat],
      amount(board, source, effect, coefficientLevel),
      "op" in effect ? effect.op : undefined,
    );
  }
  return result;
}
// King's Resolve Health Multiply coefficients per skill level, times the colonized level-3 count
// (handoffs chief-skill-runtime-closure-next, stat-operator-composition-closure-next).
const kingsResolve = [
  0.05999999865889549, 0.11999999731779099, 0.18000000715255737,
] as const;
// Ordinary currency dictionaries, in item traversal and authored currency order.
export function ordinaryIncome(game: Game) {
  const board = boardOf(game);
  const hall = board.placements.find((p) => p.id === "polis-hall");
  const empty = () => ({ drachmas: 0, insight: 0, villagers: 0 });
  const gains = new Map<TileId, Record<Currency, number>>();
  const add = (tile: TileId, currency: Currency, value: number) => {
    const current = gains.get(tile) ?? empty();
    current[currency] += value;
    gains.set(tile, current);
  };
  if (hall) {
    add(hall.tile, "drachmas", 11 + (hall.level - 1) * 2);
    add(hall.tile, "insight", 4 + (hall.level - 1));
  }
  for (const item of board.items ?? [])
    if ("feature" in item && item.feature === "circle-of-stone")
      add(
        item.tile,
        item.rune && fates[item.rune].remap ? "drachmas" : "insight",
        1,
      );
  for (const [p, effect, coefficientLevel] of sources(board))
    if (!isStat(effect.stat) && active(board, p, effect)) {
      // Wisdom into Wealth: the holder's Insight income pays Drachmas.
      const remapped =
        effect.stat === "insight" && p.rune && fates[p.rune].remap;
      add(
        p.tile,
        remapped ? "drachmas" : effect.stat,
        amount(board, p, effect, coefficientLevel),
      );
    }
  return entryTiles(game)
    .filter((tile) => game.owned.includes(tile))
    .map((tile) => ({
      tile,
      payments: (["drachmas", "insight", "villagers"] as const).flatMap(
        (currency) => {
          const value = (gains.get(tile) ?? empty())[currency];
          return value === 0 ? [] : [{ currency, amount: value }];
        },
      ),
    }));
}
// Direct Memory/Stag drops and Gather's live-wallet read are not ordinary forecasts.
export function roundIncome(game: Game): Record<Currency, number> {
  const result = { drachmas: 0, insight: 0, villagers: 0 };
  for (const group of ordinaryIncome(game))
    for (const payment of group.payments)
      result[payment.currency] += payment.amount;
  return result;
}
export function income(game: Game): [number, number] {
  const earned = roundIncome(game);
  return [earned.drachmas, earned.insight];
}

export function troopCount(board: Board, p: Placement) {
  if (p.id === "polis-hall") return 1;
  const troop = buildings[p.id].troop;
  if (!troop) return 0;
  const base =
    troop.count === "civilian-structures"
      ? Math.min(
          sourceCampCounts.peripolos.cap,
          Math.fround(
            board.placements.filter(
              (other) =>
                board.owned.includes(other.tile) &&
                hasTag(other.id, "civilian"),
            ).length * sourceCampCounts.peripolos.coefficient,
          ),
        )
      : troop.count === "stored-drachmas"
        ? Math.floor(
            Math.min(
              sourceCampCounts.misthophoros.cap,
              Math.fround(
                Math.fround(board.drachmas) *
                  sourceCampCounts.misthophoros.coefficient,
              ),
            ),
          )
        : troop.count === "workers"
          ? p.workers
          : troop.count === "fixed"
            ? sourceSpawn[troop.id].amount
            : neighbours(p.tile).filter(
                (tile) => featureAt(board, tile) === "circle-of-stone",
              ).length;
  return Math.max(
    0,
    Math.min(
      sourceSpawn[troop.id].cap,
      Math.floor(base + modifiers(board, p).count.add),
    ),
  );
}
export function warband(game: Game, side: Fighter["side"]): Fighter[] {
  const direction = side === "polis" ? 1 : -1;
  const board = boardOf(game);
  const units: Fighter[] = [];
  const chiefBase = sourceUnit(game.clan === "stag" ? "aegeus" : "atalanta", 1);
  const elite = game.placements.filter((p) => p.level === 3).length;
  for (const p of board.placements) {
    const tile = grid[p.tile];
    if (!tile) continue;
    const chief = p.id === "polis-hall";
    const troop = buildings[p.id].troop?.id ?? null;
    if (!chief && !troop) continue;
    const sprite = troop ?? (game.clan === "stag" ? "aegeus" : "atalanta");
    const count = troopCount(board, p);
    const bonus = modifiers(board, p);
    for (let i = 0; i < count; i++) {
      const base = troop ? sourceUnit(troop, p.level) : chiefBase;
      const u: Fighter = {
        name: troop ? troopNames[troop] : clans[game.clan].chief,
        sprite,
        side,
        origin: { side, tile: p.tile },
        // Formations keep their spacing relative to the Hall, which stands at x -5.5.
        x:
          direction *
          (-5.5 + (tile.q - start.q + (tile.r - start.r) / 2) * 0.5),
        y: (tile.r - start.r) * 0.85 + (i - (count - 1) / 2) * 0.35,
        health: base.health,
        armor: base.armor,
        damage: base.damage,
        damageStat: "attack",
        piercing: false,
        damageReduction: 0,
        speed: base.speed,
        windupPercent: sourceWindupPercent[sprite],
        movement: base.movement,
        range: base.range,
        regen: 0,
        healing: base.healing,
        poison: base.poison,
        frost: base.frost,
        cleave: base.cleave,
        stun: base.stun,
        thorn: 0,
        revive: base.revive,
        criticalGrowth:
          chief && game.clan === "raven"
            ? (game.skills[1] + 1) *
              game.placements.filter((other) => hasTag(other.id, "economy"))
                .length
            : 0,
        crit: base.crit,
        burn: base.burn,
        ward: chief && game.clan === "stag" && game.skills[2] === 3 ? elite : 0,
      };
      // The chief's growth and clan skills join the same pipelines as structures, Charms and Blessings.
      const stats = structuredClone(bonus);
      if (chief) {
        grant(stats.health, game.chiefBattles * 50);
        grant(stats.damage, game.chiefBattles * 5);
        // Growing Might of Heracles: permanent Add grants, one per round start.
        grant(stats.health, game.chiefGrowth.health);
        grant(stats.damage, game.chiefGrowth.damage);
        if (game.clan === "stag") {
          grant(stats.armor, game.chiefBattles * 10);
          grant(
            stats.health,
            Math.fround(kingsResolve[game.skills[2] - 1]! * Math.fround(elite)),
            "multiply",
          );
        } else grant(stats.crit, game.chiefBattles * 3);
      }
      if (game.clan === "raven")
        grant(
          stats.damage,
          game.placements.filter(
            (other) =>
              adjacent(p.tile, other.tile) && hasTag(other.id, "economy"),
          ).length *
            game.skills[2] *
            3,
        );
      const charm = p.rune ? fates[p.rune] : null;
      if (charm?.triggers) u.triggers = charm.triggers.map((t) => ({ ...t }));
      if (charm?.deathWardChain) u.deathWardChain = { ...charm.deathWardChain };
      if (charm?.killInsight) u.killInsight = charm.killInsight;
      u.attackStat = {
        base: u.damage,
        add: stats.damage.add,
        subtract: stats.damage.subtract,
        multiply: stats.damage.multiply,
      };
      u.armorStat = {
        base: u.armor,
        add: stats.armor.add,
        subtract: stats.armor.subtract,
        multiply: stats.armor.multiply,
      };
      u.health = compose(u.health, stats.health);
      u.armor = compose(u.armor, stats.armor);
      u.damage = compose(u.damage, stats.damage);
      u.crit = Math.min(100, compose(u.crit, stats.crit));
      u.regen = compose(u.regen, stats.regen);
      u.healing = compose(u.healing ?? 0, stats.healing);
      u.burn = compose(u.burn, stats.burn);
      u.poison = compose(u.poison ?? 0, stats.poison);
      u.frost = compose(u.frost ?? 0, stats.frost);
      u.cleave = compose(u.cleave ?? 0, stats.cleave);
      u.thorn = compose(u.thorn ?? 0, stats.thorn);
      u.speedStat = {
        basis: basis(u.speed, stats.speed),
        multiply: stats.speed.multiply,
      };
      u.speed = compose(u.speed, stats.speed);
      u.ward = compose(u.ward, stats.ward);
      u.range = Math.max(0, compose(u.range, stats.range));
      if (stats.revive.add !== 0 || stats.revive.multiplied)
        u.revive = compose(u.revive ?? 0, stats.revive);
      units.push(u);
    }
  }
  return units;
}
export function settlement(game: Game): OpponentLayout {
  return {
    clan: game.clan,
    map: publicMap(game.seed, game.owned),
    owned: [...game.owned],
    featureRunes: structuredClone(game.featureRunes),
    placements: game.placements.map((p) => [
      p.tile,
      p.id,
      p.level,
      p.workers,
      p.rune,
    ]),
  };
}
export function hornActivations(
  game: Game,
  side: Fighter["side"],
): NonNullable<Battle["horns"]> {
  const board = boardOf(game);
  const targets = board.placements
    .filter((p) => game.owned.includes(p.tile) && hasTag(p.id, "unit"))
    .map((p) => p.tile);
  return board.placements
    .filter((p) => p.id === "tritons-conch" && game.owned.includes(p.tile))
    .map((p) => ({
      side,
      speed: compose(0.125, modifiers(board, p).speed),
      duration: p.level,
      targets: [...targets],
    }));
}

export function towerActivations(
  game: Game,
  side: Fighter["side"],
): NonNullable<Battle["towers"]> {
  const board = boardOf(game);
  return board.placements.flatMap((p) => {
    if (
      !game.owned.includes(p.tile) ||
      (p.id !== "defense-tower" && p.id !== "thunderbolt-of-zeus")
    )
      return [];
    const stats = modifiers(board, p);
    const arrow = p.id === "defense-tower";
    const tile = grid[p.tile]!;
    return [
      {
        item: p.id,
        side,
        origin: { side, tile: p.tile },
        x:
          (side === "polis" ? 1 : -1) *
          (-5.5 + (tile.q - start.q + (tile.r - start.r) / 2) * 0.5),
        y: (tile.r - start.r) * 0.85,
        speed: compose(arrow ? 0.5 : 0.1428571492433548, stats.speed),
        count: compose(arrow ? 1 + p.workers : 5 * p.level, stats.count),
        damage: compose(arrow ? 5 * p.level : 0, stats.damage),
        burn: compose(arrow ? 0 : 15 * p.level, stats.burn),
        poison: compose(0, stats.poison),
        frost: compose(0, stats.frost),
      },
    ];
  });
}

export function practiceMatch(game: Game): Battle {
  if (game.mode === "tutorial") {
    const opponent = tutorialOpponent(game.round);
    return {
      ...opponent,
      seed: (game.seed + game.round * 131) >>> 0,
      kind: "training",
      opponentLayout: null,
      fighters: [...warband(game, "polis"), ...opponent.fighters],
      horns: [...hornActivations(game, "polis"), ...(opponent.horns ?? [])],
      towers: [...towerActivations(game, "polis"), ...(opponent.towers ?? [])],
    };
  }
  const strength = game.round - 1;
  // ponytail: Health, Armor and Damage curves are synthetic practice tuning (no source opponent);
  // attack speed, windup, movement and range are the source Hoplite row.
  const { speed, movement, range } = sourceUnit("hoplite", 1);
  const opponent: Fighter[] = [
    {
      name: "Practice captain",
      sprite: "hoplite",
      side: "opponent",
      origin: null,
      x: 5.5,
      y: 0,
      health: 190 + strength * 42,
      armor: 25 + strength * 9,
      damage: 9 + strength * 4,
      damageStat: "attack",
      piercing: false,
      damageReduction: 0,
      speed,
      windupPercent: sourceWindupPercent.hoplite,
      movement,
      range,
      regen: 0,
      criticalGrowth: 0,
      crit: 0,
      burn: 0,
      ward: 0,
    },
  ];
  for (let i = 0; i < Math.min(8, Math.floor(game.round / 2)); i++)
    opponent.push({
      name: "Practice Hoplite",
      sprite: "hoplite",
      side: "opponent",
      origin: null,
      x: 4.5 + Math.floor(i / 3) * 0.6,
      y: ((i % 3) - 1) * 0.8,
      health: 45 * (1 + Math.floor(game.round / 6)),
      armor: 0,
      damage: 5 * (1 + Math.floor(game.round / 6)),
      damageStat: "attack",
      piercing: false,
      damageReduction: 0,
      speed,
      windupPercent: sourceWindupPercent.hoplite,
      movement,
      range,
      regen: 0,
      criticalGrowth: 0,
      crit: 0,
      burn: 0,
      ward: 0,
    });
  return {
    seed: (game.seed + game.round * 131) >>> 0,
    kind: "training",
    opponent: "Practice warband",
    opponentLayout: null,
    fighters: [...warband(game, "polis"), ...opponent],
    horns: hornActivations(game, "polis"),
    towers: towerActivations(game, "polis"),
  };
}
