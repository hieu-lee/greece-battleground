import assert from "node:assert/strict";
import { test } from "node:test";
import { battle, createCombat } from "./combat.ts";
import type { Fighter } from "./combat.ts";
import { gameSession, newGame } from "./game.ts";
import { startTile, tileId } from "./map.ts";
import { sourceItemCosts } from "./source-numbers.ts";
import { warband } from "./warband.ts";

// Authored offers/resources; acquire the real Charm through Game.act. Combat-only
// scalar/position fixtures isolate the source controller without inventing a hook.
function purchased() {
  const initial = newGame(42, "stag");
  initial.drachmas = 200;
  initial.insight = 200;
  initial.workers = 3;
  initial.favor = { zeus: 10, athena: 10, apollo: 10 };
  initial.shop = [
    { id: "spear-camp", price: sourceItemCosts["spear-camp"] },
    null,
    null,
    null,
  ];
  initial.fate = ["a-heros-last-breath", null, null];
  const game = gameSession(initial, () => {}, () => {});
  game.act({
    revision: game.state.revision,
    actions: [
      { op: "buy", slot: 0, tile: tileId.parse(30) },
      { op: "assign", tile: tileId.parse(30) },
      { op: "fate", slot: 0, tile: tileId.parse(30) },
    ],
  });
  assert.equal(
    game.state.placements.find((p) => p.tile === 30)?.rune,
    "a-heros-last-breath",
  );
  const units = warband(game.state, "polis");
  const source = units.find((u) => u.origin?.tile === 30);
  const plain = units.find((u) => u.origin?.tile === startTile);
  assert.ok(source && plain, "purchase must produce an actual rune-bearing troop");
  return { source, plain };
}

function posed(unit: Fighter, changes: Partial<Fighter> = {}): Fighter {
  return {
    ...unit,
    name: "Last Breath source fixture",
    x: 0,
    y: 0,
    health: 1000,
    armor: 0,
    damage: 0,
    speed: 0.1,
    windupPercent: 0,
    movement: 0,
    range: 20,
    crit: 0,
    burn: 0,
    ward: 0,
    ...changes,
    attackStat: { base: changes.damage ?? 0, add: 0, subtract: 0, multiply: 1 },
    armorStat: { base: changes.armor ?? 0, add: 0, subtract: 0, multiply: 1 },
    speedStat: { basis: changes.speed ?? 0.1, multiply: 1 },
  };
}

function encounter(
  allies: Partial<Fighter>[],
  sourceChanges: Partial<Fighter> = {},
  killerChanges: Partial<Fighter> = {},
) {
  const { source, plain } = purchased();
  return createCombat(
    battle.parse(
      JSON.parse(
        JSON.stringify({
          seed: 1,
          kind: "training",
          opponent: "Authored Last Breath controller fixture",
          fighters: [
            posed(source, { health: 1, ...sourceChanges }),
            ...allies.map((u) => posed(plain, u)),
            posed(plain, {
              side: "opponent",
              origin: null,
              x: 0,
              y: -4,
              damage: 10,
              ...killerChanges,
            }),
          ],
        }),
      ),
    ),
  );
}
type Combat = ReturnType<typeof encounter>;
function until(combat: Combat, predicate: () => boolean, limit = 20) {
  while (!predicate() && combat.ticks < limit && !combat.result) combat.advance();
  assert.ok(predicate(), "the authored lethal attack must reach the requested life state");
}
function killSource(combat: Combat) {
  until(combat, () => combat.units[0]?.life.kind === "dead");
  assert.equal(combat.units[0]?.ward, 0, "the source cannot receive its own chain");
  assert.equal(combat.units.at(-1)?.ward, 0, "the enemy cannot receive friendly Ward");
}

test("Last Breath uses the original source for nearest-three hops and excludes prior recipients", () => {
  const combat = encounter([{ x: 1 }, { x: -2 }, { x: 3 }, { x: 4 }]);
  killSource(combat);
  assert.deepEqual(combat.units.slice(1, 5).map((u) => u.ward), [1, 1, 1, 0]);
});

test("equal-distance cutoff follows friendly insertion order, including its reverse", () => {
  const observed = [];
  for (const order of [[2, -2], [-2, 2]]) {
    const first = order[0];
    const second = order[1];
    assert.ok(first !== undefined && second !== undefined);
    const combat = encounter([{ x: 0.75 }, { x: 1.25 }, { x: first }, { x: second }]);
    killSource(combat);
    observed.push(combat.units.slice(1, 5).map((u) => u.ward));
  }
  assert.deepEqual(observed, [[1, 1, 1, 0], [1, 1, 1, 0]]);
});

test("successful source revival does not dispatch the ordinary death chain", () => {
  const combat = encounter([{ x: 1 }, { x: 2 }], { revive: 1 });
  until(combat, () => combat.units[0]?.life.kind === "reviving");
  assert.equal(combat.events.filter((e) => e.kind === "death" && e.unit === 0).length, 0);
  assert.deepEqual(combat.units.map((u) => u.ward), [0, 0, 0, 0]);
});

for (const revive of [0, 1]) {
  test(revive ? "reviving recipients qualify for direct Ward" : "previously dead recipients do not consume a chain place", () => {
    const combat = encounter(
      [{ x: 0, y: -2, health: 1, revive }, { x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }],
      {},
      { speed: 10 },
    );
    killSource(combat);
    assert.equal(combat.units[1]?.life.kind, revive ? "reviving" : "dead");
    assert.deepEqual(
      combat.units.slice(1, 6).map((u) => u.ward),
      revive ? [1, 1, 1, 0, 0] : [0, 1, 1, 1, 0],
    );
  });
}

test("Last Breath increments current Ward immediately without a timed holder", () => {
  const combat = encounter([{ x: 1, ward: 7 }, { x: 2 }, { x: 3 }]);
  killSource(combat);
  const recipient = combat.units[1];
  assert.ok(recipient);
  assert.equal(recipient.ward, 8);
  assert.deepEqual(recipient.timed.filter((buff) => buff.stat === "ward"), []);
  while (combat.ticks < 80 && !combat.result) combat.advance();
  assert.equal(recipient.ward, 8, "grant survives without expiry or another incoming attack");
});

test("fewer than three eligible recipients stop without repeats", () => {
  const short = encounter([{ x: 1 }, { x: 2 }]);
  killSource(short);
  assert.deepEqual(short.units.slice(1, 3).map((u) => u.ward), [1, 1]);
});

test("an empty recipient list still finishes the actual source death", () => {
  const empty = encounter([]);
  killSource(empty);
  assert.equal(empty.result?.winner, "opponent");
  assert.deepEqual(empty.units.map((u) => u.ward), [0, 0]);
});
