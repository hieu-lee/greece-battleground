import { test } from "node:test";
import assert from "node:assert/strict";
import { battle, createCombat, resolveBattle } from "./combat.ts";
import { createEffectCursor, eventSounds } from "./effects.ts";
import type { Fighter } from "./combat.ts";

function duel(
  changes: Partial<Fighter> = {},
  targetChanges: Partial<Fighter> = {},
) {
  const unit = {
    name: "Warrior",
    sprite: "hoplite",
    x: -0.1,
    y: 0,
    health: 100,
    armor: 0,
    damage: 10,
    speed: 1,
    windupPercent: 25,
    movement: 0,
    range: 1,
    crit: 0,
    burn: 0,
    ward: 0,
    regen: 0,
    criticalGrowth: 0,
  };
  return battle.parse({
    seed: 42,
    kind: "training",
    opponent: "Opposition",
    fighters: [
      { ...unit, side: "polis", ...changes },
      { ...unit, x: 0.1, side: "opponent", damage: 0, ...targetChanges },
    ],
  });
}

test("the audiovisual stream emits contact, Ward and one death at the actual simulation tick", () => {
  const sim = createCombat(
    duel({ attackEffect: "lightning", burn: 4, damage: 100 }, { ward: 1 }),
  );
  for (let i = 0; i < 5; i++) sim.advance();
  assert.equal(sim.events.filter((e) => e.kind === "impact").length, 0);
  sim.advance();
  const blocked = sim.events.find((e) => e.kind === "impact" && e.from === 0);
  assert.ok(blocked?.kind === "impact");
  assert.deepEqual(
    {
      tick: blocked.tick,
      effect: blocked.effect,
      damage: blocked.damage,
      armor: blocked.armorDamage,
      burn: blocked.burnApplied,
      blocked: blocked.blocked,
    },
    {
      tick: 6,
      effect: "lightning",
      damage: 0,
      armor: 0,
      burn: 4,
      blocked: true,
    },
  );
  assert.deepEqual(eventSounds(blocked), ["ward"]);
  while (!sim.result) sim.advance();
  assert.deepEqual(
    sim.events.filter((e) => e.kind === "death").map((e) => [e.tick, e.unit]),
    [[26, 1]],
  );
  assert.deepEqual(sim.result, {
    winner: "polis",
    ticks: 26,
    survivors: [1, 0],
  });
  sim.advance();
  assert.equal(sim.events.filter((e) => e.kind === "death").length, 1);
});

test("Armor and critical sounds share a single hit receipt; the audio cursor never replays an observed event", () => {
  const sim = createCombat(duel({ crit: 100, windupPercent: 0 }, { armor: 7 }));
  sim.advance();
  sim.advance();
  const impact = sim.events.find((e) => e.kind === "impact" && e.from === 0);
  assert.ok(impact?.kind === "impact");
  assert.deepEqual(
    [impact.damage, impact.armorDamage, impact.critical],
    [20, 7, true],
  );
  assert.deepEqual(eventSounds(impact), ["spear", "armor", "critical"]);
  const cursor = createEffectCursor();
  assert.equal(cursor.take(sim.events).length, 3);
  assert.deepEqual(cursor.take(sim.events), []);
  for (let i = 0; i < 20; i++) sim.advance();
  assert.equal(
    cursor.take(sim.events).filter((e) => e.kind === "impact").length,
    2,
  );
  assert.deepEqual(cursor.take(sim.events), []);
  cursor.reset();
  assert.ok(cursor.take(sim.events).length > 0);
});

test("both painted chiefs use kopis contact and sound without changing combat", () => {
  for (const sprite of ["aegeus", "atalanta"] satisfies Fighter["sprite"][]) {
    const input = duel({ sprite }, { armor: 7 });
    const sim = createCombat(input);
    for (let i = 0; i < 6; i++) sim.advance();
    const attack = sim.events.find((e) => e.kind === "attack" && e.from === 0);
    const impact = sim.events.find((e) => e.kind === "impact" && e.from === 0);
    assert.ok(attack?.kind === "attack");
    assert.ok(impact?.kind === "impact");
    assert.equal(attack.effect, "kopis");
    assert.deepEqual(
      [impact.effect, impact.tick, impact.damage, impact.armorDamage],
      ["kopis", 6, 10, 7],
    );
    assert.deepEqual(eventSounds(impact), ["kopis", "armor"]);
    const spear = battle.parse({
      ...input,
      fighters: input.fighters.map((u) => ({ ...u, attackEffect: "spear" })),
    });
    assert.deepEqual(resolveBattle(input), resolveBattle(spear));
  }
});

test("regeneration cues report actual restored Health and cosmetic effects cannot change battle results", () => {
  const input = duel({ windupPercent: 0, speed: 0.1, damage: 5 }, { regen: 3 });
  const sim = createCombat(input);
  for (let i = 0; i < 60; i++) sim.advance();
  assert.deepEqual(
    sim.events.filter((e) => e.kind === "heal").map((e) => [e.tick, e.amount]),
    [
      [20, 3],
      [40, 2],
    ],
  );
  assert.deepEqual(
    sim.events.filter((event) => event.kind === "revive"),
    [],
  );
  const effectInput = battle.parse({
    ...input,
    fighters: input.fighters.map((u) => ({ ...u, attackEffect: "fire" })),
  });
  assert.deepEqual(resolveBattle(effectInput), resolveBattle(input));
});

test("restoration emits one distinct revive receipt and consumes the existing heal sound once", () => {
  const sim = createCombat(
    duel(
      {
        health: 200,
        armor: 30,
        revive: 1,
        damage: 0,
        speed: 0.01,
        windupPercent: 0,
      },
      { damage: 230, speed: 0.01, windupPercent: 0 },
    ),
  );
  const cursor = createEffectCursor();
  const restoration = [];
  for (let tick = 1; tick <= 63; tick++) {
    sim.advance();
    for (const event of cursor.take(sim.events)) {
      if (event.kind === "heal" || event.kind === "revive")
        restoration.push({
          kind: event.kind,
          tick: event.tick,
          unit: event.unit,
          amount: event.amount,
          sounds: eventSounds(event),
        });
    }
    assert.deepEqual(cursor.take(sim.events), []);
  }
  assert.deepEqual(restoration, [
    { kind: "revive", tick: 62, unit: 0, amount: 200, sounds: ["heal"] },
  ]);
  assert.deepEqual(
    [sim.units[0]?.health, sim.units[0]?.armor, sim.units[0]?.life.kind],
    [200, 30, "alive"],
  );
});

test("expired effects leave the replay stream and emitted positions do not drift with living targets", () => {
  const sim = createCombat(
    // Enemies no longer push each other apart: the target walks in from 0.4 after the hit.
    duel({ damage: 0, windupPercent: 0 }, { range: 0, movement: 3, x: 0.4 }),
  );
  sim.advance();
  sim.advance();
  const event = sim.events.find((e) => e.kind === "impact");
  assert.ok(event?.kind === "impact");
  const position = { ...event.target };
  for (let i = 0; i < 80; i++) sim.advance();
  assert.notDeepEqual({ x: sim.units[1]?.x, y: sim.units[1]?.y }, position);
  assert.deepEqual(event.target, position);
  assert.ok(sim.events.length > 0);
  assert.ok(sim.events.every((e) => e.tick >= 41));
  assert.equal(
    sim.events.some((e) => e.id === event.id),
    false,
  );
});

test("absorbed Burn ticks emit Ward sound and no Burn damage sound", () => {
  const sim = createCombat(
    duel(
      { damage: 0, burn: 10, speed: 0.1, windupPercent: 0 },
      { ward: 1, armor: 5 },
    ),
  );
  for (let i = 0; i < 22; i++) sim.advance();
  const blocked = sim.events.find((event) => event.kind === "burn");
  assert.ok(blocked?.kind === "burn");
  assert.deepEqual(eventSounds(blocked), ["ward"]);
  assert.deepEqual(
    sim.units.map((unit) => unit.health),
    [100, 100],
  );
});
