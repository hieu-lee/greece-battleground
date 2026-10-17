import assert from "node:assert/strict";
import { test } from "node:test";
import { newGame, parseGame } from "./game.ts";
import { tileId } from "./map.ts";
import { warband } from "./warband.ts";
import { buildings } from "./rules.ts";

test("ordinary Skull deploys beside an unowned Circle and refreshes level-dependent Frost from actual adjacent Divine items", () => {
  for (const [level, frost] of [
    [1, 20],
    [2, 40],
    [3, 60],
  ] as const) {
    const game = newGame(42);
    game.owned.push(tileId.parse(16), tileId.parse(22));
    game.placements.push(
      {
        tile: tileId.parse(16),
        id: "skull-of-typhon",
        level,
        workers: 0,
        rune: null,
      },
      {
        tile: tileId.parse(22),
        id: "apollo-fountain",
        level: 1,
        workers: 0,
        rune: null,
      },
    );
    assert.equal(game.owned.includes(tileId.parse(23)), false);
    const units = warband(parseGame(game), "polis").filter(
      (u) => u.sprite === "drakon-colossus",
    );
    assert.equal(units.length, 1);
    assert.equal(units[0]?.frost, frost);
    assert.equal(units[0]?.windupPercent, 15);
    game.placements.pop();
    assert.equal(
      warband(game, "polis").find((u) => u.sprite === "drakon-colossus")?.frost,
      frost / 2,
    );
  }
});

test("ordinary Skull has no substitute actor when no Circle is adjacent", () => {
  const game = newGame(42);
  game.owned.push(tileId.parse(42), tileId.parse(35));
  game.placements.push(
    {
      tile: tileId.parse(42),
      id: "skull-of-typhon",
      level: 3,
      workers: 0,
      rune: null,
    },
    {
      tile: tileId.parse(35),
      id: "apollo-fountain",
      level: 1,
      workers: 0,
      rune: null,
    },
  );
  assert.equal(
    warband(parseGame(game), "polis").filter(
      (u) => u.sprite === "drakon-colossus",
    ).length,
    0,
  );
  assert.equal(buildings["skull-of-typhon"].available, true);
});
