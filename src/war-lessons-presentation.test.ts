import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { createEffectCursor, eventSounds } from "./effects.ts";
import type { Fighter } from "./combat.ts";

function encounter(side: Fighter["side"], status?: "burn" | "poison") {
  const base = {
    name: "War Lessons presentation fixture",
    sprite: "hoplite",
    x: -2,
    y: 0,
    health: 100,
    armor: 0,
    damage: status ? 0.1 : 10,
    speed: status ? 0.05 : 100,
    windupPercent: 0,
    movement: 0,
    range: 20,
    crit: 0,
    burn: 0,
    ward: 0,
  };
  return createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "War Lessons presentation fixture",
      fighters: [
        { ...base, side, killInsight: 1, ...(status ? { [status]: 10 } : {}) },
        {
          ...base,
          side: side === "polis" ? "opponent" : "polis",
          x: 0,
          health: 1,
          damage: 0,
          speed: 0.01,
        },
      ],
    }),
  );
}

for (const side of ["polis", "opponent"] as const)
  test(`${side} War Lessons kill emits one positioned reward and one existing Fate cue without a second cursor delivery`, () => {
    const combat = encounter(side);
    while (!combat.result && combat.ticks < 100) combat.advance();
    assert.equal(combat.result?.insight, 1);
    const cursor = createEffectCursor();
    const rewards = cursor
      .take(combat.events)
      .filter((event) => String(event.kind) === "insight");
    assert.deepEqual(
      rewards.map(({ id: _id, tick: _tick, ...payload }) => payload),
      [{ kind: "insight", unit: 0, target: { x: -2, y: 0 }, amount: 1 }],
    );
    assert.deepEqual(rewards.flatMap(eventSounds), ["fate"]);
    assert.deepEqual(cursor.take(combat.events), []);
  });

test("periodic Burn and Poison kills emit no reward feedback or Fate cue", () => {
  for (const status of ["burn", "poison"] as const) {
    const combat = encounter("opponent", status);
    while (!combat.result && combat.ticks < 100) combat.advance();
    assert.equal(combat.result?.winner, "opponent");
    assert.equal(combat.result.insight, undefined);
    assert.ok(combat.events.some((event) => event.kind === status));
    assert.equal(
      combat.events.some((event) => String(event.kind) === "insight"),
      false,
    );
    assert.equal(combat.events.flatMap(eventSounds).includes("fate"), false);
  }
});
