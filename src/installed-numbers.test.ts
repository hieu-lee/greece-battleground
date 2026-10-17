import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apply,
  gameSession,
  newGame,
  parseGame,
  price,
  hasTag,
} from "./game.ts";
import { warband } from "./warband.ts";
import { tileId } from "./map.ts";

const meleeTile = tileId.parse(43);
const rangedTile = tileId.parse(30);

function richGame() {
  const game = newGame(71, "stag");
  game.drachmas = 1000;
  game.insight = 1000;
  return gameSession(
    game,
    () => {},
    () => {},
  );
}

test("installed shop prices preserve free rolls, charge each paid tier, and stop after six paid rolls", () => {
  const game = richGame();
  game.act({ revision: 0, actions: [{ op: "reroll-shop" }] });
  assert.deepEqual(game.inspect().balance, [1000, 1000]);
  assert.deepEqual(game.inspect().rerollCosts, [2, 1]);
  for (const expectedBalance of [998, 994, 986, 970, 938, 874]) {
    game.act({ revision: game.inspect().r, actions: [{ op: "reroll-shop" }] });
    assert.deepEqual(game.inspect().balance, [expectedBalance, 1000]);
  }
  assert.deepEqual(game.inspect().rerollCosts, [null, 1]);
  const before = game.state;
  assert.throws(
    () =>
      game.act({
        revision: game.inspect().r,
        actions: [{ op: "reroll-shop" }],
      }),
    /No shop rerolls/,
  );
  assert.deepEqual(game.state, before);
  game.act({
    revision: game.inspect().r,
    actions: [{ op: "ready" }, { op: "continue" }],
  });
  assert.equal(game.inspect().round, 2);
  assert.deepEqual(game.inspect().rerollCosts, [0, 1]);
});

test("installed Fate rerolls charge the serialized ladder to 64, provisionally reject an 8th, and failed payment consumes nothing", () => {
  const game = richGame();
  for (const expectedBalance of [999, 997, 993, 985, 969, 937, 873]) {
    game.act({ revision: game.inspect().r, actions: [{ op: "reroll-fate" }] });
    assert.deepEqual(game.inspect().balance, [1000, expectedBalance]);
  }
  assert.deepEqual(game.inspect().rerollCosts, [0, null]);
  const spent = game.state;
  assert.throws(
    () =>
      game.act({
        revision: game.inspect().r,
        actions: [{ op: "reroll-fate" }],
      }),
    /No Fate rerolls remain/,
  );
  assert.deepEqual(game.state, spent);
  const poor = newGame(71, "raven");
  poor.drachmas = 1;
  poor.insight = 0;
  const before = structuredClone(poor);
  assert.throws(() => apply(poor, { op: "reroll-shop" }), /Drachmas/);
  assert.throws(() => apply(poor, { op: "reroll-fate" }), /Insight/);
  assert.deepEqual(poor, before);
});

function settlement() {
  const game = newGame(71, "stag");
  game.owned = [...new Set([...game.owned, meleeTile, rangedTile])];
  game.placements.push(
    { id: "spear-camp", tile: meleeTile, level: 2, workers: 1, rune: null },
    { id: "archer-camp", tile: rangedTile, level: 3, workers: 1, rune: null },
  );
  return parseGame(game);
}

test("source roster stats reach the deployed warband: Stag0.65, Warrior90/10, Tracker135/9/0.6/range6 without innate Burn", () => {
  const chief = warband(newGame(71, "stag"), "polis")[0];
  const [, hoplite, tracker] = warband(settlement(), "polis");
  assert.ok(chief && hoplite && tracker);
  assert.deepEqual(
    [chief.health, chief.armor, chief.damage, chief.speed, chief.range],
    [240, 40, 10, Math.fround(0.65), 1],
  );
  assert.deepEqual(
    [hoplite.health, hoplite.damage, hoplite.speed, hoplite.range],
    [90, 10, Math.fround(0.8), 1],
  );
  assert.deepEqual(
    [
      tracker.health,
      tracker.damage,
      tracker.speed,
      tracker.range,
      tracker.burn,
    ],
    [135, 9, Math.fround(0.6), 6, 0],
  );
  assert.deepEqual(
    [
      chief.windupPercent,
      hoplite.windupPercent,
      tracker.windupPercent,
      warband(newGame(71, "raven"), "polis")[0]?.windupPercent,
    ],
    [15, 50, 50, 15],
  );
  const camps = [
    [
      "javelin-camp",
      "peltast",
      [
        [25, 8, 0],
        [50, 16, 0],
        [75, 24, 0],
      ],
      3,
      5,
      30,
    ],
    [
      "shield-camp",
      "hypaspist",
      [
        [30, 5, 50],
        [60, 10, 100],
        [90, 15, 150],
      ],
      2.5,
      1,
      32,
    ],
  ] as const;
  for (const [id, sprite, stats, movement, range, windupPercent] of camps)
    for (const [level, expected] of [
      [1, stats[0]],
      [2, stats[1]],
      [3, stats[2]],
    ] as const)
      for (const workers of [0, 1, 2, 3]) {
        const state = newGame(71, "stag");
        state.placements.push({
          id,
          tile: meleeTile,
          level,
          workers,
          rune: null,
        });
        const troops = warband(parseGame(state), "polis").filter(
          (u) => u.sprite === sprite,
        );
        assert.equal(
          troops.length,
          workers,
          `${id} level${level} staffing${workers}`,
        );
        for (const troop of troops)
          assert.deepEqual(
            [
              troop.health,
              troop.damage,
              troop.armor,
              troop.speed,
              troop.movement,
              troop.range,
              troop.crit,
              troop.burn,
              troop.windupPercent,
            ],
            [
              ...expected,
              Math.fround(0.4),
              movement,
              range,
              0,
              0,
              windupPercent,
            ],
          );
      }
});

test("Flurry gives10 Crit to Melee and rejects ranged attachment; Protect the Weak requires Civilian AND Unit", () => {
  const game = settlement();
  game.insight = 8;
  game.fate = ["flurry-of-blows", "protect-the-weak", null];
  assert.throws(
    () => apply(game, { op: "fate", slot: 0, tile: rangedTile }),
    /target/,
  );
  const before = warband(game, "polis")[1];
  const attached = apply(game, { op: "fate", slot: 0, tile: meleeTile });
  const after = warband(attached, "polis")[1];
  assert.ok(before && after);
  assert.equal(after.crit - before.crit, 10);
  assert.equal(after.speed, before.speed);
  const civilian = settlement();
  civilian.placements[1] = {
    id: "brewery",
    tile: meleeTile,
    level: 1,
    workers: 0,
    rune: null,
  };
  civilian.insight = 4;
  civilian.fate = ["protect-the-weak", null, null];
  assert.throws(
    () => apply(civilian, { op: "fate", slot: 0, tile: meleeTile }),
    /target/,
  );
});

test("source discounts leave positive-price items at least1 and preserve a free configured offer", () => {
  const game = newGame();
  game.blessings = ["call-to-peace", "call-to-learning"];
  assert.equal(price(game, { id: "brewery", price: 2 }), 1);
  assert.equal(price(game, { id: "brewery", price: 0 }), 0);
  // Spring rarity draw 90 of 100 = Uncommon, 0 = Common; then the serialized entry index.
  for (const [k, index, id, cost] of [
    [90, 8, "archer-camp", 8],
    [0, 0, "javelin-camp", 4],
    [0, 7, "shield-camp", 4],
  ] as const) {
    const offered = newGame(71, "stag", "async", (context) =>
      context.draw === "rarity" ? k : index,
    ).shop;
    assert.deepEqual(
      offered.map((offer) => offer && [offer.id, offer.price]),
      [[id, cost], null, null, null],
    );
  }
  game.blessings = ["call-to-war"];
  assert.equal(price(game, { id: "javelin-camp", price: 4 }), 3);
  assert.equal(price(game, { id: "shield-camp", price: 4 }), 3);
});

test("new camps deploy one troop on purchase, preserve three assigned workers on upgrade, and reject a fourth atomically", () => {
  for (const [id, sprite] of [
    ["javelin-camp", "peltast"],
    ["shield-camp", "hypaspist"],
  ] as const) {
    const start = newGame(71, "stag");
    start.drachmas = 1000;
    start.shop = [{ id, price: 4 }, { id, price: 4 }, { id, price: 4 }, null];
    const game = gameSession(
      start,
      () => {},
      () => {},
    );
    const troops = () =>
      warband(game.state, "polis").filter((u) => u.sprite === sprite);
    game.act({
      revision: 0,
      actions: [{ op: "buy", slot: 0, tile: meleeTile }],
    });
    assert.equal(troops().length, 1);
    assert.equal(game.state.workers, 0);
    for (const expected of [2, 3]) {
      game.act({
        revision: game.state.revision,
        actions: [{ op: "villager" }, { op: "assign", tile: meleeTile }],
      });
      assert.equal(troops().length, expected);
    }
    const full = game.state;
    assert.throws(
      () =>
        game.act({
          revision: full.revision,
          actions: [{ op: "villager" }, { op: "assign", tile: meleeTile }],
        }),
      /No worker slots/,
    );
    assert.deepEqual(game.state, full);
    for (const slot of [1, 2]) {
      game.act({
        revision: game.state.revision,
        actions: [{ op: "buy", slot, tile: meleeTile }],
      });
      assert.equal(troops().length, 3);
      assert.equal(
        game.state.placements.find((p) => p.id === id)?.level,
        slot + 1,
      );
    }
    game.act({ revision: game.state.revision, actions: [{ op: "ready" }] });
    const resumed = parseGame(JSON.parse(JSON.stringify(game.state)));
    assert.equal(resumed.phase.kind, "result");
    if (resumed.phase.kind !== "result") throw new Error("No saved result");
    assert.equal(
      resumed.phase.encounter.fighters.filter((u) => u.sprite === sprite)
        .length,
      3,
    );
    assert.ok(
      resumed.phase.encounter.fighters
        .filter((u) => u.sprite === sprite)
        .every((u) => u.origin?.tile === meleeTile),
    );
  }
});

test("neighbor bonuses reach each tagged troop, exclude their source, stack, and rebuild after moving a source", () => {
  const start = newGame(71, "stag");
  start.owned.push(
    tileId.parse(29),
    tileId.parse(30),
    tileId.parse(23),
    tileId.parse(22),
  );
  start.placements.push(
    {
      tile: tileId.parse(38),
      id: "javelin-camp",
      level: 1,
      workers: 2,
      rune: null,
    },
    {
      tile: tileId.parse(29),
      id: "javelin-camp",
      level: 3,
      workers: 3,
      rune: null,
    },
    { tile: rangedTile, id: "archer-camp", level: 1, workers: 3, rune: null },
    {
      tile: tileId.parse(23),
      id: "shield-camp",
      level: 1,
      workers: 2,
      rune: null,
    },
    {
      tile: tileId.parse(22),
      id: "shield-camp",
      level: 3,
      workers: 1,
      rune: null,
    },
    { tile: meleeTile, id: "shield-camp", level: 2, workers: 0, rune: null },
  );
  start.shop = [{ id: "javelin-camp", price: 4 }, null, null, null];
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  assert.deepEqual(
    warband(game.state, "polis")
      .filter((u) => u.sprite === "tracker")
      .map((u) => u.damage),
    [11, 11, 11],
    "level-one and level-three source camps add 2 and 6 to each target",
  );
  game.act({
    revision: 0,
    actions: [{ op: "buy", slot: 0, tile: tileId.parse(38) }],
  });
  const rows = () =>
    warband(game.state, "polis").map((u) => [u.sprite, u.damage, u.armor]);
  const expected = [
    ["aegeus", 10, 80],
    ["peltast", 16, 0],
    ["peltast", 16, 0],
    ["peltast", 24, 60],
    ["peltast", 24, 60],
    ["peltast", 24, 60],
    ["tracker", 13, 80],
    ["tracker", 13, 80],
    ["tracker", 13, 80],
    ["hypaspist", 5, 110],
    ["hypaspist", 5, 110],
    ["hypaspist", 15, 170],
  ];
  assert.deepEqual(rows(), expected);
  assert.deepEqual(
    rows(),
    expected,
    "repeated reads cannot accumulate modifiers",
  );
  assert.equal(hasTag("javelin-camp", ["ranged", "unit"]), true);
  assert.equal(hasTag("javelin-camp", ["melee", "unit"]), false);
  assert.equal(hasTag("shield-camp", ["melee", "unit"]), true);
  assert.equal(hasTag("brewery", "unit"), false);
  game.act({
    revision: game.state.revision,
    actions: [{ op: "move", from: tileId.parse(38), to: tileId.parse(44) }],
  });
  assert.deepEqual(
    warband(game.state, "polis")
      .filter((u) => u.sprite === "tracker")
      .map((u) => u.damage),
    [9, 9, 9],
  );
  game.act({
    revision: game.state.revision,
    actions: [{ op: "move", from: tileId.parse(44), to: tileId.parse(38) }],
  });
  assert.deepEqual(
    rows(),
    expected,
    "moving back restores the derived board stats exactly",
  );
});
