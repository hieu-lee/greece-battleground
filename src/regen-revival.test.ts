import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat, fighter } from "./combat.ts";
import type { Fighter } from "./combat.ts";

function actor(side: Fighter["side"], changes: Partial<Fighter> = {}) {
  return fighter.parse({
    name: "Regeneration recipient fixture",
    sprite: "hoplite",
    side,
    x: side === "polis" ? -1 : 1,
    y: 0,
    health: 100,
    armor: 0,
    damage: 0,
    speed: 0.01,
    windupPercent: 0,
    movement: 0,
    range: 20,
    crit: 0,
    burn: 0,
    ward: 0,
    ...changes,
  });
}

function start(regen: number, revive: number) {
  return createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Regeneration recipient fixture",
      fighters: [
        actor("polis", { health: 1000, damage: 100, poison: 5 }),
        actor("opponent", { regen, revive }),
        actor("opponent", { x: 3, health: 1000 }),
      ],
    }),
  );
}

function until(sim: ReturnType<typeof createCombat>, tick: number) {
  while (sim.ticks < tick && !sim.result) sim.advance();
  assert.equal(sim.ticks, tick);
}

for (const [regen, first, second, third] of [
  [3, 3, 6, 9],
  [200, 100, 100, 100],
] as const) {
  test(`Regen${regen} heals a reviving recipient through ordinary health processing without completing revival early`, () => {
    const sim = start(regen, 1);
    until(sim, 2);
    const target = sim.units[1];
    assert.ok(target);
    assert.deepEqual(
      [target.health, target.poisoned, target.life],
      [0, 5, { kind: "reviving", restoreAt: 62 }],
    );
    for (const [tick, health] of [
      [20, first],
      [40, second],
      [60, third],
    ] as const) {
      until(sim, tick);
      assert.deepEqual(
        [target.health, target.poisoned, target.life.kind, sim.result],
        [health, Math.max(0, 5 - health), "reviving", null],
      );
    }
    assert.deepEqual(
      sim.events.flatMap((event) =>
        event.kind === "heal" && event.unit === 1
          ? [{ tick: event.tick, amount: event.amount }]
          : [],
      ),
      regen === 3
        ? [
            { tick: 20, amount: 3 },
            { tick: 40, amount: 3 },
            { tick: 60, amount: 3 },
          ]
        : [{ tick: 20, amount: 100 }],
    );
    assert.equal(
      sim.events.some((event) => event.kind === "revive"),
      false,
    );
    until(sim, 62);
    assert.deepEqual([target.health, target.life.kind], [100, "alive"]);
    assert.deepEqual(
      sim.events
        .filter((event) => event.kind === "revive")
        .map((event) => event.tick),
      [62],
    );
  });
}

test("Regen never heals a truly dead recipient while other actors keep the battle running", () => {
  const sim = start(200, 0);
  until(sim, 40);
  assert.deepEqual(
    [sim.units[1]?.health, sim.units[1]?.life.kind, sim.result],
    [0, "dead", null],
  );
  assert.equal(
    sim.events.some((event) => event.kind === "heal" && event.unit === 1),
    false,
  );
});
