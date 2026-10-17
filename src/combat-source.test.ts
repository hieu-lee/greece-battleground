import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import type { Fighter } from "./combat.ts";

function unit(side: Fighter["side"], changes: Partial<Fighter> = {}): Fighter {
  return {
    name: side,
    sprite: "hoplite",
    side,
    origin: null,
    x: side === "polis" ? -1 : 1,
    y: 0,
    health: 20,
    armor: 0,
    damage: 0,
    damageStat: "attack",
    piercing: false,
    damageReduction: 0,
    speed: 0.1,
    windupPercent: 0,
    movement: 0,
    // Source units: 6 is 3 arena units, so the duel at centre distance 2 stays in range.
    range: 6,
    crit: 0,
    burn: 0,
    ward: 0,
    regen: 0,
    criticalGrowth: 0,
    ...changes,
  };
}
function deployment(value: Fighter) {
  const { damageStat, piercing, damageReduction, ...rest } = value;
  return {
    ...rest,
    ...(damageStat === "attack" ? {} : { damageStat }),
    ...(piercing ? { piercing } : {}),
    ...(damageReduction === 0 ? {} : { damageReduction }),
  };
}
function duel(
  attacker: Partial<Fighter>,
  target: Partial<Fighter> = {},
  seed = 42,
) {
  return createCombat(
    battle.parse({
      seed,
      kind: "training",
      opponent: "Source math regression",
      fighters: [
        deployment(unit("polis", attacker)),
        deployment(unit("opponent", target)),
      ],
    }),
  );
}

// Literal outcomes from the locked demo111 native vectors; no Unity RNG claim.
const healthCases: {
  name: string;
  attacker: Partial<Fighter>;
  target?: Partial<Fighter>;
  expected: [number, number, number, number];
}[] = [
  { name: "ordinary Armor", attacker: { damage: 3 }, expected: [20, 2, 0, 3] },
  {
    name: "critical before Armor",
    attacker: { damage: 3, crit: 100 },
    expected: [19, 0, 0, 6],
  },
  {
    name: "Ward before full reduction and crit",
    attacker: { damage: 3, crit: 100 },
    target: { ward: 1, damageReduction: 100 },
    expected: [20, 5, 0, 0],
  },
  {
    name: "zero preserves Ward",
    attacker: { damage: 0, crit: 100 },
    target: { ward: 1 },
    expected: [20, 5, 1, 0],
  },
  {
    name: "reduction then crit then Armor",
    attacker: { damage: 3, crit: 100 },
    target: { damageReduction: 25 },
    expected: [20, 0.5, 0, 4.5],
  },
  {
    name: "piercing Attack bypasses Armor",
    attacker: { damage: 3, piercing: true },
    expected: [17, 5, 0, 3],
  },
  {
    name: "piercing Fire consumes Armor",
    attacker: { damage: 3, damageStat: "fire", piercing: true },
    expected: [20, 2, 0, 3],
  },
  {
    name: "piercing Thorn consumes Armor",
    attacker: { damage: 3, damageStat: "thorn", piercing: true },
    expected: [20, 2, 0, 3],
  },
  {
    name: "piercing Poison bypasses Armor",
    attacker: { damage: 3, damageStat: "poison", piercing: true },
    expected: [17, 5, 0, 3],
  },
  {
    name: "Ward blocks piercing Frost",
    attacker: { damage: 3, damageStat: "frost", piercing: true },
    target: { ward: 1 },
    expected: [20, 5, 0, 0],
  },
  {
    name: "unrecognized Health change skips Ward and reduction",
    attacker: { damage: 3, damageStat: "health" },
    target: { ward: 1, damageReduction: 100 },
    expected: [20, 2, 1, 3],
  },
  {
    name: "fractional binary32 callback loss",
    attacker: { damage: 0.20000000298023224 },
    target: { health: 1, armor: 0.10000000149011612 },
    expected: [0.8999999761581421, 0, 0, 0.20000001788139343],
  },
  {
    name: "overkill reports depleted pools",
    attacker: { damage: 5 },
    target: { health: 2, armor: 0 },
    expected: [0, 0, 0, 2],
  },
  {
    name: "above-full reduction clamps to 100 percent",
    attacker: { damage: 3, crit: 100 },
    target: { damageReduction: 150 },
    expected: [20, 5, 0, 0],
  },
  {
    name: "full reduction preserves pools without Ward",
    attacker: { damage: 3, crit: 100 },
    target: { damageReduction: 100 },
    expected: [20, 5, 0, 0],
  },
];
for (const entry of healthCases) {
  test(`source111 signed Health path: ${entry.name}`, () => {
    const sim = duel(entry.attacker, { armor: 5, ...entry.target });
    sim.advance();
    sim.advance();
    const target = sim.units[1];
    const impact = sim.events.find((e) => e.kind === "impact" && e.from === 0);
    assert.ok(target && impact?.kind === "impact");
    assert.deepEqual(
      [target.health, target.armor, target.ward, impact.damage],
      entry.expected,
    );
  });
}

for (const entry of [
  {
    name: "zero chance and zero roll",
    seed: 634785765,
    chance: 0,
    critical: true,
    health: 18,
  },
  {
    name: "chance equals rounded roll",
    seed: 3633722215,
    chance: 10,
    critical: true,
    health: 18,
  },
  {
    name: "roll above chance",
    seed: 1428358656,
    chance: 10,
    critical: false,
    health: 19,
  },
  {
    name: "100 percent rounded endpoint",
    seed: 653637408,
    chance: 100,
    critical: true,
    health: 18,
  },
]) {
  test(`inclusive crit comparison with provisional LCG: ${entry.name}`, () => {
    const sim = duel({ damage: 1, crit: entry.chance }, {}, entry.seed);
    sim.advance();
    sim.advance();
    const impact = sim.events.find((e) => e.kind === "impact" && e.from === 0);
    assert.ok(impact?.kind === "impact");
    assert.deepEqual(
      [impact.critical, sim.units[1]?.health],
      [entry.critical, entry.health],
    );
  });
}

for (const entry of [
  { stacks: 10, remaining: 8 },
  { stacks: 4, remaining: 3.200000047683716 },
  { stacks: 0.009999999776482582, remaining: 0.007999999448657036 },
]) {
  test(`source111 Burn decay for ${entry.stacks} stacks`, () => {
    const sim = duel({ burn: entry.stacks }, { damageReduction: 100 });
    for (let tick = 0; tick < 21; tick++) sim.advance();
    assert.equal(sim.units[1]?.burning, entry.stacks);
    assert.equal(
      sim.events.some((e) => e.kind === "burn"),
      false,
    );
    sim.advance();
    const burn = sim.events.find((e) => e.kind === "burn");
    assert.ok(burn?.kind === "burn");
    assert.deepEqual(
      [burn.tick, burn.amount, sim.units[1]?.burning],
      [22, 0, entry.remaining],
    );
  });
}

test("Burn starts at its application time; added stacks preserve fractional progress", () => {
  const sim = duel({ burn: 4, speed: 1.5, windupPercent: 22 }, { ward: 1 });
  for (let tick = 0; tick < 23; tick++) sim.advance();
  assert.equal(
    sim.events.some((e) => e.kind === "burn"),
    false,
  );
  assert.equal(sim.units[1]?.burning, 8);
  sim.advance();
  const burn = sim.events.find((e) => e.kind === "burn");
  assert.ok(burn?.kind === "burn");
  assert.deepEqual(
    [burn.tick, burn.blocked, burn.amount, sim.units[1]?.burning],
    [24, true, 0, 6.400000095367432],
  );
});

test("Burn removes small sources after its delta update and resets a later source timer", () => {
  const sim = duel({ burn: 0.00009999999747378752, speed: 2 });
  sim.advance();
  sim.advance();
  assert.equal(sim.units[1]?.burning, 0.00009999999747378752);
  sim.advance();
  assert.deepEqual([sim.units[1]?.burning, sim.units[1]?.burnProgress], [0, 0]);
  for (let tick = 3; tick < 12; tick++) sim.advance();
  assert.deepEqual(
    [sim.units[1]?.burning, sim.units[1]?.burnProgress],
    [0.00009999999747378752, 0],
  );
  sim.advance();
  assert.equal(sim.units[1]?.burning, 0);
  assert.equal(
    sim.events.some((e) => e.kind === "burn"),
    false,
  );
});

test("Burn event reports actual overkill loss instead of attempted stack damage", () => {
  const sim = duel({ burn: 10 }, { health: 2, armor: 1 });
  for (let tick = 0; tick < 22; tick++) sim.advance();
  const burn = sim.events.find((e) => e.kind === "burn");
  assert.ok(burn?.kind === "burn");
  assert.deepEqual(
    [burn.amount, sim.units[1]?.health, sim.units[1]?.armor],
    [3, 0, 0],
  );
});

test("regeneration uses signed binary32 Health arithmetic and reports the native combined-pool callback", () => {
  for (const vector of [
    {
      armor: 0,
      regen: 0.10000000149011612,
      at20: 0.9000000357627869,
      callback: [0.10000002384185791],
      at60: 1,
    },
    {
      armor: 100_000,
      regen: 0.10000000149011612,
      at20: 0.9000000357627869,
      callback: [0.1015625],
      at60: 1,
    },
    {
      armor: 100_000,
      regen: 0.000009999999747378752,
      at20: 0.8000100255012512,
      callback: [],
      at60: 0.8000300526618958,
    },
  ]) {
    const sim = duel(
      { damage: 0.20000000298023224, piercing: true },
      { health: 1, armor: vector.armor, regen: vector.regen },
    );
    for (let tick = 0; tick < 20; tick++) sim.advance();
    assert.deepEqual(
      [
        sim.units[1]?.health,
        sim.units[1]?.armor,
        sim.events
          .filter((event) => event.kind === "heal")
          .map((event) => event.amount),
      ],
      [vector.at20, vector.armor, vector.callback],
    );
    for (let tick = 20; tick < 60; tick++) sim.advance();
    assert.equal(sim.units[1]?.health, vector.at60);
  }
});

test("source111 requested windups use current APS, binary32 stages, nearest milliseconds and the minimum delay", () => {
  for (const [sprite, speed, windupPercent, seconds, contactTick] of [
    ["hoplite", 0.8, 50, 0.625, 14],
    ["tracker", 0.6, 50, 0.833, 18],
    ["aegeus", 0.65, 15, 0.231, 6],
    ["atalanta", 0.9, 15, 0.167, 5],
    ["peltast", 0.4, 30, 0.75, 16],
    ["hypaspist", 0.4, 32, 0.8, 17],
    ["peripolos", 0.6000000238418579, 50, 0.833, 18],
    ["misthophoros", 0.6499999761581421, 20, 0.308, 8],
    ["peltast", 100, 30, 0.05, 2],
    ["hypaspist", 3, 32, 0.107, 4],
    ["hoplite", 1, 0, 0.05, 2],
    // Locked native scalar reconstruction: double-only arithmetic requests 50ms here.
    ["aegeus", 2.97029709815979, 15, 0.051, 3],
  ] as const) {
    const sim = duel({ sprite, speed, windupPercent, damage: 1 });
    sim.advance();
    const attack = sim.events.find(
      (event) => event.kind === "attack" && event.from === 0,
    );
    assert.ok(attack?.kind === "attack");
    assert.equal(
      attack.windup,
      seconds,
      `${sprite} APS=${speed}: requested delay`,
    );
    assert.equal(
      sim.units[0]?.windupSeconds,
      seconds,
      "Renderer and receipt use the same requested seconds",
    );
    const arrivalTick =
      contactTick + (sprite === "tracker" || sprite === "peltast" ? 6 : 0);
    for (let tick = 1; tick < arrivalTick - 1; tick++) sim.advance();
    assert.equal(
      sim.units[1]?.health,
      20,
      "Fixed-step scheduling cannot contact before its rounded-up request",
    );
    sim.advance();
    const impact = sim.events.find(
      (event) => event.kind === "impact" && event.from === 0,
    );
    assert.ok(impact?.kind === "impact");
    assert.deepEqual([impact.tick, sim.units[1]?.health], [arrivalTick, 19]);
  }
});
