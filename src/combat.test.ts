import { test } from "node:test";
import assert from "node:assert/strict";
import { battle, createCombat, resolveBattle } from "./combat.ts";
import type { Fighter } from "./combat.ts";

function unit(side: Fighter["side"], changes: Partial<Fighter> = {}): Fighter {
  return {
    name: side,
    sprite: "hoplite",
    side,
    origin: null,
    x: side === "polis" ? -0.1 : 0.1,
    y: 0,
    health: 20,
    armor: 0,
    damage: 10,
    damageStat: "attack",
    piercing: false,
    damageReduction: 0,
    speed: 1,
    windupPercent: 0,
    movement: 3,
    // Source melee range: bodies in contact (0.5 arena units) stay within √(1² + 0.1) × 0.5.
    range: 1,
    crit: 0,
    burn: 0,
    ward: 0,
    regen: 0,
    criticalGrowth: 0,
    ...changes,
  };
}
function encounter(fighters: Fighter[]) {
  return battle.parse({
    seed: 42,
    kind: "training",
    opponent: "Test warband",
    fighters,
  });
}

test("equal warbands deliver simultaneous lethal attacks and draw regardless of deployment order", () => {
  for (const fighters of [
    [unit("polis"), unit("opponent")],
    [unit("opponent"), unit("polis")],
  ]) {
    assert.deepEqual(resolveBattle(encounter(fighters)), {
      winner: "draw",
      ticks: 22,
      survivors: [0, 0],
    });
  }
});

test("a same-tick death keeps the critical-grown damage of an attack already admitted that tick", () => {
  // 60 Health, 10 Damage, 100 Crit (+10 growth): hits for 20, 40, then 60 -> both die on the third swing.
  const grown = { health: 60, crit: 100, criticalGrowth: 10 };
  for (const fighters of [
    [unit("polis", grown), unit("opponent", grown)],
    [unit("opponent", grown), unit("polis", grown)],
  ]) {
    assert.equal(resolveBattle(encounter(fighters)).winner, "draw");
  }
});

test("Ward absorbs melee and projectile damage while attached Burn still reaches armor on the next Burn tick", () => {
  for (const attackEffect of ["spear", "arrow"] as const) {
    const sim = createCombat(
      encounter([
        unit("polis", { attackEffect, damage: 3, burn: 4, speed: 0.1 }),
        unit("opponent", { armor: 5, ward: 1, damage: 0 }),
      ]),
    );
    sim.advance();
    sim.advance();
    const target = sim.units[1];
    assert.ok(target);
    assert.deepEqual(
      [target.health, target.armor, target.ward, target.burning],
      [20, 5, 0, 4],
    );
    const hit = sim.events.find(
      (event) => event.kind === "impact" && event.from === 0,
    );
    assert.ok(hit?.kind === "impact");
    assert.deepEqual([hit.blocked, hit.damage, hit.burnApplied], [true, 0, 4]);
    for (let i = 2; i < 22; i++) sim.advance();
    assert.deepEqual(
      [target.health, target.armor, target.burning],
      [20, 1, Math.fround(3.2)],
    );
  }
});

test("Ward absorbs a Burn tick and still decays its stacks; zero attack damage does not consume Ward", () => {
  const sim = createCombat(
    encounter([
      unit("polis", { damage: 0, burn: 10, speed: 0.1 }),
      unit("opponent", { armor: 5, ward: 1, damage: 0 }),
    ]),
  );
  sim.advance();
  sim.advance();
  const target = sim.units[1];
  assert.ok(target);
  assert.deepEqual(
    [target.health, target.armor, target.ward, target.burning],
    [20, 5, 1, 10],
  );
  for (let i = 2; i < 22; i++) sim.advance();
  assert.deepEqual(
    [target.health, target.armor, target.ward, target.burning],
    [20, 5, 0, 8],
  );
  const tick = sim.events.find((event) => event.kind === "burn");
  assert.ok(tick?.kind === "burn");
  assert.deepEqual([tick.blocked, tick.amount], [true, 0]);
});

test("walking closes distance equally and replaying the same battle preserves the result", () => {
  const input = encounter([
    unit("polis", { x: -3, health: 45, damage: 5, speed: 0.8 }),
    unit("opponent", { x: 3, health: 45, damage: 5, speed: 0.8 }),
  ]);
  const sim = createCombat(input);
  for (let i = 0; i < 10; i++) sim.advance();
  // 10 ticks × movement 3 × 0.5 arena units per source unit × 0.05 s = 0.75.
  assert.ok(Math.abs((sim.units[0]?.x ?? 0) + 2.25) < 0.00001);
  assert.ok(Math.abs((sim.units[1]?.x ?? 0) - 2.25) < 0.00001);
  assert.equal(sim.units[0]?.walking, true);
  const result = resolveBattle(input);
  assert.equal(result.winner, "draw");
  assert.deepEqual(result.survivors, [0, 0]);
  assert.deepEqual(
    resolveBattle(battle.parse(JSON.parse(JSON.stringify(input)))),
    result,
  );
  assert.deepEqual(
    input.fighters.map((u) => u.health),
    [45, 45],
  );
});

test("unreachable combat terminates as a draw and malformed deployments are rejected", () => {
  assert.deepEqual(
    resolveBattle(
      encounter([
        unit("polis", { x: -5, movement: 0 }),
        unit("opponent", { x: 5, movement: 0 }),
      ]),
    ),
    { winner: "draw", ticks: 2400, survivors: [1, 1] },
  );
  assert.throws(() => encounter([unit("polis"), unit("polis")]));
  for (const speed of [0, Number.MIN_VALUE, 1e-40])
    assert.throws(() =>
      encounter([unit("polis", { speed }), unit("opponent")]),
    );
  assert.throws(() =>
    encounter([
      unit("polis", { speed: 1e-37, windupPercent: 100 }),
      unit("opponent"),
    ]),
  );
  for (const windupPercent of [-1, 1.5, 101])
    assert.throws(() =>
      encounter([unit("polis", { windupPercent }), unit("opponent")]),
    );
  const current = encounter([unit("polis"), unit("opponent")]);
  assert.throws(() =>
    battle.parse({
      ...current,
      fighters: current.fighters.map(({ windupPercent, ...legacy }) => ({
        ...legacy,
        windup: 0.25,
      })),
    }),
  );
});

test("attack damage lands on its contact frame and a dead attacker cannot finish a windup", () => {
  const duel = createCombat(
    encounter([
      unit("polis", { windupPercent: 25 }),
      unit("opponent", { windupPercent: 25 }),
    ]),
  );
  for (let i = 0; i < 5; i++) duel.advance();
  assert.deepEqual(
    duel.units.map((u) => u.health),
    [20, 20],
  );
  assert.deepEqual(
    duel.units.map((u) => u.attackAt),
    [1, 1],
  );
  duel.advance();
  assert.deepEqual(
    duel.units.map((u) => u.health),
    [10, 10],
  );
  assert.deepEqual(
    duel.events.filter((e) => e.kind === "impact").map((e) => e.tick),
    [6, 6],
  );

  const ambush = createCombat(
    encounter([
      unit("polis", { windupPercent: 25 }),
      unit("opponent", { damage: 20 }),
    ]),
  );
  ambush.advance();
  ambush.advance();
  assert.deepEqual(ambush.result, {
    winner: "opponent",
    ticks: 2,
    survivors: [0, 1],
  });
  for (let i = 0; i < 10; i++) ambush.advance();
  assert.equal(ambush.units[1]?.health, 20);
  assert.equal(ambush.units[0]?.deathAt, 2);
});

test("regeneration recovers each second without overhealing or reviving a dead unit", () => {
  const sim = createCombat(
    encounter([
      unit("polis", { damage: 5, speed: 0.1 }),
      unit("opponent", { damage: 0, regen: 3 }),
    ]),
  );
  sim.advance();
  sim.advance();
  assert.equal(sim.units[1]?.health, 15);
  for (let i = 2; i < 20; i++) sim.advance();
  assert.equal(sim.units[1]?.health, 18);
  for (let i = 0; i < 20; i++) sim.advance();
  assert.equal(sim.units[1]?.health, 20);
  const lethal = createCombat(
    encounter([
      unit("polis", { damage: 20 }),
      unit("opponent", { regen: 100, damage: 0 }),
    ]),
  );
  lethal.advance();
  lethal.advance();
  assert.equal(lethal.units[1]?.health, 0);
  assert.equal(lethal.result?.winner, "polis");
});

test("critical-hit growth affects subsequent damage and Ward-blocked critical callbacks also stack growth", () => {
  const sim = createCombat(
    encounter([
      unit("polis", { crit: 100, criticalGrowth: 6 }),
      unit("opponent", { damage: 0, health: 100, ward: 1 }),
    ]),
  );
  sim.advance();
  sim.advance();
  assert.equal(sim.units[0]?.damage, 16);
  assert.equal(sim.units[1]?.health, 100);
  for (let i = 0; i < 20; i++) sim.advance();
  assert.equal(sim.units[0]?.damage, 22);
  assert.equal(sim.units[1]?.health, 68);
  for (let i = 0; i < 20; i++) sim.advance();
  assert.equal(sim.units[0]?.damage, 28);
  assert.equal(sim.units[1]?.health, 24);
});

test("a queued critical hit from an already dead attacker does not apply its growth callback", () => {
  const sim = createCombat(
    encounter([
      unit("opponent", { damage: 20, health: 100 }),
      unit("polis", { crit: 100, criticalGrowth: 6 }),
    ]),
  );
  sim.advance();
  sim.advance();
  assert.equal(sim.units[1]?.health, 0);
  assert.equal(sim.units[1]?.damage, 10);
  assert.equal(sim.units[0]?.health, 80);
});

test("death clears previously earned critical growth and a fresh combat keeps its starting damage", () => {
  const input = encounter([
    unit("polis", { crit: 100, criticalGrowth: 6 }),
    unit("opponent", { damage: 20, health: 100, windupPercent: 25 }),
  ]);
  const sim = createCombat(input);
  sim.advance();
  sim.advance();
  assert.deepEqual([sim.units[0]?.damage, sim.units[1]?.health], [16, 80]);
  for (let tick = 2; tick < 6; tick++) sim.advance();
  assert.deepEqual(
    [sim.units[0]?.health, sim.units[0]?.deathAt, sim.units[0]?.damage],
    [0, 6, 10],
  );
  assert.equal(input.fighters[0]?.damage, 10);
  const fresh = createCombat(input);
  assert.deepEqual(
    [fresh.units[0]?.damage, fresh.units[0]?.deathAt],
    [10, null],
  );
});

test("fractional critical grants sum in binary32 before addition to starting damage", () => {
  const sim = createCombat(
    encounter([
      unit("polis", { crit: 100, criticalGrowth: 0.10000000149011612 }),
      unit("opponent", { damage: 0, health: 100 }),
    ]),
  );
  sim.advance();
  sim.advance();
  assert.equal(sim.units[0]?.damage, 10.100000381469727);
  for (let tick = 2; tick < 22; tick++) sim.advance();
  assert.equal(sim.units[0]?.damage, 10.199999809265137);
  for (let tick = 22; tick < 42; tick++) sim.advance();
  assert.deepEqual(
    [sim.units[0]?.damage, sim.units[1]?.health],
    [10.300000190734863, 39.400001525878906],
  );
  assert.deepEqual(
    sim.events.flatMap((event) =>
      event.kind === "impact" && event.from === 0 ? [event.damage] : [],
    ),
    [20, 20.200000762939453, 20.39999771118164],
  );
});
