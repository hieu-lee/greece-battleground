import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { fates } from "./rules.ts";

const base = {
  name: "Source modifier lifecycle",
  sprite: "hoplite",
  side: "polis",
  x: 0,
  y: 0,
  health: 1000,
  armor: 12,
  damage: 0,
  speed: 0.1,
  windupPercent: 100,
  movement: 0,
  range: 0,
  crit: 0,
  burn: 0,
  ward: 0,
};
function simulate(fighters: Record<string, unknown>[]) {
  return createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "Source modifier lifecycle",
      fighters: fighters.map((unit) => ({ ...base, ...unit })),
    }),
  );
}
function advance(combat: ReturnType<typeof createCombat>, until: number) {
  while (combat.ticks < until && !combat.result) combat.advance();
}

test("Heracles Resolve raises maximum Armor without refilling the depleted pool", () => {
  const combat = createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "Source Armor callback",
      fighters: [
        { ...base, triggers: fates["heracles-resolve"].triggers },
        {
          ...base,
          side: "opponent",
          x: 1,
          armor: 0,
          damage: 5,
          speed: 10,
          windupPercent: 0,
          range: 20,
        },
      ],
    }),
  );
  const observed = [];
  let hits = 0;
  while (hits < 3 && combat.ticks < 30 && !combat.result) {
    combat.advance();
    const count = combat.events.filter(
      (event) => event.kind === "impact" && event.to === 0,
    ).length;
    if (count === hits) continue;
    const unit = combat.units[0];
    assert.ok(unit);
    observed.push({
      health: unit.health,
      armor: unit.armor,
      maximumArmor: unit.maximumArmor,
    });
    hits = count;
  }
  assert.deepEqual(observed, [
    { health: 1000, armor: 7, maximumArmor: 22 },
    { health: 1000, armor: 2, maximumArmor: 32 },
    { health: 997, armor: 0, maximumArmor: 42 },
  ]);
});

test("triggered damage joins the source Add group before Multiply, including a zero aggregate", () => {
  // These disclosed scalar fixtures isolate FloatStat composition; they do not
  // claim that Blood and a second damage Charm can share an ordinary structure.
  for (const [multiply, initial, expected] of [
    [1.25, 12.5, 16.25],
    [0, 10, 13],
  ]) {
    const combat = simulate([
      {
        armor: 0,
        damage: initial,
        attackStat: { base: 10, add: 0, subtract: 0, multiply },
        triggers: fates["blood-of-ares"].triggers,
      },
      {
        side: "opponent",
        x: 1,
        armor: 0,
        damage: 5,
        windupPercent: 0,
        range: 20,
      },
    ]);
    advance(combat, 2);
    assert.deepEqual(
      [combat.units[0]?.health, combat.units[0]?.damage],
      [995, expected],
    );
  }
});

test("Achilles Opening stacks an Add operand even on a blocked critical callback", () => {
  const combat = simulate([
    {
      armor: 0,
      damage: 12.5,
      attackStat: { base: 10, add: 0, subtract: 0, multiply: 1.25 },
      crit: 100,
      speed: 10,
      windupPercent: 0,
      range: 20,
      triggers: fates["achilles-opening"].triggers,
    },
    { side: "opponent", x: 1, armor: 0, ward: 1 },
  ]);
  advance(combat, 2);
  assert.deepEqual(
    [combat.units[0]?.damage, combat.units[1]?.health, combat.units[1]?.ward],
    [17.5, 1000, 0],
  );
  advance(combat, 5);
  assert.deepEqual(
    [combat.units[0]?.damage, combat.units[1]?.health],
    [22.5, 965],
  );
});

for (const [id, expectedDamage, expectedArmor] of [
  ["blood-of-ares", 9, 0],
  ["heracles-resolve", 0, 30],
] as const) {
  test(`${id} retains earlier grants through the lethal hit and revival`, () => {
    const combat = simulate([
      {
        health: 3,
        armor: 0,
        revive: 1,
        triggers: fates[id].triggers,
      },
      {
        side: "opponent",
        x: 1,
        damage: 1,
        damageStat: "poison",
        piercing: true,
        speed: 10,
        windupPercent: 0,
        range: 20,
      },
    ]);
    while (combat.units[0]?.life.kind === "alive" && combat.ticks < 30)
      combat.advance();
    const recipient = combat.units[0];
    assert.ok(recipient);
    assert.equal(recipient.life.kind, "reviving");
    assert.deepEqual(
      [recipient.health, recipient.damage, recipient.maximumArmor],
      [0, expectedDamage, expectedArmor],
    );
    const restoreAt = combat.ticks + 60;
    advance(combat, restoreAt);
    assert.deepEqual(
      [
        recipient.life.kind,
        recipient.health,
        recipient.armor,
        recipient.damage,
      ],
      ["alive", 3, expectedArmor, expectedDamage],
    );
  });
}

test("the Raven's critical grants use the same holder lifetime through revival", () => {
  const combat = simulate([
    {
      health: 3,
      armor: 0,
      damage: 1,
      crit: 100,
      criticalGrowth: 2,
      revive: 1,
      speed: 10,
      windupPercent: 0,
      range: 20,
    },
    {
      side: "opponent",
      x: 1,
      armor: 0,
      damage: 1,
      speed: 10,
      windupPercent: 0,
      range: 20,
    },
  ]);
  while (combat.units[0]?.life.kind === "alive" && combat.ticks < 30)
    combat.advance();
  assert.deepEqual(
    [combat.units[0]?.life.kind, combat.units[0]?.damage],
    ["reviving", 7],
  );
  advance(combat, combat.ticks + 60);
  assert.deepEqual(
    [combat.units[0]?.life.kind, combat.units[0]?.damage],
    ["alive", 7],
  );
});

test("Second Wind polls after damage and can trigger while its recipient is reviving", () => {
  for (const [health, damage, life] of [
    [100, 60, "alive"],
    [1, 1, "reviving"],
  ] as const) {
    const combat = simulate([
      {
        health,
        armor: 0,
        revive: 1,
        triggers: fates["asclepius-second-wind"].triggers,
      },
      {
        side: "opponent",
        x: 1,
        damage,
        speed: 0.1,
        windupPercent: 0,
        range: 20,
      },
    ]);
    advance(combat, 2);
    assert.deepEqual(
      [combat.units[0]?.life.kind, combat.units[0]?.ward],
      [life, 0],
    );
    advance(combat, 3);
    assert.deepEqual(
      [combat.units[0]?.ward, combat.units[0]?.thresholdFired],
      [3, true],
    );
  }
});

test("Vitalic Rush grants target Haste on a completed zero heal", () => {
  const combat = simulate([
    {
      x: -5,
      armor: 0,
      healing: 30,
      crit: 100,
      speed: 1,
      windupPercent: 0,
      range: 12,
    },
    {
      x: -4,
      armor: 0,
      healing: 30,
      crit: 100,
      speed: 0.4,
      windupPercent: 30,
      range: 12,
      triggers: fates["asclepius-surge"].triggers,
    },
    { x: -1, health: 100, armor: 0, speed: 0.01, range: 20 },
    {
      side: "opponent",
      x: 1,
      damage: 20,
      armor: 0,
      speed: 0.01,
      windupPercent: 0,
      range: 20,
    },
  ]);
  advance(combat, 4);
  assert.deepEqual(
    [combat.units[2]?.health, combat.units[2]?.hasted],
    [100, 0],
  );
  advance(combat, 18);
  assert.deepEqual(
    combat.events.flatMap((event) =>
      event.kind === "heal" ? [[event.tick, event.amount]] : [],
    ),
    [[4, 20]],
  );
  assert.deepEqual(
    [combat.units[1]?.target, combat.units[2]?.hasted, combat.units[2]?.speed],
    [2, 1, Math.fround(0.02)],
  );
  assert.equal(combat.units[1]?.hasted, 0);
  assert.deepEqual(
    combat.events.flatMap((event) =>
      event.kind === "haste" ? [[event.tick, event.unit, event.amount]] : [],
    ),
    [[18, 2, 1]],
  );
  advance(combat, 38);
  assert.deepEqual(
    [combat.units[2]?.hasted, combat.units[2]?.speed],
    [0, Math.fround(0.01)],
  );
});

test("Vitalic Rush reflection uses its controller's current ally, not the reflected recipient", () => {
  const combat = simulate([
    {
      armor: 0,
      healing: 10,
      thorn: 2,
      triggers: fates["asclepius-surge"].triggers,
      range: 20,
    },
    { x: -3, armor: 0, speed: 0.01 },
    {
      side: "opponent",
      x: 1,
      armor: 0,
      damage: 1,
      speed: 0.1,
      windupPercent: 0,
      range: 20,
    },
  ]);
  advance(combat, 2);
  assert.deepEqual(
    [combat.units[0]?.target, combat.units[2]?.health],
    [1, 998],
  );
  assert.deepEqual(
    combat.units.map((unit) => unit.hasted),
    [0, 1, 0],
  );
  assert.deepEqual(
    combat.events.flatMap((event) =>
      event.kind === "haste" ? [[event.tick, event.unit, event.amount]] : [],
    ),
    [[2, 1, 1]],
  );
});
