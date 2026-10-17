import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import type { Fighter } from "./combat.ts";

const base = {
  name: "Aim cancellation",
  sprite: "hoplite",
  x: 5,
  y: 0,
  health: 1000,
  armor: 0,
  damage: 0,
  speed: 0.1,
  windupPercent: 0,
  movement: 0,
  range: 0,
  crit: 0,
  burn: 0,
  ward: 0,
};
function fight(sprite: Fighter["sprite"], stop: boolean) {
  return createCombat(
    battle.parse({
      seed: 1,
      kind: "training",
      opponent: "Aim cancellation",
      fighters: [
        {
          ...base,
          sprite,
          side: "polis",
          x: 0,
          range: 2,
          speed: 1,
          windupPercent: 50,
          damage: 12,
        },
        {
          ...base,
          side: "opponent",
          x: 0.9,
          ...(stop
            ? { sprite: "cyclops", damage: 1, range: 2, stun: 0.05 }
            : { healing: 1, movement: 20, range: 0.1 }),
        },
        { ...base, side: "opponent" },
        { ...base, side: "polis", x: -10, y: 5 },
      ],
    }),
  );
}
for (const sprite of ["tracker", "peltast"] as const) {
  test(`${sprite} Fight exit removes held Aim but preserves independently scheduled release`, () => {
    const combat = fight(sprite, false);
    combat.advance();
    const first = combat.projectiles.find((p) => p.from === 0);
    assert.ok(first && first.kind === "held");
    assert.equal(combat.units[0]?.strike?.at, 11);
    for (const tick of [2, 3, 4]) {
      combat.advance();
      assert.equal(combat.ticks, tick);
      assert.ok(
        combat.units[1]!.x > 1.1,
        "selected living target has left source range",
      );
      assert.equal(
        combat.units[0]?.strike?.at,
        11,
        "ReleaseAim remains pending",
      );
      assert.deepEqual(
        combat.projectiles.filter((p) => p.from === 0),
        [],
        "CancelAim removes the unreleased held weapon",
      );
    }
    while (combat.ticks < 11) combat.advance();
    const launched = combat.projectiles.find((p) => p.id === first.id);
    assert.ok(launched && launched.kind === "flight");
    assert.equal(launched.to, 1);
    assert.equal(
      combat.events.filter((e) => e.kind === "launch" && e.from === 0).length,
      1,
    );
  });
  test(`${sprite} short Stun cancels held Aim permanently while delayed release survives`, () => {
    const combat = fight(sprite, true);
    combat.advance();
    const first = combat.projectiles.find((p) => p.from === 0);
    assert.ok(first && first.kind === "held");
    combat.advance();
    assert.equal(combat.units[0]?.stopped, true);
    assert.deepEqual(
      combat.projectiles.filter((p) => p.from === 0),
      [],
      "Stop exits Fight and removes held Aim immediately",
    );
    combat.advance();
    assert.equal(combat.units[0]?.stopped, false);
    assert.equal(combat.units[0]?.strike?.at, 11);
    assert.deepEqual(
      combat.projectiles.filter((p) => p.from === 0),
      [],
      "returning to Fight cannot resurrect canceled Aim",
    );
    while (combat.ticks < 11) combat.advance();
    const launched = combat.projectiles.find((p) => p.id === first.id);
    assert.ok(launched && launched.kind === "flight");
    assert.equal(launched.to, 1);
  });
}
