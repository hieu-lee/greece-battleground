import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import type { Fighter } from "./combat.ts";

const stationary = {
  name: "Controlled projectile geometry",
  sprite: "hoplite",
  side: "opponent",
  x: 6,
  y: 0,
  health: 1000,
  armor: 0,
  damage: 0,
  speed: 0.1,
  windupPercent: 100,
  movement: 0,
  range: 0,
  crit: 0,
  burn: 0,
  ward: 0,
};
function fight(
  source: Partial<Fighter> = {},
  targets: Partial<Fighter>[] = [{}],
  allies: Partial<Fighter>[] = [],
) {
  return createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "Source projectile flight contract",
      fighters: [
        {
          ...stationary,
          sprite: "drakon",
          side: "polis",
          x: 0,
          damage: 12,
          speed: 1,
          windupPercent: 0,
          range: 20,
          ...source,
        },
        ...targets.map((target) => ({ ...stationary, ...target })),
        ...allies.map((ally) => ({
          ...stationary,
          side: "polis",
          x: -10,
          ...ally,
        })),
      ],
    }),
  );
}
function through(combat: ReturnType<typeof fight>, tick: number) {
  while (combat.ticks < tick && !combat.result) combat.advance();
}
function primaryHits(combat: ReturnType<typeof fight>) {
  return combat.events.filter(
    (event) => event.kind === "impact" && event.from === 0 && event.to === 1,
  );
}

// Existing50ms arena projection:6 arena units =12 source units at speed15.
// Windup0 is a controlled valid input; its existing50ms minimum releases at tick2.
for (const sprite of ["tracker", "peltast", "drakon"] as const)
  test(`${sprite} releases after windup but health waits for its separately tracked flight`, () => {
    const combat = fight({ sprite });
    through(combat, 17);
    assert.deepEqual(
      primaryHits(combat),
      [],
      "no health/status callback at release or during flight",
    );
    assert.equal(combat.units[1]?.health, 1000);
    through(combat, 18);
    assert.deepEqual(
      primaryHits(combat).map((hit) => hit.tick),
      [18],
    );
    assert.equal(combat.units[1]?.health, 988);
  });

test("a released shot preserves critical, damage and Fire operands after finite source buffs expire", () => {
  const combat = fight({
    burn: 2,
    triggers: [
      { on: "battle-start", stat: "crit", value: 100, seconds: 0.2 },
      { on: "battle-start", stat: "damage", value: 8, seconds: 0.2 },
      { on: "battle-start", stat: "burn", value: 8, seconds: 0.2 },
    ],
  });
  through(combat, 17);
  assert.equal(combat.units[0]?.damage, 12);
  assert.equal(combat.units[0]?.crit, 0);
  assert.equal(combat.units[0]?.burn, 2);
  assert.deepEqual(primaryHits(combat), []);
  through(combat, 18);
  const hit = primaryHits(combat)[0];
  if (!hit || hit.kind !== "impact")
    throw new Error("Missing projectile arrival");
  assert.deepEqual(
    [hit.tick, hit.critical, hit.damage, hit.burnApplied],
    [18, true, 40, 10],
  );
  assert.equal(combat.units[1]?.health, 960);
});

test("Ward blocks arrival health while the captured positive status list and dedicated Frost still run", () => {
  const combat = fight({ burn: 5, poison: 2, frost: 3, stun: 0.4 }, [
    { ward: 1 },
  ]);
  through(combat, 17);
  assert.deepEqual(primaryHits(combat), []);
  assert.deepEqual(
    [
      combat.units[1]?.ward,
      combat.units[1]?.burning,
      combat.units[1]?.frostStacks,
    ],
    [1, 0, 0],
  );
  through(combat, 18);
  const target = combat.units[1];
  assert.deepEqual(
    [
      target?.health,
      target?.ward,
      target?.burning,
      target?.poisoned,
      target?.frostStacks,
    ],
    [1000, 0, 5, 2, 6],
  );
  assert.equal(target?.stunned, Math.fround(0.4));
});

test("source death after release preserves the shot and secondary credit while primary dead-source credit is suppressed", () => {
  const combat = fight(
    { health: 20, cleave: 1, killInsight: 1 },
    [
      { health: 12 },
      { x: 6.4, health: 6 },
      { x: 7, damage: 100, speed: 1, range: 20, windupPercent: 30 },
    ],
    [{}],
  );
  through(combat, 17);
  assert.equal(combat.units[0]?.life.kind, "dead");
  assert.deepEqual(primaryHits(combat), []);
  through(combat, 18);
  assert.equal(combat.units[1]?.life.kind, "dead");
  assert.equal(combat.units[2]?.life.kind, "dead");
  assert.deepEqual(
    combat.events
      .filter((event) => event.kind === "insight")
      .map((event) => [event.tick, event.amount]),
    [[18, 1]],
  );
  assert.equal(
    combat.result,
    null,
    "the shot does not contribute to army survival; another ally keeps this encounter active",
  );
});

test("a retained dead primary remains a flight target and permits Cleave without paying another primary kill", () => {
  const combat = fight(
    { cleave: 1, killInsight: 1 },
    [{ health: 10 }, { x: 6.4, health: 6 }, { x: 8, health: 1000 }],
    [{ x: 0.8, damage: 100, speed: 1, range: 11, windupPercent: 30 }],
  );
  through(combat, 17);
  assert.equal(combat.units[1]?.life.kind, "dead");
  assert.equal(combat.units[2]?.life.kind, "alive");
  through(combat, 18);
  assert.equal(combat.units[2]?.life.kind, "dead");
  assert.deepEqual(
    combat.events
      .filter((event) => event.kind === "insight")
      .map((event) => [event.tick, event.amount]),
    [[18, 1]],
  );
});

for (const [x, label] of [
  [0, "zero planar distance"],
  [0.378, "99-percent progress before exact contact"],
] as const)
  test(`arrival handles ${label} on the next projectile Update`, () => {
    const combat = fight({}, [{ x }]);
    through(combat, 2);
    assert.deepEqual(
      primaryHits(combat),
      [],
      "release does not itself dispatch projectile arrival",
    );
    through(combat, 3);
    assert.deepEqual(
      primaryHits(combat).map((hit) => hit.tick),
      [3],
    );
    assert.equal(combat.units[1]?.health, 988);
  });

test("flight tracks the captured moving target; a later closer actor neither intercepts nor redirects it", () => {
  const combat = fight({}, [{ movement: 2 }, { x: 9, movement: 20 }]);
  through(combat, 12);
  assert.deepEqual(primaryHits(combat), []);
  assert.equal(combat.units[2]?.health, 1000);
  through(combat, 13);
  assert.deepEqual(
    primaryHits(combat).map((hit) => hit.tick),
    [13],
  );
  assert.equal(combat.units[1]?.health, 988);
  assert.equal(combat.units[2]?.health, 1000);
});

test("ordinary melee retains its windup-end impact without a projectile continuation", () => {
  const combat = fight({ sprite: "hoplite" });
  through(combat, 2);
  assert.deepEqual(
    primaryHits(combat).map((hit) => hit.tick),
    [2],
  );
  assert.equal(combat.units[1]?.health, 988);
});

test("independent in-flight payloads keep their release RNG result and never draw a second arrival critical", () => {
  const combat = fight({
    speed: 5,
    crit: 25,
    burn: 2,
    triggers: [
      { on: "battle-start", stat: "crit", value: 75, seconds: 0.2 },
      { on: "battle-start", stat: "damage", value: 8, seconds: 0.2 },
      { on: "battle-start", stat: "burn", value: 8, seconds: 0.2 },
    ],
  });
  through(combat, 38);
  assert.deepEqual(
    primaryHits(combat)
      .slice(0, 5)
      .map((hit) =>
        hit.kind === "impact"
          ? [hit.tick, hit.critical, hit.damage, hit.burnApplied]
          : [],
      ),
    [
      [18, true, 40, 10],
      [23, false, 12, 2],
      [28, false, 12, 2],
      [33, false, 12, 2],
      [38, true, 24, 2],
    ],
  );
});
