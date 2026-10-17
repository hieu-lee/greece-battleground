import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { fates } from "./rules.ts";

const base = {
  name: "Signed UnitHit contract",
  sprite: "hoplite",
  side: "polis",
  x: 0,
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
const tower = {
  item: "thunderbolt-of-zeus",
  side: "opponent",
  origin: { side: "opponent", tile: 21 },
  x: 1,
  y: 0,
  speed: 10,
  count: 1,
  damage: 5,
  burn: 0,
  poison: 0,
  frost: 0,
};
type StruckFate = "blood-of-ares" | "heracles-resolve";
function receiver(id: StruckFate, extra: Record<string, unknown> = {}) {
  return { ...base, triggers: fates[id].triggers, ...extra };
}
function fight(
  target: Record<string, unknown>,
  attacker: Record<string, unknown> = {},
  towers: Record<string, unknown>[] = [],
) {
  return createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "Signed source UnitHit",
      towers,
      fighters: [
        target,
        {
          ...base,
          side: "opponent",
          x: 1,
          damage: 5,
          range: 20,
          windupPercent: 0,
          ...attacker,
        },
      ],
    }),
  );
}
function incoming(
  mode: "unit" | "tower",
  id: StruckFate,
  target: Record<string, unknown>,
  damage: number,
  statuses = {},
) {
  return mode === "unit"
    ? fight(receiver(id, target), { damage, ...statuses })
    : fight(receiver(id, target), { range: 0, damage: 0 }, [
        { ...tower, damage, ...statuses },
      ]);
}
function advance(c: ReturnType<typeof createCombat>, ticks: number) {
  while (c.ticks < ticks && !c.result) c.advance();
}
const grants = (c: ReturnType<typeof createCombat>) => [
  c.units[0]?.damage,
  c.units[0]?.armor,
  c.units[0]?.maximumArmor,
];

for (const id of ["blood-of-ares", "heracles-resolve"] as const) {
  test(`${id}: zero Unit or Thunderbolt health results do not count as struck`, () => {
    for (const mode of ["unit", "tower"] as const) {
      const c = incoming(mode, id, {}, 0, { burn: 3, frost: 25 });
      advance(c, mode === "unit" ? 2 : 4);
      assert.deepEqual(grants(c), [0, 0, 0]);
      assert.equal(c.units[0]?.health, 1000);
      assert.equal(c.units[0]?.burning, 3);
      assert.equal(c.units[0]?.frostStacks, 25);
    }
  });

  test(`${id}: Ward and complete reduction block struck grants from Unit and Tower hits`, () => {
    for (const mode of ["unit", "tower"] as const)
      for (const protection of [{ ward: 1 }, { damageReduction: 100 }]) {
        const c = incoming(mode, id, protection, 5);
        advance(c, mode === "unit" ? 2 : 4);
        assert.deepEqual(grants(c), [0, 0, 0]);
        assert.equal(c.units[0]?.health, 1000);
        assert.equal(c.units[0]?.ward, 0);
        const hit = c.events.find((e) => e.kind === "impact" && e.to === 0);
        assert.ok(hit?.kind === "impact");
        assert.equal(hit.damage, 0);
      }
  });

  test(`${id}: negative Unit and Tower Health or Armor results grant exactly once and preserve receipts`, () => {
    for (const mode of ["unit", "tower"] as const)
      for (const row of [
        {
          armor: 0,
          health: 995,
          blood: [3, 0, 0],
          heracles: [0, 0, 10],
          absorbed: 0,
        },
        {
          armor: 12,
          health: 1000,
          blood: [3, 7, 12],
          heracles: [0, 7, 22],
          absorbed: 5,
        },
      ]) {
        const c = incoming(mode, id, { armor: row.armor }, 5);
        advance(c, mode === "unit" ? 2 : 4);
        assert.deepEqual(
          grants(c),
          id === "blood-of-ares" ? row.blood : row.heracles,
        );
        assert.equal(c.units[0]?.health, row.health);
        const hit = c.events.find((e) => e.kind === "impact" && e.to === 0);
        assert.ok(hit?.kind === "impact");
        assert.deepEqual([hit.damage, hit.armorDamage], [5, row.absorbed]);
      }
  });

  test(`${id}: the hit entering revival grants once; a later invincible Tower impact grants nothing`, () => {
    const c = fight(receiver(id, { health: 1, revive: 1 }), { damage: 1 }, [
      { ...tower, frost: 25 },
    ]);
    advance(c, 2);
    assert.deepEqual(c.units[0]?.life, { kind: "reviving", restoreAt: 62 });
    assert.deepEqual(
      grants(c),
      id === "blood-of-ares" ? [3, 0, 0] : [0, 0, 10],
    );
    advance(c, 4);
    assert.deepEqual(
      grants(c),
      id === "blood-of-ares" ? [3, 0, 0] : [0, 0, 10],
    );
    assert.deepEqual(c.units[0]?.life, { kind: "reviving", restoreAt: 62 });
    assert.equal(c.units[0]?.currentRevives, 0);
    assert.equal(c.units[0]?.frostStacks, 25);
    assert.equal(c.units[0]?.health, 0);
  });
}

for (const status of ["burn", "poison"] as const) {
  test(`negative ${status} ticks count as struck once at the shared health gateway`, () => {
    const c = fight(receiver("blood-of-ares"), { damage: 1, [status]: 3 });
    advance(c, 2);
    assert.equal(c.units[0]?.damage, 3);
    advance(c, 22);
    assert.equal(c.units[0]?.health, 996);
    assert.equal(c.units[0]?.damage, 6);
    assert.equal(
      c.events.filter((e) => e.kind === status && e.unit === 0).length,
      1,
    );
  });
}

test("reflection grants struck exactly once for negative pools, never through Ward, with pre-grant Armor receipts", () => {
  for (const row of [
    {
      id: "blood-of-ares",
      armor: 0,
      ward: 0,
      health: 998,
      remaining: 0,
      damage: 4,
      absorbed: 0,
    },
    {
      id: "blood-of-ares",
      armor: 0,
      ward: 1,
      health: 1000,
      remaining: 0,
      damage: 1,
      absorbed: 0,
    },
    {
      id: "heracles-resolve",
      armor: 10,
      ward: 0,
      health: 1000,
      remaining: 8,
      damage: 1,
      absorbed: 2,
    },
    {
      id: "heracles-resolve",
      armor: 10,
      ward: 1,
      health: 1000,
      remaining: 10,
      damage: 1,
      absorbed: 0,
    },
  ] as const) {
    const c = fight(
      receiver(row.id, {
        damage: 1,
        range: 20,
        windupPercent: 0,
        armor: row.armor,
        ward: row.ward,
      }),
      { damage: 0, range: 0, thorn: 2 },
    );
    advance(c, 2);
    assert.deepEqual(
      [
        c.units[0]?.health,
        c.units[0]?.armor,
        c.units[0]?.damage,
        c.units[0]?.ward,
      ],
      [row.health, row.remaining, row.damage, 0],
    );
    const reflection = c.events.find(
      (e) => e.kind === "impact" && e.reflection,
    );
    assert.ok(reflection?.kind === "impact");
    assert.equal(reflection.armorDamage, row.absorbed);
    assert.equal(reflection.blocked, row.ward > 0);
  }
});
