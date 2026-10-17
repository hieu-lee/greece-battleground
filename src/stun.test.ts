import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { newGame } from "./game.ts";
import { warband } from "./warband.ts";

function duel({
  ward = 0,
  speed = 100,
  windupPercent = 0,
  attackers = 1,
  movement = 0,
  range = 6,
  stun = 0.4000000059604645,
  targetHealth = 100,
  revive = 0,
} = {}) {
  const unit = {
    name: "Stun contract",
    sprite: "hoplite",
    x: -1,
    y: 0,
    health: 100,
    armor: 0,
    damage: 1,
    speed: 0.1,
    windupPercent: 0,
    movement: 0,
    range: 6,
    crit: 0,
    burn: 0,
    ward: 0,
    regen: 0,
    criticalGrowth: 0,
  };
  return createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Ordinary Stun source contract",
      fighters: [
        ...Array.from({ length: attackers }, (_, index) => ({
          ...unit,
          sprite: "cyclops",
          side: "polis",
          y: index * 2,
          stun,
        })),
        {
          ...unit,
          x: 1,
          side: "opponent",
          ward,
          speed,
          windupPercent,
          movement,
          range,
          health: targetHealth,
          revive,
        },
      ],
    }),
  );
}

test("ordinary deployed Cyclopes retain 0.4 seconds of Stun at every camp level", () => {
  const game = newGame(42);
  const tile = game.owned.find((id) => id !== game.placements[0]?.tile);
  assert.ok(tile !== undefined);
  for (const level of [1, 2, 3] as const) {
    game.placements.push({
      tile,
      id: "gigantes-camp",
      level,
      workers: 0,
      rune: null,
    });
    const cyclops = warband(game, "polis").find(
      (unit) => unit.sprite === "cyclops",
    );
    assert.equal(cyclops?.stun, 0.4000000059604645);
    game.placements.pop();
  }
});

test("Ward absorbs the hit while Stun suppresses new attacks until binary32 timer expiry", () => {
  const combat = duel({ ward: 1 });
  combat.advance();
  combat.advance();
  assert.deepEqual(
    [combat.units[1]?.health, combat.units[1]?.ward, combat.units[1]?.stunned],
    [100, 0, 0.4000000059604645],
  );
  assert.deepEqual(
    combat.events
      .filter((event) => event.kind === "stun")
      .map((event) => ({
        tick: event.tick,
        unit: event.unit,
        amount: event.amount,
      })),
    [{ tick: 2, unit: 1, amount: 0.4000000059604645 }],
  );
  for (let tick = 3; tick <= 9; tick++) {
    combat.advance();
    assert.ok(
      (combat.units[1]?.stunned ?? 0) > 0,
      `Still stunned on tick ${tick}`,
    );
  }
  assert.deepEqual(
    combat.events
      .filter((event) => event.kind === "attack" && event.from === 1)
      .map((event) => event.tick),
    [1],
  );
  combat.advance();
  assert.equal(combat.units[1]?.stunned, 0);
  combat.advance();
  assert.ok(
    combat.events.some(
      (event) =>
        event.kind === "attack" && event.from === 1 && event.tick >= 10,
    ),
  );
});

test("Stun preserves an already-issued delayed strike", () => {
  const combat = duel({ speed: 1, windupPercent: 25 });
  for (let tick = 1; tick <= 6; tick++) combat.advance();
  assert.ok((combat.units[1]?.stunned ?? 0) > 0);
  assert.deepEqual(
    combat.events
      .filter((event) => event.kind === "impact" && event.from === 1)
      .map((event) => event.tick),
    [6],
  );
  assert.equal(combat.units[0]?.health, 99);
});

test("simultaneous Stun grants add, then expire by subtracting binary32 battle delta", () => {
  const combat = duel({ attackers: 2 });
  combat.advance();
  combat.advance();
  assert.equal(combat.units[2]?.stunned, 0.800000011920929);
  combat.advance();
  assert.equal(combat.units[2]?.stunned, 0.75);
});

test("Stun suspends voluntary movement without changing the unit's movement stat", () => {
  const combat = duel({ movement: 2, range: 0.1 });
  combat.advance();
  combat.advance();
  const atContact = [combat.units[1]?.x, combat.units[1]?.y];
  combat.advance();
  assert.deepEqual([combat.units[1]?.x, combat.units[1]?.y], atContact);
  assert.equal(combat.units[1]?.walking, false);
  assert.equal(combat.units[1]?.movement, 2);
});

test("reviving retains Stun and its timer continues during the revival wait", () => {
  const combat = duel({ targetHealth: 1, revive: 1, stun: 4 });
  combat.advance();
  combat.advance();
  assert.equal(combat.units[1]?.life.kind, "reviving");
  assert.equal(combat.units[1]?.stunned, 4);
  combat.advance();
  assert.equal(combat.units[1]?.stunned, 3.950000047683716);
  while (combat.ticks < 62) combat.advance();
  assert.equal(combat.units[1]?.life.kind, "alive");
  assert.ok((combat.units[1]?.stunned ?? 0) > 0.99);
  assert.ok((combat.units[1]?.stunned ?? 0) < 1.01);
});
