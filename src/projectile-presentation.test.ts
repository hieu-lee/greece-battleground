import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { createEffectCursor, eventSounds } from "./effects.ts";
import type { Fighter } from "./combat.ts";

function scene(sprite: Fighter["sprite"], cancel = false) {
  const base = {
    name: "Projectile presentation",
    sprite: "hoplite",
    x: 6,
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
  return createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "Projectile presentation",
      fighters: [
        {
          ...base,
          sprite,
          side: "polis",
          x: 0,
          health: cancel ? 1 : 1000,
          damage: 12,
          speed: 1,
          windupPercent: 50,
          range: 20,
        },
        {
          ...base,
          side: "opponent",
          ...(cancel
            ? { damage: 100, speed: 1, windupPercent: 0, range: 20 }
            : {}),
        },
        { ...base, side: "polis", x: -10 },
      ],
    }),
  );
}
function projectiles(combat: ReturnType<typeof scene>) {
  assert.ok(
    "projectiles" in combat,
    "presentation reads the actual simulation projectile state",
  );
  return combat.projectiles;
}
for (const [sprite, held] of [
  ["tracker", true],
  ["peltast", true],
  ["drakon", false],
] as const)
  test(`${sprite} exposes authored held Aim then one separately identified launch and actual flight`, () => {
    const combat = scene(sprite);
    combat.advance();
    const aim = combat.events.find((e) => e.kind === "attack" && e.from === 0);
    assert.ok(aim);
    assert.deepEqual(
      projectiles(combat),
      held ? [{ kind: "held", id: aim.id, from: 0, to: 1 }] : [],
    );
    while (combat.ticks < 11) combat.advance();
    const launched = combat.events.filter((e) => String(e.kind) === "launch");
    assert.deepEqual(
      launched.map(({ id: _id, ...payload }) => payload),
      [
        {
          kind: "launch",
          tick: 11,
          from: 0,
          to: 1,
          projectileId: aim.id,
          effect:
            sprite === "tracker"
              ? "arrow"
              : sprite === "drakon"
                ? "fire"
                : "spear",
          source: { x: 0, y: 0 },
          target: { x: 6, y: 0 },
        },
      ],
    );
    assert.deepEqual(projectiles(combat), [
      {
        kind: "flight",
        id: aim.id,
        from: 0,
        to: 1,
        source: { x: 0, y: 0 },
        position: { x: 0, y: 0 },
        progress: 0,
        heightPerDistance:
          sprite === "tracker"
            ? Math.fround(0.05)
            : sprite === "peltast"
              ? Math.fround(0.2)
              : 0,
      },
    ]);
    while (combat.ticks < 19) combat.advance();
    const snapshot = projectiles(combat);
    assert.ok(Array.isArray(snapshot));
    assert.deepEqual(
      snapshot.map((shot) => {
        if (shot.kind !== "flight") throw Error("Expected flight");
        return [shot.position, shot.progress];
      }),
      [[{ x: 3, y: 0 }, 0.5]],
    );
    while (combat.ticks < 27) combat.advance();
    const remaining = projectiles(combat);
    assert.ok(Array.isArray(remaining));
    assert.equal(
      remaining.some((shot) => shot.id === aim.id),
      false,
    );
    const hit = combat.events.find((e) => e.kind === "impact" && e.from === 0);
    assert.ok(hit && "projectileId" in hit);
    assert.deepEqual([hit.tick, hit.projectileId], [27, aim.id]);
    const cursor = createEffectCursor();
    assert.equal(
      cursor.take(combat.events).filter((e) => String(e.kind) === "launch")
        .length,
      1,
    );
    assert.deepEqual(cursor.take(combat.events), []);
    assert.deepEqual(launched.flatMap(eventSounds), []);
  });

test("cancelled held Aim emits no launch and exposes no orphan projectile", () => {
  const combat = scene("tracker", true);
  combat.advance();
  assert.ok(Array.isArray(projectiles(combat)));
  while (combat.ticks < 12 && !combat.result) combat.advance();
  assert.equal(combat.units[0]?.life.kind, "dead");
  assert.deepEqual(projectiles(combat), []);
  assert.deepEqual(
    combat.events.filter((e) => String(e.kind) === "launch"),
    [],
  );
});
