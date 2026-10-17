import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { newGame } from "./game.ts";
import { practiceMatch } from "./warband.ts";
import { neighbours } from "./map.ts";

const base = {
  name: "Cleave contract",
  sprite: "hoplite",
  side: "opponent",
  x: 0,
  y: 0,
  health: 100,
  armor: 0,
  damage: 0,
  speed: 0.1,
  windupPercent: 100,
  movement: 0,
  range: 20,
  crit: 0,
  burn: 0,
  ward: 0,
};
function duel(
  attacker: Record<string, unknown> = {},
  targets: Record<string, unknown>[] = [
    {},
    { x: 0.75 },
    { x: -0.75 },
    { y: 1.5 },
  ],
) {
  return createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Cleave source contract",
      fighters: [
        {
          ...base,
          side: "polis",
          y: -3,
          damage: 10,
          speed: 1,
          windupPercent: 0,
          cleave: 1,
          ...attacker,
        },
        ...targets.map((t) => ({ ...base, ...t })),
      ],
    }),
  );
}
function advance(c: ReturnType<typeof createCombat>, ticks: number) {
  while (c.ticks < ticks && !c.result) c.advance();
}
function impacts(c: ReturnType<typeof createCombat>) {
  return c.events
    .filter((e) => e.kind === "impact")
    .filter((e) => e.from === 0 && !e.reflection);
}

test("deployed troop base, Forge and Cleave Charms compose into the actual battle", () => {
  const game = newGame(42);
  const chief = game.placements[0]!;
  chief.rune = "achilles-charge";
  const forge = neighbours(chief.tile).find((t) => game.owned.includes(t));
  assert.ok(forge !== undefined);
  game.placements.push({
    tile: forge,
    id: "hephaestus-forge",
    level: 3,
    workers: 0,
    rune: null,
  });
  assert.equal(
    practiceMatch(game).fighters.find((f) => f.origin?.tile === chief.tile)
      ?.cleave,
    6,
  );
  chief.rune = "in-the-heros-wake";
  assert.equal(
    practiceMatch(game).fighters.find((f) => f.origin?.tile === chief.tile)
      ?.cleave,
    5,
  );
  const tile = game.owned.find(
    (t) => t !== chief.tile && t !== forge && !neighbours(forge).includes(t),
  );
  assert.ok(tile !== undefined);
  game.placements.push({
    tile,
    id: "gigantes-camp",
    level: 1,
    workers: 1,
    rune: "heracles-great-swing",
  });
  assert.equal(
    practiceMatch(game).fighters.find((f) => f.origin?.tile === tile)?.cleave,
    4,
  );
});

test("Cleave rounds counts to even, selects nearest to primary within radius, and does not recurse", () => {
  for (const [cleave, expected] of [
    [0.5, [1]],
    [1.5, [1, 2, 3]],
    [2.5, [1, 2, 3]],
  ] as const) {
    const c = duel({ cleave });
    advance(c, 2);
    assert.deepEqual(
      impacts(c).map((e) => [e.to, e.damage]),
      expected.map((id) => [id, id === 1 ? 10 : 5]),
    );
    assert.equal(c.units[4]?.health, 100);
  }
});

test("the source three-element sort can reverse equal-distance candidates around a nearer target", () => {
  const c = duel({ cleave: 2 }, [{}, { x: 1 }, { x: -1 }, { y: 0.5 }]);
  advance(c, 2);
  assert.deepEqual(
    impacts(c).map((e) => e.to),
    [1, 4, 3],
  );
  assert.equal(c.units[2]?.health, 100);
});

test("secondary health scales the original base before one critical and recipient reduction/armor", () => {
  const c = duel({ damage: 11, crit: 100, cleave: 2, criticalGrowth: 7 }, [
    { ward: 1 },
    { x: 0.75, armor: 4 },
    { x: -0.75, damageReduction: 50 },
  ]);
  advance(c, 2);
  assert.deepEqual(
    impacts(c).map((e) => [e.to, e.damage, e.critical, e.blocked]),
    [
      [1, 0, true, true],
      [2, 12, true, false],
      [3, 6, true, false],
    ],
  );
  assert.deepEqual(
    c.units.slice(1).map((u) => [u.health, u.armor]),
    [
      [100, 0],
      [92, 0],
      [94, 0],
    ],
  );
  assert.equal(c.units[0]?.damage, 18);
});

test("zero health change still spreads positive statuses, upward scaled even through Ward", () => {
  const c = duel({ damage: 0, burn: 3, poison: 5, frost: 25, stun: 0.4 }, [
    { ward: 1 },
    { x: 0.75, ward: 1 },
    { x: -0.75 },
  ]);
  advance(c, 2);
  assert.deepEqual(
    c.units
      .slice(1)
      .map((u) => [u.burning, u.poisoned, u.frostStacks, u.stunned]),
    [
      [3, 5, 25, Math.fround(0.4)],
      [2, 3, 13, 1],
      [0, 0, 0, 0],
    ],
  );
  assert.equal(c.units[2]?.ward, 1);
});

test("projectile Frost runs generic primary, secondary Cleave, then dedicated primary Frost", () => {
  const c = duel({ sprite: "tracker", frost: 25 });
  advance(c, 10);
  assert.deepEqual(
    c.units.slice(1).map((u) => u.frostStacks),
    [50, 13, 0, 0],
  );
  assert.deepEqual(
    c.events.filter((e) => e.kind === "frost").map((e) => [e.unit, e.amount]),
    [
      [1, 25],
      [2, 13],
      [1, 25],
    ],
  );
});

test("projectile Frost's dedicated pass reaches a primary that just entered revival", () => {
  const c = duel({ sprite: "tracker", frost: 25, cleave: 0 }, [
    { health: 1, revive: 1 },
    { x: 0.75, health: 1000 },
  ]);
  advance(c, 10);
  assert.equal(c.units[1]?.life.kind, "reviving");
  assert.equal(c.units[1]?.frostStacks, 50);
  assert.deepEqual(
    c.events.filter((e) => e.kind === "frost").map((e) => [e.unit, e.amount]),
    [
      [1, 25],
      [1, 25],
    ],
  );
});

test("a reviving nearest Cleave recipient consumes the slot and receives statuses through invincibility", () => {
  const c = createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Reviving Cleave recipient",
      fighters: [
        {
          ...base,
          side: "polis",
          y: -3,
          damage: 10,
          speed: 1,
          windupPercent: 10,
          cleave: 1,
          burn: 3,
        },
        {
          ...base,
          side: "polis",
          x: 0.75,
          y: -1,
          damage: 10,
          speed: 1,
          windupPercent: 0,
        },
        { ...base, health: 1000 },
        { ...base, x: 0.75, health: 1, revive: 1 },
        { ...base, x: -1.1, health: 1000 },
      ],
    }),
  );
  advance(c, 3);
  assert.equal(c.units[3]?.life.kind, "reviving");
  assert.equal(c.units[3]?.health, 0);
  assert.equal(c.units[3]?.burning, 2);
  assert.equal(c.units[4]?.health, 1000);
  assert.equal(c.units[4]?.burning, 0);
  assert.deepEqual(
    impacts(c).map((e) => [e.to, e.damage, e.blocked]),
    [
      [2, 10, false],
      [3, 0, true],
    ],
  );
});

test("healing Cleave restores positive Health during revival without ending or rescheduling it", () => {
  for (const [crit, expected] of [
    [0, 5],
    [100, 10],
  ] as const) {
    const c = createCombat(
      battle.parse({
        seed: 42,
        kind: "training",
        opponent: "Reviving heal recipient",
        fighters: [
          {
            ...base,
            side: "polis",
            x: -3,
            healing: 10,
            speed: 20,
            windupPercent: 0,
            cleave: 1,
            crit,
            burn: 3,
            frost: 25,
          },
          { ...base, side: "polis", health: 1000 },
          { ...base, side: "polis", x: 0.75, revive: 1 },
          { ...base, y: -3, damage: 200, cleave: 1, windupPercent: 0 },
        ],
      }),
    );
    advance(c, 4);
    assert.equal(c.units[2]?.health, expected);
    assert.deepEqual(c.units[2]?.life, { kind: "reviving", restoreAt: 62 });
    assert.equal(c.units[2]?.currentRevives, 0);
    assert.equal(c.units[2]?.burning, 0);
    assert.equal(c.units[2]?.frostStacks, 0);
    assert.ok(
      c.events.some(
        (e) => e.kind === "heal" && e.unit === 2 && e.amount === expected,
      ),
    );
  }
});

test("secondary nonprojectile hits reflect Thorn and finish their selected queue after sender death", () => {
  const c = duel(
    { sprite: "tracker", health: 4, damage: 4, cleave: 2, killInsight: 3 },
    [{ thorn: 100 }, { x: 0.75, thorn: 5 }, { x: -0.75, health: 2 }],
  );
  advance(c, 10);
  assert.equal(c.units[0]?.life.kind, "dead");
  assert.deepEqual(
    impacts(c).map((e) => [e.to, e.damage]),
    [
      [1, 4],
      [2, 2],
      [3, 2],
    ],
  );
  assert.equal(c.result?.insight, 3);
  assert.deepEqual(
    c.events
      .filter((e) => e.kind === "impact")
      .filter((e) => e.reflection)
      .map((e) => e.from),
    [2],
  );
});

test("healing Cleave selects injured primary-team allies, excludes healer and applies no damage statuses", () => {
  const c = createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Healing Cleave",
      fighters: [
        {
          ...base,
          side: "polis",
          x: -3,
          healing: 10,
          speed: 20,
          windupPercent: 0,
          cleave: 1,
          burn: 3,
          frost: 25,
        },
        { ...base, side: "polis" },
        { ...base, side: "polis", x: 0.75 },
        { ...base, y: -3, damage: 20, cleave: 1, windupPercent: 0 },
      ],
    }),
  );
  advance(c, 4);
  assert.deepEqual(
    c.units.slice(0, 3).map((u) => u.health),
    [100, 90, 95],
  );
  assert.deepEqual(
    c.events.filter((e) => e.kind === "heal").map((e) => [e.unit, e.amount]),
    [
      [1, 10],
      [2, 5],
    ],
  );
  assert.deepEqual(
    c.units.slice(1, 3).map((u) => [u.burning, u.frostStacks]),
    [
      [0, 0],
      [0, 0],
    ],
  );
});
