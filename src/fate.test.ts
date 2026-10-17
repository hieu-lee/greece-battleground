// Full Fate catalogue (docs/FATE-CATALOGUE.md): literal checks T1-T32 of the Fate spec.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import {
  apply,
  fatePool,
  fateRerollPrice,
  gameSession,
  inspection,
  newGame,
  price,
  unlockedFates,
} from "./game.ts";
import type { Game } from "./game.ts";
import { battle, createCombat, resolveBattle } from "./combat.ts";
import type { Fighter } from "./combat.ts";
import { eventSounds } from "./effects.ts";
import { fateId, fates } from "./rules.ts";
import type { BuildingId, FateId } from "./rules.ts";
import { grid, tileId } from "./map.ts";
import { income, roundIncome, settlement, warband } from "./warband.ts";
import { catalogTool } from "./play-catalog.ts";

function finishIncome(game: ReturnType<typeof gameSession>) {
  for (let pass = 0; pass < 100 && game.state.phase.kind === "income"; pass++)
    game.update(game.runtime.clock.last + 500);
}

const tile = (id: number) => tileId.parse(id);
// Hall 37; its neighbours 44,38,30,29,36,43; tile 30 borders 38,31,23,22,29,37.
function polis(
  structures: [number, BuildingId, (FateId | null)?][],
  setup: Partial<Game> = {},
): Game {
  const game = newGame(42, "stag");
  game.owned = grid.filter((t) => t.playable).map((t) => t.id);
  for (const [at, id, rune = null] of structures)
    game.placements.push({
      tile: tile(at),
      id: id as Exclude<BuildingId, "polis-hall">,
      level: 1,
      workers: id.endsWith("camp") || id === "healers-hut" ? 1 : 0,
      rune: rune as Game["placements"][number]["rune"],
    });
  return Object.assign(game, setup);
}
const troops = (game: Game, sprite: Fighter["sprite"]) =>
  warband(game, "polis").filter((u) => u.sprite === sprite);
const count = <T>(values: readonly T[]) =>
  values.reduce<Record<string, number>>((all, v) => {
    all[String(v)] = (all[String(v)] ?? 0) + 1;
    return all;
  }, {});

test("T1-T2 the catalogue lists 94 entries with the source kinds and tier costs", () => {
  const all = fateId.options.map((id) => fates[id]);
  assert.equal(all.length, 94);
  assert.deepEqual(count(all.map((f) => f.sourceKind)), {
    blessing: 25,
    charm: 49,
    gift: 15,
    spell: 5,
  });
  assert.equal(all.filter((f) => f.kind === "rune").length, 49);
  assert.deepEqual(count(all.map((f) => f.cost)), {
    4: 19,
    8: 21,
    16: 27,
    32: 27,
  });
  assert.deepEqual(count(all.map((f) => `${f.sourceKind}${f.cost}`)), {
    charm4: 11,
    charm8: 11,
    charm16: 11,
    charm32: 16,
    blessing4: 3,
    blessing8: 7,
    blessing16: 9,
    blessing32: 6,
    spell8: 3,
    spell16: 2,
    gift4: 5,
    gift16: 5,
    gift32: 5,
  });
});

test("T3-T5 favor gates reproduce 19/40/67/89/94; Generic gifts read the highest single favor", () => {
  const equal = (n: number) => ({ zeus: n, athena: n, apollo: n });
  assert.deepEqual(
    [0, 3, 5, 8, 10].map((n) => unlockedFates(equal(n)).length),
    [19, 40, 67, 89, 94],
  );
  assert.deepEqual(
    [3, 5, 8, 10].map(
      (n) => unlockedFates({ zeus: n, athena: 0, apollo: 0 }).length,
    ),
    [28, 42, 52, 57],
  );
  const split = unlockedFates({ zeus: 4, athena: 4, apollo: 0 });
  assert.equal(split.includes("aegean-salvage"), false);
  assert.equal(
    unlockedFates({ zeus: 5, athena: 0, apollo: 0 }).includes("aegean-salvage"),
    true,
  );
  assert.deepEqual(unlockedFates(equal(0)), [
    "call-to-peace",
    "hermes-fair-trade",
    "well-fed",
    "padded-armor",
    "protect-the-weak",
    "ruins-of-delphi",
    "lost-wanderer",
    "beseech-zeus",
    "beseech-athena",
    "beseech-apollo",
    "call-to-learning",
    "read-the-oracle",
    "hermes-pathfinders",
    "wisdom-into-wealth",
    "guardians-of-the-frontier",
    "call-to-war",
    "flurry-of-blows",
    "hephaestus-edge",
    "burning-blades",
  ]);
  assert.deepEqual(
    unlockedFates(equal(10)).filter(
      (id) => !unlockedFates(equal(8)).includes(id),
    ),
    [
      "mines-of-laurion",
      "ships-from-corinth",
      "invoke-zeus",
      "invoke-athena",
      "invoke-apollo",
    ],
  );
});

test("T6 excluded source cards never become ids; the ten earlier ids keep their names", () => {
  const natives = fateId.options.map((id) => fates[id].native);
  assert.equal(
    natives.some((n) =>
      /^(Thor_004|Loki_|Jord_|Neutral_05[45])|Affinity/.test(n),
    ),
    false,
  );
  assert.deepEqual(
    (
      [
        "lost-wanderer",
        "call-to-peace",
        "burning-blades",
        "call-to-learning",
        "flurry-of-blows",
        "protect-the-weak",
        "padded-armor",
        "call-to-war",
        "beseech-athena",
        "well-fed",
      ] as const
    ).map((id) => fates[id].name),
    [
      "Lost Wanderer",
      "Concord of Hestia",
      "Embers of Ares",
      "Athena’s Counsel",
      "Hermes’ Precision",
      "Hestia’s Shelter",
      "Aegis Weave",
      "Ares’ Muster",
      "Beseech Athena",
      "Demeter’s Bounty",
    ],
  );
});

test("T7-T8 paid rerolls follow the serialized ladder; failed payment and the provisional 8th reroll change nothing", () => {
  const start = newGame(42, "stag");
  start.round = 4;
  start.insight = 16;
  let saved = "";
  const game = gameSession(
    start,
    (next) => {
      saved = JSON.stringify(next);
    },
    () => {},
  );
  for (const balance of [15, 13, 9, 1]) {
    game.act({ revision: game.inspect().r, actions: [{ op: "reroll-fate" }] });
    assert.equal(game.state.insight, balance);
  }
  assert.equal(game.inspect().rerollCosts[1], 16);
  const before = [game.state, saved] as const;
  assert.throws(
    () => game.act({ revision: 4, actions: [{ op: "reroll-fate" }] }),
    /Not enough Insight/,
  );
  assert.deepEqual([game.state, saved], before);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((paidFateRerolls) =>
      fateRerollPrice({ paidFateRerolls }),
    ),
    [1, 2, 4, 8, 16, 32, 64, null],
  );
});

test("T9 a claimed round resets the reroll price once; a pending season choice changes nothing", () => {
  const start = newGame(42, "stag");
  start.round = 3;
  start.paidFateRerolls = 3;
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
  finishIncome(game);
  assert.deepEqual(
    [game.state.round, game.state.paidFateRerolls, game.state.fateRolls],
    [4, 0, 1],
  );
  assert.equal(game.inspect().rerollCosts[1], 1);
  game.act({ revision: game.state.revision, actions: [{ op: "reroll-fate" }] });
  const offers = game.state.fate;
  game.act({
    revision: game.state.revision,
    actions: [{ op: "ready" }, { op: "continue" }],
  });
  assert.equal(game.state.phase.kind, "season");
  assert.deepEqual(
    [game.state.fate, game.state.paidFateRerolls, game.state.fateRolls],
    [offers, 1, 2],
  );
  game.act({
    revision: game.state.revision,
    actions: [{ op: "upgrade", choice: "hall" }],
  });
  finishIncome(game);
  assert.deepEqual([game.state.paidFateRerolls, game.state.fateRolls], [0, 3]);
});

test("T10-T12 tier prices are charged and every favor entry grants +1 favor", () => {
  const poor = polis([[30, "spear-camp"]], {
    insight: 7,
    fate: ["echidnas-hide", null, null],
  });
  assert.throws(
    () => apply(poor, { op: "fate", slot: 0, tile: tile(30) }),
    /Not enough Insight/,
  );
  const paid = apply(
    { ...poor, insight: 8 },
    { op: "fate", slot: 0, tile: tile(30) },
  );
  assert.equal(paid.insight, 0);
  // ECON vector: Well Trained, Lore 34 -> 26, Thor 8 -> 9, Baldr 9 -> 10, Odin 0 -> 0.
  const trained = apply(
    polis([[30, "spear-camp"]], {
      insight: 34,
      favor: { zeus: 8, apollo: 9, athena: 0 },
      fate: ["spartan-discipline", null, null],
    }),
    { op: "fate", slot: 0, tile: tile(30) },
  );
  assert.deepEqual(
    [trained.insight, trained.favor],
    [26, { zeus: 9, apollo: 10, athena: 0 }],
  );
  // ECON vector: Beseech Odin, Lore 12 -> 8, Odin 1 -> 3.
  const beseech = apply(
    polis([], {
      insight: 12,
      favor: { zeus: 0, apollo: 0, athena: 1 },
      fate: ["beseech-athena", null, null],
    }),
    { op: "fate", slot: 0 },
  );
  assert.deepEqual([beseech.insight, beseech.favor.athena], [8, 3]);
});

test("T13 gifts grant Drachmas, Villagers and favor; the Villager inventory and favor cap hold", () => {
  const gift = (id: FateId, setup: Partial<Game> = {}) =>
    apply(polis([], { insight: 32, fate: [id, null, null], ...setup }), {
      op: "fate",
      slot: 0,
    });
  assert.deepEqual(
    (["ruins-of-delphi", "aegean-salvage", "mines-of-laurion"] as const).map(
      (id) => gift(id).drachmas - 11,
    ),
    [6, 12, 24],
  );
  assert.deepEqual(
    (["lost-wanderer", "citizens-answer", "ships-from-corinth"] as const).map(
      (id) => gift(id).workers,
    ),
    [1, 2, 4],
  );
  assert.throws(
    () => gift("ships-from-corinth", { workers: 205 }),
    /Inventory is full/,
  );
  assert.deepEqual(
    (["beseech-zeus", "pray-to-zeus", "invoke-zeus"] as const).map(
      (id) => gift(id).favor.zeus,
    ),
    [2, 3, 4],
  );
  assert.equal(
    gift("invoke-zeus", { favor: { zeus: 99, athena: 0, apollo: 1 } }).favor
      .zeus,
    100,
  );
});

test("T14 a purchase spends the whole roll until the next round (inferred one-choice rule)", () => {
  const game = gameSession(
    polis([], {
      insight: 20,
      fate: ["lost-wanderer", "call-to-peace", "beseech-athena"],
    }),
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "fate", slot: 0 }] });
  assert.deepEqual(game.state.fate, [null, null, null]);
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "fate", slot: 1 }] }),
    /Fate offer is empty/,
  );
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "reroll-fate" }] }),
    /already woven/,
  );
  assert.equal(game.state.insight, 16);
  game.act({ revision: 1, actions: [{ op: "ready" }, { op: "continue" }] });
  finishIncome(game);
  assert.equal(
    game.state.fate.every((id) => id !== null),
    true,
  );
});

test("T15 discount Blessings take 1 Drachma from matching structures, floor 1", () => {
  const game = newGame();
  game.blessings = ["call-to-war"];
  assert.deepEqual(
    [
      price(game, { id: "spear-camp", price: 4 }),
      price(game, { id: "archer-camp", price: 8 }),
      price(game, { id: "silver-mine", price: 4 }),
    ],
    [3, 7, 4],
  );
  game.blessings = ["call-to-peace"];
  assert.equal(price(game, { id: "brewery", price: 1 }), 1);
});

test("T16 Charms need a compatible structure before they can be offered", () => {
  const pool = fatePool(newGame(42, "stag"));
  for (const id of ["well-fed", "burning-blades", "protect-the-weak"] as const)
    assert.equal(pool.includes(id), false, id);
  for (const id of ["padded-armor", "flurry-of-blows"] as const)
    assert.equal(pool.includes(id), true, id);
  assert.equal(
    fatePool(polis([[30, "spear-camp"]])).includes("well-fed"),
    true,
  );
});

test("T17-T19 Charm stat deltas land on the target; a mismatch costs nothing; a new Charm replaces the old", () => {
  for (const [id, at, structure, sprite, stat, delta] of [
    ["well-fed", 30, "spear-camp", "hoplite", "health", 15],
    ["padded-armor", 30, "spear-camp", "hoplite", "armor", 25],
    ["protect-the-weak", 30, "healers-hut", "asclepiad", "ward", 1],
    ["flurry-of-blows", 30, "spear-camp", "hoplite", "crit", 10],
    ["burning-blades", 30, "spear-camp", "hoplite", "burn", 2],
    ["hephaestus-edge", 30, "spear-camp", "hoplite", "damage", 4],
    ["arrows-of-prometheus", 30, "archer-camp", "tracker", "burn", 4],
    ["artemis-power-shot", 30, "archer-camp", "tracker", "damage", 8],
  ] as const) {
    const game = polis([[at, structure]], {
      insight: 8,
      fate: [id, null, null],
    });
    const before = troops(game, sprite)[0]!;
    const after = troops(
      apply(game, { op: "fate", slot: 0, tile: tile(at) }),
      sprite,
    )[0]!;
    assert.equal(after[stat], before[stat] + delta, id);
  }
  const offers: Game["fate"] = ["protect-the-weak", "lost-wanderer", null];
  const mismatch = polis([[30, "spear-camp"]], { insight: 8, fate: offers });
  assert.throws(
    () => apply(mismatch, { op: "fate", slot: 0, tile: tile(30) }),
    /cannot target/,
  );
  const game = gameSession(
    polis([[30, "spear-camp", "well-fed"]], {
      insight: 4,
      fate: ["padded-armor", null, null],
    }),
    () => {},
    () => {},
  );
  assert.deepEqual(
    [
      troops(game.state, "hoplite")[0]?.health,
      troops(game.state, "hoplite")[0]?.armor,
    ],
    [60, 0],
  );
  game.act({ revision: 0, actions: [{ op: "fate", slot: 0, tile: tile(30) }] });
  assert.deepEqual(
    [
      troops(game.state, "hoplite")[0]?.health,
      troops(game.state, "hoplite")[0]?.armor,
      game.state.insight,
      game.state.placements[1]?.rune,
    ],
    [45, 25, 0, "padded-armor"],
  );
});

test("T20-T21 per-count Charms and Blessings and the Multiply fold", () => {
  // Five owned tiles, three placed: two empty colonized tiles.
  const small = newGame(42, "stag");
  small.placements.push(
    {
      tile: tile(30),
      id: "spear-camp",
      level: 1,
      workers: 1,
      rune: "guardians-of-the-frontier",
    },
    {
      tile: tile(38),
      id: "archer-camp",
      level: 1,
      workers: 1,
      rune: "hermes-pathfinders",
    },
  );
  assert.deepEqual(
    [troops(small, "hoplite")[0]?.health, troops(small, "tracker")[0]?.damage],
    [45 + 30, 3 + 6],
  );
  const wards = polis([
    [30, "spear-camp", "guardians-of-the-polis"],
    [38, "silver-mine"],
    [31, "silver-mine"],
  ]);
  assert.equal(troops(wards, "hoplite")[0]?.ward, 2);
  // Bond of the Phalanx: the Hall and a Spear Camp are Melee neighbours of the Healer's Hut.
  const bond = polis([
    [30, "healers-hut"],
    [38, "spear-camp"],
  ]);
  assert.equal(troops(bond, "asclepiad")[0]?.speed, 0.4000000059604645);
  bond.blessings = ["bond-of-the-phalanx"];
  assert.equal(troops(bond, "asclepiad")[0]?.speed, 0.48000001907348633);
  const mythic = polis([[30, "gigantes-camp"]]);
  const giant = troops(mythic, "cyclops")[0]!.health;
  mythic.placements[1]!.rune = "ambrosial-vitality";
  assert.equal(troops(mythic, "cyclops")[0]?.health, giant * 2);
  const chief = polis([]);
  assert.deepEqual(
    [warband(chief, "polis")[0]?.damage, warband(chief, "polis")[0]?.crit],
    [10, 0],
  );
  chief.placements[0]!.rune = "achilles-charge";
  assert.deepEqual(
    [warband(chief, "polis")[0]?.damage, warband(chief, "polis")[0]?.crit],
    [12.5, 20],
  );
  // Storm of Swords with no adjacent Warband: the Multiply aggregate stays f32(1).
  const lone = polis([[22, "spear-camp"]], { blessings: ["ares-swordstorm"] });
  assert.equal(troops(lone, "hoplite")[0]?.damage, 5);
});

function combat(polisUnit: Partial<Fighter>, opponentUnit: Partial<Fighter>) {
  const base: Fighter = {
    name: "Test",
    sprite: "hoplite",
    side: "polis",
    origin: null,
    x: -1,
    y: 0,
    health: 1000,
    armor: 0,
    damage: 1,
    damageStat: "attack",
    piercing: false,
    damageReduction: 0,
    speed: 1,
    windupPercent: 0,
    movement: 0,
    range: 0,
    regen: 0,
    criticalGrowth: 0,
    crit: 0,
    burn: 0,
    ward: 0,
  };
  return createCombat(
    battle.parse({
      seed: 7,
      kind: "training",
      opponent: "Test",
      fighters: [
        { ...base, ...polisUnit },
        { ...base, side: "opponent", x: 1, ...opponentUnit },
      ],
    }),
  );
}
// Advance until `unit` has received `hits` attacks (impact events).
function untilHits(
  sim: ReturnType<typeof createCombat>,
  unit: number,
  hits: number,
) {
  let seen = -1;
  let received = 0;
  while (received < hits && !sim.result) {
    sim.advance();
    for (const e of sim.events)
      if (e.id > seen) {
        seen = e.id;
        if (e.kind === "impact" && e.to === unit) received++;
      }
  }
  return received;
}

test("T22 battle-start Charms grant Ward, Crit and Burn at t=0; Crit and Burn end after 10 s", () => {
  const far = { x: 20, range: 0 };
  for (const [trigger, stat, value] of [
    [{ on: "battle-start", stat: "ward", value: 15, seconds: 10 }, "ward", 15],
    [
      { on: "battle-start", stat: "crit", value: 100, seconds: 10 },
      "crit",
      100,
    ],
    [{ on: "battle-start", stat: "burn", value: 20, seconds: 10 }, "burn", 20],
  ] as const) {
    const sim = combat({ triggers: [trigger] }, far);
    assert.equal(sim.units[0]?.[stat], value);
    for (let i = 0; i < 199; i++) sim.advance();
    assert.equal(sim.units[0]?.[stat], value);
    sim.advance();
    assert.equal(sim.units[0]?.[stat], 0);
  }
  assert.deepEqual(
    (["gleaming-aegis", "artemis-true-aim", "bolt-of-zeus"] as const).map(
      (id) => fates[id].triggers,
    ),
    [
      [{ on: "battle-start", stat: "ward", value: 15, seconds: 10 }],
      [{ on: "battle-start", stat: "crit", value: 100, seconds: 10 }],
      [{ on: "battle-start", stat: "burn", value: 20, seconds: 10 }],
    ],
  );
});

test("T23 struck, critical and health-threshold Charms", () => {
  const attacker = { range: 5 };
  const struck = combat(
    { triggers: [...fates["blood-of-ares"].triggers!] },
    attacker,
  );
  assert.equal(untilHits(struck, 0, 3), 3);
  assert.equal(struck.units[0]?.damage, 10);
  const plated = combat(
    { triggers: [...fates["heracles-resolve"].triggers!] },
    attacker,
  );
  untilHits(plated, 0, 3);
  assert.deepEqual(
    [plated.units[0]?.armor, plated.units[0]?.maximumArmor],
    [0, 30],
  );
  assert.deepEqual(
    plated.events
      .filter((event) => event.kind === "impact")
      .filter((event) => event.to === 0)
      .map((event) => [event.armorDamage, eventSounds(event)]),
    [
      [0, ["spear"]],
      [0, ["spear"]],
      [0, ["spear"]],
    ],
  );
  const critic = combat(
    { range: 5, crit: 100, triggers: [...fates["achilles-opening"].triggers!] },
    { health: 10_000 },
  );
  untilHits(critic, 1, 3);
  assert.equal(critic.units[0]?.damage, 13);
  const wind = combat(
    { triggers: [...fates["asclepius-second-wind"].triggers!] },
    { range: 5, damage: 300 },
  );
  untilHits(wind, 0, 2);
  assert.deepEqual([wind.units[0]?.health, wind.units[0]?.ward], [400, 0]);
  wind.advance();
  assert.equal(wind.units[0]?.ward, 3);
  // Hits 3-5 spend the three charges; hit 6 lands and the threshold never fires again.
  untilHits(wind, 0, 6);
  assert.deepEqual([wind.units[0]?.health, wind.units[0]?.ward], [100, 0]);
});

for (const vector of [
  {
    name: "no Armor",
    armor: 0,
    damage: 1,
    ward: 0,
    piercing: false,
    health: 999,
    remaining: 0,
    absorbed: 0,
    dealt: 1,
    sounds: ["spear"],
  },
  {
    name: "Armor absorbs the hit",
    armor: 12,
    damage: 1,
    ward: 0,
    piercing: false,
    health: 1000,
    remaining: 11,
    absorbed: 1,
    dealt: 1,
    sounds: ["spear", "armor"],
  },
  {
    name: "Ward blocks the hit",
    armor: 12,
    damage: 1,
    ward: 1,
    piercing: false,
    health: 1000,
    remaining: 12,
    absorbed: 0,
    dealt: 0,
    sounds: ["ward"],
  },
  {
    name: "Armor spills into Health",
    armor: 4,
    damage: 10,
    ward: 0,
    piercing: false,
    health: 994,
    remaining: 0,
    absorbed: 4,
    dealt: 10,
    sounds: ["spear", "armor"],
  },
  {
    name: "piercing bypasses Armor",
    armor: 4,
    damage: 10,
    ward: 0,
    piercing: true,
    health: 990,
    remaining: 4,
    absorbed: 0,
    dealt: 10,
    sounds: ["spear"],
  },
]) {
  test(`T23 Armor impact contract: ${vector.name}`, () => {
    const sim = combat(
      {
        armor: vector.armor,
        ward: vector.ward,
        triggers: [...fates["heracles-resolve"].triggers!],
      },
      { range: 5, damage: vector.damage, piercing: vector.piercing },
    );
    untilHits(sim, 0, 1);
    const impact = sim.events.find(
      (event) => event.kind === "impact" && event.to === 0,
    );
    assert.ok(impact?.kind === "impact");
    assert.deepEqual(
      [
        impact.damage,
        impact.armorDamage,
        impact.blocked,
        sim.units[0]?.health,
        sim.units[0]?.armor,
        sim.units[0]?.ward,
      ],
      [
        vector.dealt,
        vector.absorbed,
        vector.ward > 0,
        vector.health,
        vector.remaining,
        0,
      ],
    );
    assert.deepEqual(eventSounds(impact), vector.sounds);
  });
}

test("T24 spells upgrade one matching structure, cannot target the Hall and stay repeatable", () => {
  const game = polis([[30, "silver-mine"]], {
    insight: 8,
    favor: { zeus: 0, athena: 0, apollo: 3 },
    fate: ["rite-of-hestia", "warriors-ascension", null],
  });
  assert.throws(
    () => apply(game, { op: "fate", slot: 0, tile: tile(37) }),
    /cannot target/,
  );
  assert.throws(
    () => apply(game, { op: "fate", slot: 1, tile: tile(37) }),
    /cannot target/,
  );
  const upgraded = apply(game, { op: "fate", slot: 0, tile: tile(30) });
  assert.deepEqual([upgraded.placements[1]?.level, upgraded.insight], [2, 0]);
  assert.equal(fatePool(upgraded).includes("rite-of-hestia"), true);
  upgraded.placements[1]!.level = 3;
  assert.equal(fatePool(upgraded).includes("rite-of-hestia"), false);
});

test("T25-T26 round growth, ordinary income and deferred Memory excluded from its forecast", () => {
  const claim = (game: Game, rounds: number) => {
    const session = gameSession(
      game,
      () => {},
      () => {},
    );
    for (let i = 0; i < rounds; i++) {
      session.act({
        revision: session.state.revision,
        actions: [{ op: "ready" }, { op: "continue" }],
      });
      finishIncome(session);
    }
    return session.state;
  };
  const chief = (game: Game) => {
    const unit = warband(game, "polis")[0]!;
    return [unit.damage, unit.health];
  };
  for (const rounds of [1, 2]) {
    const plain = chief(claim(polis([]), rounds));
    const grown = chief(
      claim(polis([], { blessings: ["growing-might-of-heracles"] }), rounds),
    );
    assert.deepEqual(
      [grown[0]! - plain[0]!, grown[1]! - plain[1]!],
      [5 * rounds, 15 * rounds],
    );
  }
  const plain = claim(polis([], { insight: 12 }), 1).insight;
  const secrets = claim(
    polis([], { insight: 12, blessings: ["secrets-of-the-oracle"] }),
    1,
  ).insight;
  assert.equal(secrets - plain, 3);
  const mines: [number, BuildingId][] = [
    [38, "silver-mine"],
    [31, "silver-mine"],
    [29, "silver-mine"],
  ];
  const memory = roundIncome(
    polis([[30, "watchtower", "memory-of-the-polis"], ...mines]),
  );
  const tower = roundIncome(polis([[30, "watchtower"], ...mines]));
  assert.deepEqual(
    [memory.insight - tower.insight, memory.drachmas - tower.drachmas],
    [0, 0],
    "Memory direct-wallet callbacks are deferred and not implemented as ordinary income",
  );
  const wealth = income(polis([[30, "watchtower", "wisdom-into-wealth"]]));
  assert.deepEqual(wealth, [12, 5]);
  assert.deepEqual(income(polis([[30, "watchtower"]])), [11, 6]);
});

test("T27 War Lessons pays during battle settlement and is not paid again on Continue", () => {
  const start = newGame(42, "stag", "async", () => 0);
  // This authored weak-raider fixture exercises an ordinary PvP authority callback.
  start.round = 2;
  start.placements.push({
    tile: tile(30),
    id: "spear-camp",
    level: 1,
    workers: 2,
    rune: "athenas-war-lessons",
  });
  const game = gameSession(
    start,
    () => {},
    () => {},
    {
      offerIndex: () => 0,
      encounter: (current) => ({
        seed: 1,
        kind: "pvp",
        opponentLayout: settlement(current),
        opponent: "Three weak raiders",
        fighters: [
          ...warband(current, "polis").map((u) =>
            u.killInsight
              ? { ...u, attackStat: undefined, damage: 1000, range: 20 }
              : { ...u, attackStat: undefined, damage: 0 },
          ),
          ...warband(current, "opponent").map((u) => ({
            ...u,
            health: 1,
            armor: 0,
            damage: 0,
            attackStat: undefined,
            armorStat: undefined,
          })),
        ],
      }),
    },
  );
  const openingInsight = game.state.insight;
  game.act({ revision: 0, actions: [{ op: "ready" }] });
  const result = game.state.phase;
  assert.equal(result.kind === "result" && result.outcome.insight, 3);
  assert.equal(game.state.insight, openingInsight + 3);
  const before = game.state.insight;
  const earned = roundIncome(game.state).insight;
  game.act({ revision: 1, actions: [{ op: "continue" }] });
  finishIncome(game);
  assert.equal(game.state.insight, before + earned);
  const outcome = resolveBattle(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "No reward",
      fighters: [
        {
          ...warband(start, "polis")[1]!,
          killInsight: undefined,
          range: 20,
          damage: 1000,
          attackStat: undefined,
          origin: null,
        },
        { ...warband(start, "opponent")[0]!, health: 1, origin: null },
      ],
    }),
  );
  assert.equal(outcome.insight, undefined);
});

test("T28 the catalog exposes all 94 entries with status and unknowns, 16 ids per call", () => {
  const summary = catalogTool.execute({}) as {
    fate: [string, string, string, number, string][];
    fateEconomy: { rerollLadder: readonly number[] };
  };
  assert.equal(summary.fate.length, 94);
  assert.deepEqual(
    ["exact", "partial"].map(
      (status) => summary.fate.filter((row) => row[4] === status).length,
    ),
    [94, 0],
  );
  assert.deepEqual(summary.fate[0], [
    "call-to-peace",
    "Concord of Hestia",
    "blessing",
    4,
    "exact",
  ]);
  assert.deepEqual(summary.fateEconomy.rerollLadder, [1, 2, 4, 8, 16, 32, 64]);
  const detail = catalogTool.execute({
    ids: fateId.options.slice(0, 16),
  }) as Record<string, Record<string, unknown>>;
  assert.equal(Object.keys(detail).length, 16);
  assert.ok(Object.values(detail).every((d) => !("art" in d)));
  assert.throws(() =>
    catalogTool.execute({ ids: fateId.options.slice(0, 17) }),
  );
  const closed = catalogTool.execute({
    ids: ["achilles-charge", "fury-of-the-titans"],
  }) as Record<string, { status: string; unknown: string[] }>;
  for (const id of ["achilles-charge", "fury-of-the-titans"])
    assert.deepEqual(closed[id] && [closed[id].status, closed[id].unknown], [
      "exact",
      [],
    ]);
});

test("T29 every entry has its 96 px icon and no orphan icon remains", () => {
  const icons = readdirSync(new URL("../public/art/fates/", import.meta.url))
    .filter((name) => name.endsWith(".webp"))
    .map((name) => name.slice(0, -5))
    .sort();
  assert.deepEqual(icons, [...fateId.options].sort());
  assert.ok(
    fateId.options.every((id) => fates[id].art === `/art/fates/${id}.webp`),
  );
});

test("T31 offers stay hidden behind the authoritative selector, sized by the eligible pool", () => {
  const bounds: number[] = [];
  const game = newGame(42, "stag", "async", (context, upperBound) => {
    if (context.kind === "fate") bounds.push(upperBound);
    return 2;
  });
  // Index 2 is Ruins of Delphi; a second Drachma gift may not join it on screen.
  assert.deepEqual(bounds, [12, 11, 11]);
  assert.deepEqual(game.fate, [
    "ruins-of-delphi",
    "lost-wanderer",
    "lost-wanderer",
  ]);
  assert.equal(fatePool(game).length, 12);
  const visible = inspection(game);
  for (const hidden of ["seed", "fateRolls", "shopRolls"])
    assert.equal(hidden in visible, false, hidden);
  assert.deepEqual(visible.fate, game.fate);
});

test("T32 the 39 video-inspected cards match price, favor emblems and their scalars", () => {
  const offers = JSON.parse(
    readFileSync(
      new URL("../test-fixtures/fate-offers.json", import.meta.url),
      "utf8",
    ),
  ) as {
    cards: {
      id: string;
      observedLorePrice: number | null;
      displayedGodEmblems: Record<string, number> | null;
      effect: Record<string, number | boolean>;
    }[];
  };
  const ids: Record<string, FateId> = {
    "lost-wanderer": "lost-wanderer",
    "call-to-peace": "call-to-peace",
    "burning-blades": "burning-blades",
    "call-to-learn": "call-to-learning",
    "flurry-of-blows": "flurry-of-blows",
    "protect-the-weak": "protect-the-weak",
    "padded-armor": "padded-armor",
    "call-to-war": "call-to-war",
    "well-fed": "well-fed",
    "beseech-odin": "beseech-athena",
    guardians: "guardians-of-the-frontier",
    "prepare-to-learn": "rite-of-athena",
    "lost-ruins": "ruins-of-delphi",
    "read-the-runes": "read-the-oracle",
    pathfinders: "hermes-pathfinders",
    "bloodied-might": "blood-of-ares",
    "heavy-plate": "bronze-of-hephaestus",
    "spiked-skin": "echidnas-hide",
    "defensive-strategy": "apollos-sentinels",
    "work-together": "bond-of-the-phalanx",
    "good-business": "hermes-fair-trade",
    "mind-shield": "aegis-of-thought",
    "growing-toughness": "growing-might-of-heracles",
    "beseech-thor": "beseech-zeus",
    "flaming-arrows": "arrows-of-prometheus",
    "beseech-baldr": "beseech-apollo",
    "gleaming-aegis": "gleaming-aegis",
    "shield-wall": "athenas-shield-wall",
    "prepare-for-peace": "rite-of-hestia",
    "follow-them": "in-the-heros-wake",
    "mythic-fury": "fury-of-the-titans",
    "eagle-eyes": "eyes-of-the-eagle",
    "roll-with-the-punches": "heracles-resolve",
    "pray-to-odin": "pray-to-athena",
    sentinels: "the-sacred-guard",
    "second-wind": "asclepius-second-wind",
    "protect-the-people": "guardians-of-the-polis",
    "offensive-strategy": "zeus-war-council",
    "well-trained": "spartan-discipline",
  };
  const patrons = { Thor: "zeus", Odin: "athena", Baldr: "apollo" } as const;
  const checked = offers.cards.filter((card) => card.id !== "wide-swings");
  assert.equal(checked.length, 39);
  for (const card of checked) {
    const fate = fates[ids[card.id]!];
    if (card.observedLorePrice !== null)
      assert.equal(fate.cost, card.observedLorePrice, card.id);
    if (card.displayedGodEmblems)
      assert.deepEqual(
        count(fate.favor),
        Object.fromEntries(
          Object.entries(card.displayedGodEmblems).map(([god, n]) => [
            patrons[god as keyof typeof patrons],
            n,
          ]),
        ),
        card.id,
      );
    const known = [
      ...fate.serialized.map(([, , v]) => Math.abs(v)),
      fate.drachmas,
      fate.villagers,
      fate.favor.length,
    ];
    for (const [key, value] of Object.entries(card.effect)) {
      if (typeof value !== "number") continue;
      if (key === "offerLikelihoodMultiplier") assert.ok(fate.appearance);
      else if (key === "upgrade") assert.equal(fate.upgrade, true);
      else if (card.id === "flurry-of-blows")
        // 0.77.100d showed +0.2 action speed; 0.77.111d serializes +10 Crit Chance (bound).
        assert.deepEqual(fate.serialized, [["CritChance", "Add", 10]]);
      else
        assert.ok(
          known.some((k) => k === value || k === Math.fround(value / 100)),
          `${card.id} ${key}`,
        );
    }
  }
});

test("every bound effect number is a serialized scalar of its card", () => {
  for (const id of fateId.options) {
    const f = fates[id];
    const serialized = f.serialized.map(([, , v]) => Math.abs(v));
    const bound = [
      ...(f.effects ?? []).map((e) => Math.abs(e.value[0])),
      ...(f.triggers ?? []).flatMap((t) => [
        t.value,
        t.seconds,
        ...(t.on === "health-below" ? [t.below] : []),
      ]),
      ...(f.growth ? [f.growth.damage, f.growth.health] : []),
      ...(f.storedInsight ? [f.storedInsight] : []),
      ...(f.killInsight ? [f.killInsight] : []),
      ...(f.discount ? [f.discount] : []),
    ];
    for (const value of bound)
      assert.ok(
        serialized.includes(value) || serialized.includes(Math.fround(value)),
        `${id} ${value}`,
      );
  }
});
