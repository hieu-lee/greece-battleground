import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { newGame } from "./game.ts";
import { practiceMatch } from "./warband.ts";
import { buildings } from "./rules.ts";
import { neighbours, sourceMap, tileId } from "./map.ts";

const origin = tileId.parse(21);
const other = tileId.parse(22);
function encounter({
  speed = 1,
  duration = 0.25,
  repeats = 1,
  frost = 0,
  health = 100000,
  revive = 0,
  enemySpeed = 0.1,
  enemyWindup = 0,
  enemyDamage = 0,
  companions = true,
} = {}) {
  const unit = {
    name: "Haste boundary contract",
    sprite: "hoplite",
    x: -1,
    y: 0,
    health: 100000,
    armor: 0,
    damage: 0,
    speed: 2.5,
    speedStat: { basis: 2, multiply: 1.25 },
    windupPercent: 0,
    movement: 3,
    range: 6,
    crit: 0,
    burn: 0,
    ward: 0,
  };
  return createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Current source Haste contract",
      horns: Array.from({ length: repeats }, () => ({
        side: "polis",
        speed,
        duration,
        targets: [origin],
      })),
      fighters: [
        {
          ...unit,
          side: "polis",
          origin: { side: "polis", tile: origin },
          health,
          revive,
        },
        ...(companions
          ? [
              {
                ...unit,
                side: "polis",
                origin: { side: "polis", tile: other },
                y: 3,
              },
            ]
          : []),
        {
          ...unit,
          side: "opponent",
          origin: { side: "opponent", tile: origin },
          x: 1,
          speed: enemySpeed,
          speedStat: { basis: enemySpeed, multiply: 1 },
          frost,
          movement: 0,
          windupPercent: enemyWindup,
          damage: enemyDamage,
        },
      ],
    }),
  );
}
function advance(combat: ReturnType<typeof createCombat>, until: number) {
  while (combat.ticks < until && !combat.result) combat.advance();
}

test("actual deployed Conches carry their level, adjacent Divine cadence and exact Unit origins into practice", () => {
  const game = newGame(42);
  const chief = game.placements[0];
  assert.ok(chief);
  const conch = game.owned.find(
    (t) =>
      t !== chief.tile &&
      neighbours(t).every(
        (n) => sourceMap(game.seed).tiles[n]?.feature !== "circle-of-stone",
      ),
  );
  assert.ok(conch !== undefined);
  const shrine = neighbours(conch).find(
    (t) => game.owned.includes(t) && t !== chief.tile,
  );
  assert.ok(shrine !== undefined);
  game.placements.push({
    tile: shrine,
    id: "altar-of-kings",
    level: 1,
    workers: 0,
    rune: null,
  });
  assert.equal(buildings["tritons-conch"].available, true);
  for (const [level, speed] of [
    [1, 0.13750000298023224],
    [2, 0.15000000596046448],
    [3, 0.16249999403953552],
  ] as const) {
    game.placements.push({
      tile: conch,
      id: "tritons-conch",
      level,
      workers: 0,
      rune: null,
    });
    assert.deepEqual(practiceMatch(game).horns, [
      { side: "polis", speed, duration: level, targets: [chief.tile] },
    ]);
    game.placements.pop();
  }
});

test("Haste waits for strict binary32 threshold, then preserves controller timer overshoot", () => {
  const combat = encounter({ speed: 20, duration: 1 });
  combat.advance();
  assert.equal(combat.units[0]?.hasted, 0);
  combat.advance();
  assert.equal(combat.units[0]?.hasted, 1);
  assert.equal(combat.units[0]?.speed, 4.5);
  combat.advance();
  assert.equal(combat.units[0]?.hasted, 1.9500000476837158);
  assert.equal(combat.units[0]?.speed, 4.5);
});

test("two Horns extend one Haste timer without stacking its APS operand or changing source steering", () => {
  const combat = encounter({ duration: 2, repeats: 2 });
  advance(combat, 20);
  assert.equal(combat.units[0]?.hasted, 4);
  assert.equal(combat.units[0]?.speed, 4.5);
  assert.equal(combat.units[0]?.movement, 3);
  assert.equal(combat.units[1]?.hasted, 0);
  assert.equal(combat.units[2]?.hasted, 0);
  combat.advance();
  assert.equal(combat.units[0]?.hasted, 3.950000047683716);
  assert.equal(combat.units[0]?.speed, 4.5);
});

test("Haste joins Frost's ordered APS multiply list and expiry preserves existing slows", () => {
  const combat = encounter({ frost: 25 });
  advance(combat, 19);
  assert.equal(combat.units[0]?.speed, 2.200000047683716);
  combat.advance();
  assert.equal(combat.units[0]?.hasted, 0.25);
  assert.equal(combat.units[0]?.speed, 4.199999809265137);
  advance(combat, 26);
  assert.equal(combat.units[0]?.hasted, 0);
  assert.equal(combat.units[0]?.speed, 2.200000047683716);
});

test("unexpired Haste and its ticking timer survive revival; true death cancels its contribution", () => {
  const combat = encounter({
    speed: 0.125,
    duration: 6,
    health: 1,
    revive: 1,
    enemySpeed: 0.125,
    enemyWindup: 100,
    enemyDamage: 1,
    companions: false,
  });
  const life = () => combat.units[0]?.life.kind;
  advance(combat, 160);
  assert.equal(combat.units[0]?.hasted, 6);
  advance(combat, 162);
  assert.equal(life(), "reviving");
  assert.ok(
    (combat.units[0]?.hasted ?? 0) > 5.8 && (combat.units[0]?.hasted ?? 0) < 6,
  );
  advance(combat, 222);
  assert.equal(life(), "alive");
  assert.ok(
    (combat.units[0]?.hasted ?? 0) > 2.8 &&
      (combat.units[0]?.hasted ?? 0) < 3.1,
  );
  assert.equal(combat.units[0]?.speed, 4.5);
  advance(combat, 500);
  assert.equal(life(), "dead");
  assert.equal(combat.units[0]?.hasted, 0);
  assert.equal(combat.units[0]?.speed, 2.5);
});

test("Haste controller rejects values whose reciprocal or duration vanish in binary32", () => {
  const base = practiceMatch(newGame(42));
  assert.equal(battle.safeParse(base).success, true);
  for (const [speed, duration] of [
    [Number.MIN_VALUE, 1],
    [1, Number.MIN_VALUE],
    [0, 1],
    [1, 0],
  ])
    assert.equal(
      battle.safeParse({
        ...base,
        horns: [{ side: "polis", speed, duration, targets: [origin] }],
      }).success,
      false,
    );
});
