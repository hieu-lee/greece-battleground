import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, gameSession, newGame, parseGame } from "./game.ts";
import type { Game } from "./game.ts";
import { warband } from "./warband.ts";
import { buildings, hasTag } from "./rules.ts";
import { grid, tileId } from "./map.ts";

function board(civilians: number, coins = 12, level: 1 | 2 | 3 = 1): Game {
  const game = newGame(42, "raven");
  game.owned = grid.filter((tile) => tile.playable).map((tile) => tile.id);
  game.drachmas = coins;
  game.skills = [1, 1, 1];
  game.placements.push(
    {
      id: "sentry-camp",
      tile: tileId.parse(29),
      level,
      workers: 0,
      rune: null,
    },
    {
      id: "misthophoros-camp",
      tile: tileId.parse(44),
      level,
      workers: 0,
      rune: null,
    },
  );
  for (let index = 0; index < civilians; index++)
    game.placements.push({
      id: "silver-mine",
      tile: tileId.parse([14, 16, 27, 31, 35, 42, 43][index]),
      level: 1,
      workers: 0,
      rune: null,
    });
  return parseGame(game);
}

test("Sentry counts every owned Civilian structure, caps6 and ignores level/staffing", () => {
  for (const level of [1, 2, 3] as const)
    for (const [count, expected] of [
      [0, 0],
      [1, 1],
      [5, 5],
      [6, 6],
      [7, 6],
    ]) {
      assert.ok(count !== undefined && expected !== undefined);
      const game = board(count, 12, level);
      const units = warband(game, "polis").filter(
        (u) => u.sprite === "peripolos",
      );
      assert.equal(units.length, expected);
      assert.ok(
        units.every(
          (u) =>
            u.health === 20 * level &&
            u.damage === 3 * level &&
            u.speed === Math.fround(0.6) &&
            u.windupPercent === 50 &&
            u.range === 1,
        ),
      );
      for (const p of game.placements)
        if (p.id === "silver-mine") p.workers = 3;
      assert.equal(
        warband(parseGame(game), "polis").filter(
          (u) => u.sprite === "peripolos",
        ).length,
        expected,
      );
      // These Civilian cells include distant rows, not just adjacent neighbors.
      assert.equal(buildings["sentry-camp"].workerSlots, 0);
    }
  const mixed = board(1);
  const civilian = mixed.placements.find((p) => p.id === "silver-mine");
  assert.ok(civilian);
  civilian.id = "brewery";
  assert.equal(
    warband(parseGame(mixed), "polis").filter((u) => u.sprite === "peripolos")
      .length,
    1,
  );
  assert.equal(
    hasTag("misthophoros-camp", ["melee", "unit", "warband", "mercenary"]),
    true,
  );
});

test("Mercenary floors source binary32 Coins count, caps4 and retains L1-L3 unit stats", () => {
  for (const level of [1, 2, 3] as const)
    for (const [coins, expected] of [
      [0, 0],
      [5, 0],
      [6, 1],
      [11, 1],
      [12, 2],
      [23, 3],
      [24, 4],
      [25, 4],
    ]) {
      assert.ok(coins !== undefined && expected !== undefined);
      const game = board(0, coins, level);
      const units = warband(game, "opponent").filter(
        (u) => u.sprite === "misthophoros",
      );
      assert.equal(units.length, expected);
      assert.ok(
        units.every(
          (u) =>
            u.health === 60 * level &&
            u.armor === 15 * level &&
            u.damage === 7 * level &&
            u.crit === 10 &&
            u.speed === Math.fround(0.65) &&
            u.windupPercent === 20 &&
            u.origin?.side === "opponent",
        ),
      );
    }
  const invalid = board(1);
  const camp = invalid.placements.find((p) => p.id === "misthophoros-camp");
  assert.ok(camp);
  camp.workers = 1;
  assert.throws(() => parseGame(invalid), /workers/);
});

test("real buys/spending and moves rebuild dynamic counts and apply buffs to each emitted unit", () => {
  const initial = board(2, 24);
  initial.placements.push({
    id: "shield-camp",
    tile: tileId.parse(36),
    level: 2,
    workers: 1,
    rune: null,
  });
  initial.fate = ["padded-armor", null, null];
  initial.shop[0] = { id: "brewery", price: 4 };
  const session = gameSession(
    parseGame(initial),
    () => {},
    () => {},
  );
  assert.deepEqual(
    warband(session.state, "polis")
      .filter((u) => u.sprite === "peripolos")
      .map((u) => u.armor),
    [40, 40],
  );
  session.act({
    revision: 0,
    actions: [{ op: "fate", slot: 0, tile: tileId.parse(29) }],
  });
  assert.deepEqual(
    warband(session.state, "polis")
      .filter((u) => u.sprite === "peripolos")
      .map((u) => u.armor),
    [65, 65],
  );
  session.act({
    revision: 1,
    actions: [{ op: "buy", slot: 0, tile: tileId.parse(31) }],
  });
  assert.equal(session.state.drachmas, 20);
  assert.equal(
    warband(session.state, "polis").filter((u) => u.sprite === "misthophoros")
      .length,
    3,
  );
  assert.equal(
    warband(session.state, "polis").filter((u) => u.sprite === "peripolos")
      .length,
    3,
  );
  session.act({
    revision: 2,
    actions: [{ op: "move", from: tileId.parse(36), to: tileId.parse(42) }],
  });
  assert.deepEqual(
    warband(session.state, "polis")
      .filter((u) => u.sprite === "peripolos")
      .map((u) => u.armor),
    [25, 25, 25],
  );
  const moved = apply(session.state, {
    op: "move",
    from: tileId.parse(31),
    to: tileId.parse(43),
  });
  assert.equal(
    warband(moved, "polis").filter((u) => u.sprite === "peripolos").length,
    3,
  );
  const before = session.state;
  assert.throws(
    () =>
      session.act({
        revision: 3,
        actions: [{ op: "villager" }, { op: "assign", tile: tileId.parse(44) }],
      }),
    /worker/,
  );
  assert.deepEqual(session.state, before);
});

test("shop source pools keep clan uniques last in their rarity piles with bare costs", () => {
  // Rarity draw k of 100 (spring: 0 = Common, 99 = Uncommon), then the pile's last entry.
  const last = (k: number) => (context: { draw: string }, size: number) =>
    context.draw === "rarity" ? k : size - 1;
  const first = (clan: "stag" | "raven", k: number) =>
    newGame(42, clan, "async", last(k)).shop;
  assert.deepEqual(first("stag", 0), [
    { id: "woodcutter", price: 4 },
    null,
    null,
    null,
  ]);
  assert.deepEqual(first("raven", 0), [
    { id: "misthophoros-camp", price: 4 },
    null,
    null,
    null,
  ]);
  assert.deepEqual(first("stag", 99)[0], {
    id: "hall-of-rhapsodes",
    price: 8,
  });
  assert.deepEqual(first("raven", 99)[0], { id: "watchtower", price: 8 });
  const buyer = newGame(42, "raven");
  buyer.shop[0] = { id: "misthophoros-camp", price: 4 };
  buyer.shop[1] = { id: "misthophoros-camp", price: 4 };
  const bought = apply(buyer, { op: "buy", slot: 0, tile: tileId.parse(30) });
  assert.equal(bought.drachmas, 7);
  assert.equal(
    warband(bought, "polis").filter((u) => u.sprite === "misthophoros").length,
    1,
  );
  const upgraded = apply(bought, {
    op: "buy",
    slot: 1,
    tile: tileId.parse(30),
  });
  assert.equal(upgraded.drachmas, 3);
  assert.equal(
    warband(upgraded, "polis").filter((u) => u.sprite === "misthophoros")
      .length,
    0,
  );
  const foreign = board(1);
  foreign.clan = "stag";
  foreign.stagIncomePosition = 0;
  assert.throws(() => parseGame(foreign), /another clan/);
  const invalidOffer = newGame();
  invalidOffer.shop[0] = { id: "misthophoros-camp", price: 4 };
  assert.throws(() => parseGame(invalidOffer), /another clan/);
  assert.throws(
    () => apply(invalidOffer, { op: "buy", slot: 0, tile: tileId.parse(30) }),
    /another clan/,
  );
});
