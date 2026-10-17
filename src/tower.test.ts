import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import type { CombatEvent } from "./effects.ts";

const unit = {
  name: "Tower contract", sprite: "hoplite", side: "opponent", x: 3, y: 0,
  health: 10000, armor: 0, damage: 0, speed: 0.1, windupPercent: 100,
  movement: 0, range: 0, crit: 0, burn: 0, ward: 0,
};
const controller = {
  item: "defense-tower", side: "polis", origin: { side: "polis", tile: 21 },
  x: 0, y: 0, speed: 0.5, count: 1, damage: 5, burn: 0, poison: 0, frost: 0,
};
function fight(towers: Record<string, unknown>[] = [controller], enemies = [{}], allies = [{}]) {
  return createCombat(battle.parse({
    seed: 1, kind: "training", opponent: "Static controller source contract", towers,
    fighters: [
      ...allies.map((u) => ({ ...unit, side: "polis", x: -10, ...u })),
      ...enemies.map((u) => ({ ...unit, ...u })),
    ],
  }));
}
function run(c: ReturnType<typeof createCombat>, until: number) {
  const events: CombatEvent[] = [];
  let last = -1;
  while (c.ticks < until && !c.result) {
    c.advance();
    for (const e of c.events) if (e.id > last) events.push(e);
    last = events.at(-1)?.id ?? last;
  }
  return events;
}
const shots = (events: CombatEvent[]) => events.filter((e) => e.kind === "attack" && e.from === null);
const hits = (events: CombatEvent[]) => events.filter((e) => e.kind === "impact" && e.from === null);

test("controller rows validate actual item origins and finite signed FloatStats", () => {
  assert.doesNotThrow(() => fight([{ ...controller, speed: -1, count: 1.5 }]));
  assert.throws(() => fight([{ ...controller, origin: { side: "opponent", tile: 21 } }]));
  assert.throws(() => fight([{ ...controller, item: "spear-camp" }]));
  assert.throws(() => fight([{ ...controller, speed: Infinity }]));
  assert.throws(() => fight([{ ...controller, frost: 2_147_483_648 }]));
});

test("binary32 strict first period and fractional burst preserve overshoot and pause through the final wait", () => {
  const c = fight([{ ...controller, count: 2.1 }]);
  const events = run(c, 94);
  assert.deepEqual(shots(events).map((e) => e.tick), [41, 45, 49, 93]);
  assert.deepEqual(shots(events).map((e) => e.from), [null, null, null, null]);
  assert.ok(shots(events).every((e) => e.tower?.item === "defense-tower"));
});

test("zero and negative APS never advance and nonpositive bursts emit no shots", () => {
  for (const values of [{ speed: 0 }, { speed: -1 }, { count: 0 }, { count: -1 }]) {
    const c = fight([{ ...controller, ...values }]);
    assert.equal(shots(run(c, 150)).length, 0);
    assert.equal(c.result, null);
    assert.equal(c.units.length, 2);
  }
});

test("nearest Tower selection cycles before repeating and clears selection at the next volley", () => {
  const c = fight([{ ...controller, speed: 10, count: 5 }], [{ x: 1 }, { x: -1 }]);
  const events = run(c, 25);
  assert.deepEqual(shots(events).slice(0, 6).map((e) => e.to), [1, 2, 1, 2, 1, 1]);
});

test("Thunderbolt draws with replacement and sender-null lightning impacts on the next update", () => {
  const c = fight([{ ...controller, item: "thunderbolt-of-zeus", speed: 10, count: 3, damage: 0, burn: 3 }], [{}, { x: -3 }]);
  const events = run(c, 6);
  assert.deepEqual(shots(events).map((e) => [e.tick, e.to, e.effect]), [[3, 1, "lightning"], [4, 1, "lightning"], [5, 2, "lightning"]]);
  assert.deepEqual(hits(events).map((e) => [e.tick, e.to, e.projectileId]), shots(events).map((e) => [e.tick + 1, e.to, e.projectileId]));
  assert.ok(shots(events).every((e) => e.projectileId === e.id));
});

test("Tower arrows track moving recipients at speed15 and correlate actual arrival separately from the initial estimate", () => {
  const c = fight([{ ...controller, speed: 10 }], [{ movement: 20 }]);
  const events = run(c, 6);
  assert.deepEqual(shots(events).map((e) => [e.tick, e.target.x, e.windup]), [[3, 2, 2 / 7.5]]);
  assert.deepEqual(hits(events).map((e) => [e.tick, e.target.x, e.damage, e.projectileId]), [[6, 0.5, 5, shots(events)[0]?.id]]);
});

test("sender-null projectiles use Ward and recipient pools, then positive Fire Poison Frost once", () => {
  for (const [damage, remainingWard] of [[0, 1], [5, 0]] as const) {
    const c = fight([{ ...controller, item: "thunderbolt-of-zeus", speed: 10, damage, burn: 3, poison: 5, frost: 25 }], [{ ward: 1, thorn: 10000 }]);
    const events = run(c, 4);
    assert.deepEqual([c.units[1]?.health, c.units[1]?.ward, c.units[1]?.burning, c.units[1]?.poisoned, c.units[1]?.frostStacks], [10000, remainingWard, 3, 5, 25]);
    assert.equal(events.filter((e) => e.kind === "frost").length, 1);
    assert.deepEqual(hits(events).map((e) => [e.damage, e.critical, e.blocked, e.from]), [[0, false, damage > 0, null]]);
    assert.equal(c.units[0]?.health, 10000);
    assert.ok(!events.some((e) => e.kind === "impact" && e.reflection));
  }
  const c = fight([{ ...controller, item: "thunderbolt-of-zeus", speed: 10, damage: 11, burn: -1, poison: -1, frost: -1 }], [{ armor: 4, damageReduction: 50 }]);
  const events = run(c, 4);
  assert.deepEqual([c.units[1]?.health, c.units[1]?.armor, c.units[1]?.burning, c.units[1]?.poisoned, c.units[1]?.frostStacks], [9998.5, 0, 0, 0, 0]);
  assert.deepEqual(hits(events).map((e) => [e.damage, e.armorDamage]), [[5.5, 4]]);
});

test("static kills do not borrow Unit critical, Cleave, Thorn or kill Insight callbacks", () => {
  const c = fight([{ ...controller, speed: 10, damage: 10 }], [{ x: 0, health: 1, thorn: 10000 }, { x: 1, health: 10000 }], [{ damage: 7, crit: 100, criticalGrowth: 9, cleave: 10, killInsight: 100 }]);
  const events = run(c, 4);
  assert.equal(c.units[1]?.life.kind, "dead");
  assert.equal(c.units[2]?.health, 10000);
  assert.deepEqual([c.units[0]?.health, c.units[0]?.damage], [10000, 7]);
  assert.equal(c.result, null);
  assert.equal(hits(events).length, 1);
  const end = fight([{ ...controller, speed: 10, damage: 10 }], [{ x: 0, health: 1 }], [{ killInsight: 100 }]);
  run(end, 4);
  assert.deepEqual(end.result, { winner: "polis", ticks: 4, survivors: [1, 0] });
});

test("each shot reselects after a death, while reviving recipients remain eligible and receive statuses", () => {
  const dead = fight([{ ...controller, speed: 10, count: 2, damage: 10 }], [{ x: 0, health: 1 }, { x: 1 }]);
  const events = run(dead, 7);
  assert.deepEqual(shots(events).map((e) => e.to), [1, 2]);
  const reviving = fight([{ ...controller, speed: 10, burn: 3, frost: 25 }], [{ x: 0, health: 1, revive: 1 }, { x: 2 }], [{ x: 0, y: -3, damage: 10, speed: 1, windupPercent: 0, range: 20 }]);
  const revivedEvents = run(reviving, 4);
  assert.deepEqual(shots(revivedEvents).map((e) => e.to), [1]);
  assert.deepEqual([reviving.units[1]?.life, reviving.units[1]?.health, reviving.units[1]?.burning, reviving.units[1]?.frostStacks], [{ kind: "reviving", restoreAt: 62 }, 0, 3, 25]);
  assert.equal(reviving.units[2]?.health, 10000);
});

test("the port's32 actor proxy cap can yield empty attempts without stalling the battle", () => {
  const enemies = Array.from({ length: 33 }, (_, index) => ({ x: index < 32 ? 0 : 10, health: index < 32 ? 1 : 10000 }));
  const c = fight([{ ...controller, speed: 10, count: 40, damage: 10000 }], enemies);
  const events = run(c, 240);
  assert.equal(c.units.filter((u) => u.side === "opponent" && u.life.kind !== "dead").length, 1);
  assert.ok(shots(events).length >= 32 && shots(events).length < 40);
  assert.ok(shots(events).every((e) => e.to !== 33));
  assert.equal(c.units[33]?.health, 10000);
  assert.equal(c.ticks, 240);
  assert.equal(c.result, null);
});

test("last Unit death ends the phase despite static controllers and pending arrows", () => {
  const c = fight([{ ...controller, speed: 20 }], [{ x: 0, damage: 10, speed: 1, windupPercent: 0, range: 20 }], [{ x: -3, health: 1 }]);
  const events = run(c, 100);
  assert.deepEqual(c.result, { winner: "opponent", ticks: 2, survivors: [0, 1] });
  assert.equal(shots(events).length, 1);
  assert.equal(hits(events).length, 0);
  for (let i = 0; i < 20; i++) c.advance();
  assert.equal(c.ticks, 2);
  assert.equal(c.events.filter((e) => e.kind === "impact" && e.from === null).length, 0);
});
