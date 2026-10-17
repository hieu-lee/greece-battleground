import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat, fighter } from "./combat.ts";
import type { Battle, Fighter } from "./combat.ts";
import { freshRun } from "./run-storage.ts";
import { seasonForRound } from "./rules-version.ts";
import { practiceMatch, warband } from "./warband.ts";

// Literal original25904130 rosters, not the synthetic practice difficulty curve.
const rosters = [
  { round: 2, sprites: { atalanta: 1, peltast: 2 } },
  { round: 3, sprites: { lykaon: 1, "thracian-raider": 2 } },
  { round: 4, sprites: { aegeus: 1, rhapsode: 1, hypaspist: 2 } },
  { round: 6, sprites: { atalanta: 1, hypaspist: 2, peltast: 3 } },
  { round: 7, sprites: { lykaon: 1, hoplite: 6, "thracian-raider": 3 } },
  { round: 8, sprites: { aegeus: 1, asclepiad: 2, rhapsode: 1, hypaspist: 6 } },
  { round: 10, sprites: { atalanta: 1, peltast: 6, hypaspist: 3 } },
  {
    round: 11,
    sprites: {
      lykaon: 1,
      "arcadian-wolf": 2,
      "thracian-raider": 3,
      hoplite: 6,
    },
  },
  {
    round: 12,
    sprites: { aegeus: 1, asclepiad: 3, rhapsode: 2, hypaspist: 6 },
  },
  { round: 14, sprites: { atalanta: 1, peltast: 6, hypaspist: 3, tracker: 3 } },
  {
    round: 15,
    sprites: {
      lykaon: 1,
      "arcadian-wolf": 4,
      "thracian-raider": 3,
      hoplite: 6,
      cyclops: 1,
    },
  },
  {
    round: 16,
    sprites: {
      aegeus: 1,
      asclepiad: 3,
      rhapsode: 2,
      hypaspist: 6,
      "battle-physician": 1,
    },
  },
  {
    round: 17,
    sprites: { atalanta: 1, peltast: 6, hypaspist: 3, tracker: 3, erinys: 2 },
  },
  {
    round: 18,
    sprites: {
      lykaon: 1,
      "arcadian-wolf": 6,
      "thracian-raider": 3,
      hoplite: 6,
      cyclops: 1,
    },
  },
];

function tutorial(round: number, clan: "stag" | "raven" = "stag") {
  const game = freshRun(clan, "tutorial");
  // Trusted provider fixtures: chapter progression is owned by the campaign layer.
  game.round = round;
  game.season = seasonForRound(round);
  return game;
}
function encounter(round: number) {
  return battle.parse(
    JSON.parse(JSON.stringify(practiceMatch(tutorial(round)))),
  );
}
function opponents(input: Battle) {
  return input.fighters.filter((unit) => unit.side === "opponent");
}
function actor(input: Battle, sprite: string) {
  const unit = opponents(input).find(
    (candidate) => String(candidate.sprite) === sprite,
  );
  assert.ok(unit, `source NPC must deploy ${sprite}`);
  return unit;
}
function counts(units: Fighter[]) {
  const result: Record<string, number> = {};
  for (const unit of units)
    result[unit.sprite] = (result[unit.sprite] ?? 0) + 1;
  return result;
}

test("all fourteen tutorial ordinary rounds deploy literal source actor families through strict battle JSON", () => {
  const observed = rosters.map(({ round }) => {
    const input = encounter(round);
    assert.equal(input.kind, "training");
    return { round, sprites: counts(opponents(input)) };
  });
  assert.deepEqual(observed, rosters);
});

test("tutorial NPC chiefs, original troops and Cyclops preserve source scalar recipes and windups", () => {
  const cases = [
    [2, "atalanta", 250, 0, 8, 0.8999999761581421, 15],
    [2, "peltast", 25, 0, 8, 0.4000000059604645, 30],
    [3, "lykaon", 210, 0, 15, 0.6499999761581421, 0],
    [3, "thracian-raider", 55, 0, 4, 0.699999988079071, 30],
    [4, "aegeus", 240, 60, 10, 0.6499999761581421, 15],
    [8, "hypaspist", 85, 140, 10, 0.4000000059604645, 32],
    [14, "atalanta", 275, 60, 8, 0.9449999332427979, 15],
    [14, "tracker", 45, 0, 8, 0.6299999952316284, 50],
    [15, "cyclops", 630, 0, 10, 0.5, 18],
    [16, "aegeus", 315, 100, 10, 0.6499999761581421, 15],
    [16, "battle-physician", 60, 0, 0, 0.699999988079071, 50],
    [17, "erinys", 575, 100, 30, 0.699999988079071, 30],
    [18, "cyclops", 1260, 0, 20, 0.5, 18],
    [18, "lykaon", 210, 0, 15, 0.8449999094009399, 0],
  ] as const;
  const observed = cases.map(([round, sprite]) => {
    const unit = actor(encounter(round), sprite);
    return [
      round,
      sprite,
      unit.health,
      unit.armor,
      unit.damage,
      unit.speed,
      unit.windupPercent,
    ];
  });
  assert.deepEqual(observed, cases);
  const raven = actor(encounter(14), "atalanta");
  const thrower = actor(encounter(14), "peltast");
  assert.deepEqual(
    [
      raven.armorStat?.base,
      raven.armorStat?.add,
      thrower.attackStat?.base,
      thrower.attackStat?.add,
    ],
    [0, 60, 24, 11],
    "serialized FloatStats retain their original base and granted Add operands",
  );
});

test("corrected empty-neighbour healers deploy Healing28,28,30 without invented revival charges", () => {
  const observed = [8, 12, 16].map((round) => {
    const input = encounter(round);
    const healers = opponents(input).filter((unit) => (unit.healing ?? 0) > 0);
    assert.ok(opponents(input).every((unit) => (unit.revive ?? 0) === 0));
    return [round, healers.map((unit) => [unit.sprite, unit.healing])];
  });
  assert.deepEqual(observed, [
    [
      8,
      [
        ["asclepiad", 28],
        ["asclepiad", 28],
        ["rhapsode", 15],
      ],
    ],
    [
      12,
      [
        ["asclepiad", 28],
        ["asclepiad", 28],
        ["asclepiad", 28],
        ["rhapsode", 45],
        ["rhapsode", 45],
      ],
    ],
    [
      16,
      [
        ["asclepiad", 30],
        ["asclepiad", 30],
        ["asclepiad", 30],
        ["rhapsode", 45],
        ["rhapsode", 45],
        ["battle-physician", 15],
      ],
    ],
  ]);
});

test("only the two authored tower boards carry literal source static controllers", () => {
  const observed = rosters.flatMap(({ round }) =>
    (encounter(round).towers ?? [])
      .filter((tower) => tower.side === "opponent")
      .map((tower) => [
        round,
        tower.item,
        tower.speed,
        tower.count,
        tower.damage,
        tower.burn,
        tower.poison,
        tower.frost,
      ]),
  );
  assert.deepEqual(observed, [
    [12, "defense-tower", 0.5, 2, 5, 0, 0, 0],
    [16, "defense-tower", 0.5, 4, 26, 0, 0, 0],
  ]);
});

test("the two authored Horn boards target actual source producer origins with effective cadence and duration", () => {
  const observed = rosters.flatMap(({ round }) => {
    const input = encounter(round);
    return (input.horns ?? [])
      .filter((horn) => horn.side === "opponent")
      .map((horn) => [
        round,
        horn.speed,
        horn.duration,
        new Set(horn.targets).size,
        opponents(input).filter(
          (unit) => unit.origin && horn.targets.includes(unit.origin.tile),
        ).length,
      ]);
  });
  assert.deepEqual(observed, [
    [14, 0.13750000298023224, 1, 5, 13],
    [17, 0.15000000596046448, 2, 6, 15],
  ]);
});

test("the actual tutorial Horn adds Haste to the original source APS recipe rather than doubling the flattened value", () => {
  const input = encounter(14);
  const chief = actor(input, "atalanta");
  assert.deepEqual(chief.speedStat, {
    basis: 0.8999999761581421,
    multiply: 1.0499999523162842,
  });
  const combat = createCombat(
    battle.parse({
      ...input,
      fighters: input.fighters.map((unit) => ({
        ...unit,
        health: 100000,
        damage: 0,
        attackStat: { base: 0, add: 0, subtract: 0, multiply: 1 },
        movement: 0,
        range: 0,
        x: unit.side === "polis" ? -20 : 20,
        y: 0,
      })),
    }),
  );
  while (
    !combat.events.some((event) => event.kind === "haste") &&
    combat.ticks < 180 &&
    !combat.result
  )
    combat.advance();
  const affected = combat.units.find(
    (unit) => unit.side === "opponent" && String(unit.sprite) === "atalanta",
  );
  assert.ok(affected);
  assert.ok(affected.hasted > 0, "authored NPC Horn must actually activate");
  assert.equal(affected.speed, 1.84499990940094);
});

test("NPC recipes ignore player clan skills, chief history and powers while the player keeps its normal warband", () => {
  const baseline = encounter(16);
  const game = tutorial(16, "raven");
  game.skills = [3, 3, 3];
  game.chiefBattles = 12;
  game.chiefGrowth = { health: 300, damage: 70 };
  game.blessings = [
    "growing-might-of-heracles",
    "athenas-might",
    "wrath-of-the-titans",
  ];
  const input = battle.parse(JSON.parse(JSON.stringify(practiceMatch(game))));
  assert.deepEqual(opponents(input), opponents(baseline));
  const own = input.fighters.filter((unit) => unit.side === "polis");
  assert.deepEqual(
    own,
    warband(game, "polis").map((unit) => fighter.parse(unit)),
  );
  assert.notDeepEqual(
    own,
    baseline.fighters.filter((unit) => unit.side === "polis"),
  );
});

test("ordinary tutorial round19 rejects an exhausted literal opponent array instead of inventing or repeating a wave", () => {
  assert.throws(() => practiceMatch(tutorial(19)));
});
