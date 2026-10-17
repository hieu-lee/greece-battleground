import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import type { Fighter } from "./combat.ts";

const base = {
  name: "War Lessons callback fixture",
  sprite: "hoplite",
  side: "polis",
  x: -2,
  y: 0,
  health: 100,
  armor: 0,
  damage: 10,
  speed: 100,
  windupPercent: 0,
  movement: 0,
  range: 20,
  crit: 0,
  burn: 0,
  ward: 0,
} satisfies Partial<Fighter>;

function combat(fighters: Partial<Fighter>[]) {
  return createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "War Lessons callback fixture",
      fighters: fighters.map((unit) => ({ ...base, ...unit })),
    }),
  );
}

function advance(c: ReturnType<typeof combat>, ticks: number) {
  while (c.ticks < ticks && !c.result) c.advance();
}

test("either army's attached War Lessons modifier pays the shared campaign reward", () => {
  for (const side of ["polis", "opponent"] as const) {
    const c = combat([
      { side, killInsight: 1 },
      {
        side: side === "polis" ? "opponent" : "polis",
        x: 0,
        health: 1,
        speed: 0.01,
        damage: 0,
      },
    ]);
    advance(c, 2);
    assert.equal(c.result?.insight, 1, side);
    assert.equal(c.result?.winner, side);
  }
});

test("the guaranteed reward still consumes a random sample before the next attack's critical roll", () => {
  for (const [killInsight, expectedDamage] of [
    [undefined, 20],
    [1, 10],
  ] as const) {
    const c = combat([
      { killInsight },
      { y: 4, crit: 50 },
      { side: "opponent", x: 0, health: 1, damage: 0, speed: 0.01 },
      { side: "opponent", x: 0, y: 4, damage: 0, speed: 0.01 },
    ]);
    advance(c, 2);
    const hit = c.events.find(
      (event) => event.kind === "impact" && event.from === 1,
    );
    assert.ok(hit?.kind === "impact");
    assert.equal(hit.damage, expectedDamage);
    assert.equal(c.units[3]?.health, 100 - expectedDamage);
  }
});

test("a revival is not a kill; the later final death pays once", () => {
  const c = combat([
    { killInsight: 1 },
    {
      side: "opponent",
      x: 0,
      health: 1,
      revive: 1,
      damage: 0,
      speed: 0.01,
    },
  ]);
  advance(c, 2);
  assert.equal(c.units[1]?.life.kind, "reviving");
  assert.equal(Boolean(c.result), false);
  advance(c, 100);
  assert.equal(c.result?.insight, 1);
});

test("ordinary Burn and Poison ticks never invoke the kill-reward callback", () => {
  for (const status of ["burn", "poison"] as const) {
    const c = combat([
      { killInsight: 1, damage: 0.1, speed: 0.05, [status]: 10 },
      { side: "opponent", x: 0, health: 1, damage: 0, speed: 0.01 },
    ]);
    advance(c, 100);
    assert.equal(c.result?.winner, "polis");
    assert.equal(c.result?.insight, undefined, status);
    assert.ok(c.events.some((event) => event.kind === status));
  }
});

test("Thorn pays from a living or reviving defender, but an actually dead defender fails the primary callback", () => {
  for (const [health, revive, expected] of [
    [100, 0, 1],
    [1, 1, 1],
    [1, 0, undefined],
  ] as const) {
    const c = combat([
      { health: 1 },
      {
        side: "opponent",
        x: 0,
        health,
        revive,
        damage: 0,
        speed: 0.01,
        thorn: 100,
        killInsight: 1,
      },
    ]);
    advance(c, 2);
    assert.equal(c.units[0]?.life.kind, "dead");
    assert.equal(c.result?.insight, expected, `${health}/${revive}`);
  }
});
