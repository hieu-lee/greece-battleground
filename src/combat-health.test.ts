import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat, fighter } from "./combat.ts";
import type { Fighter } from "./combat.ts";

// Fighter range is in source units (arena units × 2): healers 4 apart use range 12, contact
// duels 1 apart range 2.
function unit(side: Fighter["side"], changes: Partial<Fighter> = {}) {
  return fighter.parse({
    name: "Domain fixture",
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
function run(fighters: Fighter[], seed = 42) {
  return createCombat(
    battle.parse({
      seed,
      kind: "training",
      opponent: "Health domain fixture",
      fighters,
    }),
  );
}
function advance(sim: ReturnType<typeof createCombat>, until: number) {
  while (sim.ticks < until && !sim.result) sim.advance();
}

for (const vector of [
  { name: "ordinary", damage: 70, healing: 10, crit: 0, after: 40, gain: 10 },
  { name: "critical", damage: 70, healing: 10, crit: 100, after: 50, gain: 20 },
  {
    name: "critical capped",
    damage: 10,
    healing: 10,
    crit: 100,
    after: 100,
    gain: 10,
  },
  {
    name: "Mender level3 critical",
    damage: 190,
    healing: 45,
    crit: 100,
    maximum: 200,
    after: 100,
    gain: 90,
  },
  {
    name: "binary32 direct healing",
    damage: 0.20000000298023224,
    healing: 0.10000000149011612,
    crit: 0,
    maximum: 1,
    after: 0.9000000357627869,
    gain: 0.10000002384185791,
  },
]) {
  test(`direct healing health gateway: ${vector.name}`, () => {
    const sim = run([
      unit("polis", {
        x: -5,
        healing: vector.healing,
        crit: vector.crit,
        speed: 0.4,
        windupPercent: 30,
        range: 12,
        burn: 100,
        damage: 90,
        criticalGrowth: 5,
      }),
      unit("polis", {
        health: vector.maximum ?? 100,
        armor: 0,
        ward: 2,
      }),
      unit("opponent", {
        damage: vector.damage,
        damageStat: "health",
        piercing: true,
      }),
    ]);
    advance(sim, 2);
    const recipient = sim.units[1];
    assert.ok(recipient);
    assert.equal(
      recipient.health,
      Math.fround((vector.maximum ?? 100) - vector.damage),
    );
    advance(sim, 3);
    assert.deepEqual(
      [sim.units[0]?.target, sim.units[0]?.windupSeconds],
      [1, 0.75],
    );
    advance(sim, 17);
    assert.equal(
      sim.events.some((event) => event.kind === "heal"),
      false,
    );
    advance(sim, 18);
    const heal = sim.events.find((event) => event.kind === "heal");
    assert.ok(heal?.kind === "heal");
    assert.deepEqual(
      [
        recipient.health,
        heal.tick,
        heal.amount,
        recipient.ward,
        recipient.burning,
      ],
      [vector.after, 18, vector.gain, 2, 0],
    );
    assert.equal(sim.units[0]?.damage, 90);
    assert.equal(
      sim.events.some((event) => event.kind === "impact" && event.from === 0),
      false,
    );
  });
}

test("direct heal uses the inclusive zero critical endpoint with the explicitly provisional LCG", () => {
  const sim = run(
    [
      unit("polis", {
        x: -5,
        healing: 10,
        speed: 0.4,
        windupPercent: 30,
        range: 12,
      }),
      unit("polis"),
      unit("opponent", { damage: 70 }),
    ],
    1869465083,
  );
  advance(sim, 18);
  assert.equal(sim.units[1]?.health, 50);
  assert.deepEqual(
    sim.events
      .filter((event) => event.kind === "heal")
      .map((event) => event.amount),
    [20],
  );
});

test("injured ally priority uses nearest squared distance rather than missing health percentage", () => {
  const sim = run([
    unit("polis", {
      x: -5,
      healing: 10,
      speed: 0.4,
      windupPercent: 30,
      range: 12,
    }),
    unit("polis", { x: -3 }),
    unit("polis", { x: -1, health: 20 }),
    unit("opponent", { x: -3, y: 1, damage: 5 }),
    unit("opponent", { x: -1, y: 1, damage: 15 }),
  ]);
  advance(sim, 2);
  assert.deepEqual([sim.units[1]?.health, sim.units[2]?.health], [95, 5]);
  advance(sim, 3);
  assert.equal(sim.units[0]?.target, 1);
});

test("full allies provide front-line positioning but cancel healing before windup", () => {
  for (const side of ["polis", "opponent"] as const) {
    const direction = side === "polis" ? 1 : -1;
    const other = side === "polis" ? "opponent" : "polis";
    const sim = run([
      unit(side, {
        x: -5 * direction,
        healing: 10,
        speed: 0.4,
        windupPercent: 30,
        range: 1,
        movement: 2.5,
      }),
      unit(side, { x: -3 * direction }),
      unit(side, { x: -1 * direction }),
      unit(other, { x: 5 * direction }),
    ]);
    advance(sim, 1);
    assert.deepEqual(
      [sim.units[0]?.target, sim.units[0]?.walking, sim.units[0]?.attackAt],
      [2, true, null],
    );
    assert.equal(
      sim.events.some((event) => event.kind === "heal"),
      false,
    );
  }
});

test("a healer excludes itself and an immobile out-of-range injured ally", () => {
  const sim = run([
    unit("polis", {
      x: -1,
      healing: 10,
      speed: 0.4,
      windupPercent: 30,
      range: 1,
    }),
    unit("polis", { x: -5 }),
    unit("opponent", { x: 1, damage: 20 }),
    unit("opponent", { x: -5, y: 1, damage: 20 }),
  ]);
  advance(sim, 3);
  assert.deepEqual([sim.units[0]?.health, sim.units[1]?.health], [80, 80]);
  assert.deepEqual(
    [sim.units[0]?.target, sim.units[0]?.attackAt],
    [null, null],
  );
});

test("filling a target during a pending heal yields no positive-gain callback", () => {
  const sim = run([
    unit("polis", {
      x: -5,
      healing: 30,
      crit: 100,
      speed: 1,
      windupPercent: 0,
      range: 12,
    }),
    unit("polis", {
      x: -4,
      healing: 30,
      crit: 100,
      speed: 0.4,
      windupPercent: 30,
      range: 12,
    }),
    unit("polis", { x: -1 }),
    unit("opponent", { damage: 20 }),
  ]);
  advance(sim, 3);
  assert.deepEqual([sim.units[0]?.attackAt, sim.units[1]?.attackAt], [3, 3]);
  advance(sim, 18);
  assert.equal(sim.units[2]?.health, 100);
  assert.deepEqual(
    sim.events
      .filter((event) => event.kind === "heal")
      .map((event) => [event.tick, event.amount]),
    [[4, 20]],
  );
});

test("pending healing rejects a recipient entering revival, and revival remains alive for victory", () => {
  const sim = run([
    unit("polis", {
      x: -5,
      healing: 10,
      speed: 0.4,
      windupPercent: 30,
      range: 12,
    }),
    unit("polis", { x: -1, revive: 1 }),
    unit("opponent", { x: 1, damage: 20 }),
    unit("opponent", { x: 2, damage: 100, speed: 1, windupPercent: 20 }),
  ]);
  advance(sim, 3);
  assert.equal(sim.units[0]?.attackAt, 3);
  advance(sim, 5);
  assert.deepEqual(
    [
      sim.units[1]?.health,
      sim.units[1]?.life.kind,
      sim.units[1]?.currentRevives,
    ],
    [0, "reviving", 0],
  );
  advance(sim, 18);
  assert.equal(sim.result, null);
  assert.equal(
    sim.events.some((event) => event.kind === "heal"),
    false,
  );
  assert.equal(
    sim.events.some((event) => event.kind === "death" && event.unit === 1),
    false,
  );
  assert.equal(sim.units[0]?.strike, null);
});

test("one guaranteed revival restores full modified Health and Armor at three seconds and resumes movement", () => {
  const sim = run([
    unit("polis", {
      x: -5,
      health: 200,
      armor: 30,
      revive: 1,
      movement: 3,
      range: 1,
    }),
    unit("opponent", { x: 5, damage: 230 }),
  ]);
  advance(sim, 2);
  const champion = sim.units[0];
  assert.ok(champion);
  assert.deepEqual(
    [
      champion.health,
      champion.armor,
      champion.life,
      champion.currentRevives,
      sim.result,
    ],
    [0, 0, { kind: "reviving", restoreAt: 62 }, 0, null],
  );
  const position = champion.x;
  advance(sim, 61);
  assert.deepEqual(
    [champion.health, champion.armor, champion.life.kind, champion.x],
    [0, 0, "reviving", position],
  );
  assert.equal(
    sim.events.some((event) => event.kind === "impact" && event.tick > 2),
    false,
  );
  assert.deepEqual(
    sim.events.filter((event) => event.kind === "revive"),
    [],
  );
  advance(sim, 62);
  assert.deepEqual(
    sim.events
      .filter((event) => event.kind === "revive" || event.kind === "heal")
      .map((event) => ({
        kind: event.kind,
        tick: event.tick,
        unit: event.unit,
        amount: event.amount,
      })),
    [{ kind: "revive", tick: 62, unit: 0, amount: 200 }],
  );
  assert.deepEqual(
    [
      champion.health,
      champion.armor,
      champion.life.kind,
      champion.deathAt,
      champion.walking,
    ],
    [200, 30, "alive", null, true],
  );
  // Movement 3 source units per second × 0.5 arena units × 0.05 s.
  assert.ok(Math.abs(champion.x - position - 0.075) < 0.0000001);
  assert.equal(
    sim.events.some((event) => event.kind === "death" && event.unit === 0),
    false,
  );
});

test("the charge is not refreshed after restoration; a second lethal hit creates ordinary death", () => {
  const sim = run([
    unit("polis", { revive: 1 }),
    unit("opponent", { damage: 100, speed: 0.2 }),
  ]);
  advance(sim, 62);
  assert.deepEqual(
    [
      sim.units[0]?.health,
      sim.units[0]?.life.kind,
      sim.units[0]?.currentRevives,
    ],
    [100, "alive", 0],
  );
  assert.deepEqual(
    sim.events
      .filter((event) => event.kind === "revive")
      .map((event) => [event.tick, event.unit, event.amount]),
    [[62, 0, 100]],
  );
  // The attack timer runs only in Fight: 0.05 s at tick 2, paused while the target revives
  // (untargetable), then from tick 62 until it exceeds 5 s at tick 160; the hit lands at 161.
  advance(sim, 160);
  assert.equal(sim.units[0]?.life.kind, "alive");
  advance(sim, 161);
  assert.deepEqual(
    [sim.units[0]?.health, sim.units[0]?.life.kind, sim.result?.winner],
    [0, "dead", "opponent"],
  );
  assert.equal(
    sim.events.filter((event) => event.kind === "death" && event.unit === 0)
      .length,
    1,
  );
  assert.deepEqual(
    sim.events.filter((event) => event.kind === "revive"),
    [],
  );
});

for (const [revive, charges] of [
  [0, 0],
  [0.5, 0],
  [1, 1],
  [1.5, 2],
  [2.5, 2],
  [3.5, 4],
] as const) {
  test(`modified revival ${revive} initializes nearest-even charge count ${charges}`, () => {
    const sim = run([
      unit("polis", { revive }),
      unit("opponent", { damage: 100 }),
    ]);
    assert.equal(sim.units[0]?.currentRevives, charges);
    advance(sim, 2);
    assert.deepEqual(
      [sim.units[0]?.life.kind, sim.units[0]?.currentRevives],
      [charges ? "reviving" : "dead", Math.max(0, charges - 1)],
    );
  });
}

test("revival scalar validation rejects unsupported signed32 conversion instead of inventing charges", () => {
  for (const revive of [-1, Infinity, NaN, 2_147_483_647])
    assert.throws(() => unit("polis", { revive }));
  assert.equal(unit("polis", { revive: 2_147_483_520 }).revive, 2_147_483_520);
});

// Poison (ML rules 9-15; handoff source-combat-math-next): Spartoi L1 deals 8 with 5 Poison.
function poisoned(target: Partial<Fighter>) {
  return run([
    unit("polis", {
      x: -0.5,
      damage: 8,
      poison: 5,
      range: 2,
      windupPercent: 0,
    }),
    unit("opponent", { x: 0.5, ...target }),
  ]);
}
test("poison stacks on hit and ticks stacks x1 each second from its first stack without decay", () => {
  const sim = poisoned({});
  advance(sim, 2);
  const target = sim.units[1];
  assert.ok(target);
  assert.deepEqual([target.health, target.poisoned], [92, 5]);
  // The simulator keeps 40 ticks of events, so collect them while advancing.
  const ticks: number[][] = [];
  while (sim.ticks < 62) {
    sim.advance();
    for (const event of sim.events)
      if (event.kind === "poison" && event.tick === sim.ticks)
        ticks.push([event.tick, event.amount]);
  }
  assert.deepEqual(ticks, [
    [22, 5],
    [42, 5],
    [62, 5],
  ]);
  assert.deepEqual([target.health, target.poisoned], [77, 5]);
});
test("healing removes one poison stack per point healed", () => {
  const sim = poisoned({ regen: 3 });
  advance(sim, 21);
  assert.deepEqual([sim.units[1]?.health, sim.units[1]?.poisoned], [95, 2]);
  advance(sim, 22);
  assert.deepEqual([sim.units[1]?.health, sim.units[1]?.poisoned], [93, 2]);
});
test("a Ward-blocked hit still adds poison, and Ward then Armor absorb ticks", () => {
  const warded = poisoned({ ward: 2 });
  advance(warded, 22);
  assert.deepEqual(
    [warded.units[1]?.health, warded.units[1]?.poisoned, warded.units[1]?.ward],
    [100, 5, 0],
  );
  const armored = poisoned({ armor: 100 });
  advance(armored, 22);
  assert.deepEqual(
    [armored.units[1]?.health, armored.units[1]?.armor],
    [100, 87],
  );
});

test("a hit that sends its target into revival still attaches Burn and Poison", () => {
  const sim = run([
    unit("polis", { x: -0.5, damage: 150, burn: 4, poison: 3, range: 2 }),
    unit("opponent", { x: 0.5, revive: 1 }),
  ]);
  advance(sim, 2);
  const target = sim.units[1];
  assert.ok(target);
  assert.deepEqual(
    [target.life.kind, target.health, target.burning, target.poisoned],
    ["reviving", 0, 4, 3],
  );
  // Statuses wait out the revival (no health change while reviving), then tick on restoration.
  advance(sim, 62);
  assert.deepEqual([target.life.kind, target.health], ["alive", 100]);
  advance(sim, 82);
  assert.ok(target.health < 100);
});

// TickablePoison.OnHealthChanged removes stacks equal to the positive reported change, i.e. the
// combined Health+Armor callback amount (handoff heal-callback-v4-tests-next: Armor 100000,
// HP .800000011920929 -> .9000000357627869 reports .1015625), not the raw Health gain.
test("poison cleansing uses the reported health-change amount", () => {
  const sim = run([
    unit("polis", {
      x: -0.5,
      damage: 0.20000000298023224,
      piercing: true,
      poison: 5,
      range: 2,
    }),
    unit("opponent", {
      x: 0.5,
      health: 1,
      armor: 100_000,
      regen: 0.10000000149011612,
    }),
  ]);
  advance(sim, 2);
  assert.deepEqual(
    [sim.units[1]?.health, sim.units[1]?.poisoned],
    [0.800000011920929, 5],
  );
  advance(sim, 20);
  assert.deepEqual(
    [sim.units[1]?.health, sim.units[1]?.poisoned],
    [0.9000000357627869, 4.8984375],
  );
});
// The shared stack threshold (0.0001, as Burn's) also clears negligible Poison and its timer.
test("negligible poison stacks are removed with their timer", () => {
  const sim = run([
    unit("polis", { x: -0.5, damage: 10, poison: 0.5, range: 2 }),
    unit("opponent", { x: 0.5, regen: 0.49995 }),
  ]);
  advance(sim, 2);
  assert.deepEqual([sim.units[1]?.health, sim.units[1]?.poisoned], [90, 0.5]);
  advance(sim, 20);
  const target = sim.units[1];
  assert.ok(target);
  assert.deepEqual(
    [target.health, target.poisoned, target.poisonProgress],
    [90.49994659423828, 0, 0],
  );
  advance(sim, 30);
  assert.equal(
    sim.events.some((event) => event.kind === "poison"),
    false,
  );
});
