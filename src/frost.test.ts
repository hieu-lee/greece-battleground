import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import { newGame } from "./game.ts";
import { warband } from "./warband.ts";

function duel({
  frost = 25,
  stun = 0,
  ward = 0,
  speed = 2.5,
  speedStat = { basis: 2, multiply: 1.25 },
  movement = 0,
  range = 6,
  revive = 0,
  health = 10000,
  windupPercent = 0,
} = {}) {
  const unit = {
    name: "Ordinary Frost contract",
    sprite: "hoplite",
    x: -1,
    y: 0,
    health: 10000,
    armor: 0,
    damage: 1,
    speed: 0.1,
    windupPercent: 0,
    movement: 0,
    range: 6,
    crit: 0,
    burn: 0,
    ward: 0,
  };
  return createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Frost source contract",
      fighters: [
        { ...unit, side: "polis", frost, stun },
        {
          ...unit,
          x: 1,
          side: "opponent",
          ward,
          speed,
          speedStat,
          movement,
          range,
          revive,
          health,
          windupPercent,
        },
      ],
    }),
  );
}

test("available Frost producers reach deployed troops and preserve signed currency", () => {
  const game = newGame(42, "raven");
  const tile = game.owned.find((t) => t !== game.placements[0]?.tile);
  assert.ok(tile !== undefined);
  game.drachmas = 10;
  for (const level of [1, 2, 3] as const) {
    game.placements.push({
      tile,
      id: "charons-barge",
      level,
      workers: 0,
      rune: null,
    });
    assert.equal(
      warband(game, "polis").find((u) => u.sprite === "boreal-giant")?.frost,
      level * 10,
    );
    game.placements.pop();
  }
  game.drachmas = -1;
  game.placements.push({
    tile,
    id: "charons-barge",
    level: 1,
    workers: 0,
    rune: null,
  });
  assert.equal(
    warband(game, "polis").find((u) => u.sprite === "boreal-giant")?.frost,
    -1,
  );
});

test("Heavy Blow subtracts APS after Add, before retaining the Frost multiplication basis", () => {
  const game = newGame(42);
  const tile = game.owned.find((t) => t !== game.placements[0]?.tile);
  assert.ok(tile !== undefined);
  game.placements.push({
    tile,
    id: "dactyl-camp",
    level: 1,
    workers: 0,
    rune: "heracles-heavy-blow",
  });
  const unit = warband(game, "polis").find((u) => u.sprite === "dactyl");
  assert.equal(unit?.speed, 0.40000003576278687);
  assert.deepEqual(unit?.speedStat, {
    basis: 0.40000003576278687,
    multiply: 1,
  });
});

test("Frost rounds positive input upward, applies through Ward, and joins the APS multiplier group", () => {
  const combat = duel({ frost: 1.01, ward: 1 });
  combat.advance();
  combat.advance();
  assert.deepEqual(
    [
      combat.units[1]?.health,
      combat.units[1]?.ward,
      combat.units[1]?.frostStacks,
      combat.units[1]?.speed,
    ],
    [10000, 0, 2, 2.200000047683716],
  );
  assert.deepEqual(
    combat.events
      .filter((e) => e.kind === "frost")
      .map((e) => ({
        tick: e.tick,
        unit: e.unit,
        amount: e.amount,
        frozen: e.frozen,
      })),
    [{ tick: 2, unit: 1, amount: 2, frozen: false }],
  );
  for (let i = 0; i < 50; i++) combat.advance();
  assert.equal(
    combat.units[1]?.frostStacks,
    2,
    "Ordinary Frost has no periodic stack decay",
  );
});

test("50 Frost stacks use the30percent operand without changing ordinary movement", () => {
  const combat = duel({ frost: 50, movement: 2, range: 0.1 });
  combat.advance();
  combat.advance();
  assert.equal(combat.units[1]?.speed, 1.899999976158142);
  assert.equal(combat.units[1]?.movement, 2);
  const x = combat.units[1]?.x;
  combat.advance();
  assert.notEqual(combat.units[1]?.x, x);
  assert.equal(combat.units[1]?.stopped, false);
});

test("100 Frost stops new actions; an issued hit survives and expiry clears stacks and modifiers", () => {
  const combat = duel({ frost: 100, windupPercent: 25 });
  combat.advance();
  combat.advance();
  assert.deepEqual(
    [
      combat.units[1]?.frostStacks,
      combat.units[1]?.frozen,
      combat.units[1]?.speed,
      combat.units[1]?.stopped,
    ],
    [100, 2, 0.5, true],
  );
  combat.advance();
  assert.deepEqual(
    combat.events
      .filter((e) => e.kind === "impact" && e.from === 1)
      .map((e) => e.tick),
    [3],
  );
  assert.equal(combat.units[0]?.health, 9999);
  while (combat.ticks < 42) combat.advance();
  assert.ok(
    (combat.units[1]?.frozen ?? 0) > 0,
    "40 f32 subtractions have not yet exhausted2.0f",
  );
  combat.advance();
  assert.deepEqual(
    [
      combat.units[1]?.frostStacks,
      combat.units[1]?.frozen,
      combat.units[1]?.speed,
      combat.units[1]?.stopped,
    ],
    [0, 0, 2.5, false],
  );
});

test("the shared control Boolean follows Stun expiry even while Freeze remains active", () => {
  const combat = duel({
    frost: 100,
    stun: 0.4,
    speed: 100,
    speedStat: { basis: 100, multiply: 1 },
  });
  for (let i = 0; i < 10; i++) combat.advance();
  assert.equal(combat.units[1]?.stunned, 0);
  assert.ok((combat.units[1]?.frozen ?? 0) > 1.5);
  assert.equal(
    combat.units[1]?.speed,
    100,
    "Zero Multiply aggregate skips multiplication",
  );
  assert.equal(combat.units[1]?.stopped, false);
  combat.advance();
  assert.ok(
    combat.events.some(
      (e) => e.kind === "attack" && e.from === 1 && e.tick >= 10,
    ),
  );
});

test("Freeze expiry writes false even while Stun remains; ordinary revival retains the freeze timer", () => {
  const combat = duel({ frost: 100, stun: 4, revive: 1, health: 1 });
  combat.advance();
  combat.advance();
  assert.equal(combat.units[1]?.life.kind, "reviving");
  assert.equal(combat.units[1]?.frozen, 2);
  combat.advance();
  assert.equal(combat.units[1]?.frozen, 1.9500000476837158);
  while (combat.ticks < 43) combat.advance();
  assert.ok((combat.units[1]?.stunned ?? 0) > 1.9);
  assert.deepEqual(
    [
      combat.units[1]?.frostStacks,
      combat.units[1]?.frozen,
      combat.units[1]?.stopped,
    ],
    [0, 0, false],
  );
});

test("inconsistent APS metadata and undefined Frost conversion are rejected at the Battle boundary", () => {
  assert.throws(
    () => duel({ speed: 2, speedStat: { basis: 2, multiply: 1.25 } }),
    /Attack speed/,
  );
  assert.throws(() => duel({ frost: 2_147_483_648 }), /Frost/);
});
