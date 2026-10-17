import assert from "node:assert/strict";
import { test } from "node:test";
import { newGame, apply } from "./game.ts";
import { tileId } from "./map.ts";
import { practiceMatch } from "./warband.ts";
import { buildings } from "./rules.ts";

test("ordinary Defensive Towers snapshot level, workers and current item modifiers without deploying a fake unit", () => {
  for (const [level, damage] of [
    [1, 13],
    [2, 26],
    [3, 39],
  ] as const) {
    const game = newGame(42);
    game.owned = [37, 21, 22, 28, 29].map((id) => tileId.parse(id));
    game.blessings = ["watch-of-the-polis", "sky-of-artemis"];
    game.placements.push(
      {
        tile: tileId.parse(21),
        id: "defense-tower",
        level,
        workers: 2,
        rune: "aeolus-counsel",
      },
      { tile: tileId.parse(22), id: "house", level: 1, workers: 0, rune: null },
      { tile: tileId.parse(28), id: "house", level: 1, workers: 0, rune: null },
      {
        tile: tileId.parse(29),
        id: "apollo-fountain",
        level: 1,
        workers: 0,
        rune: null,
      },
    );
    const encounter = practiceMatch(game);
    assert.deepEqual(encounter.towers, [
      {
        item: "defense-tower",
        side: "polis",
        origin: { side: "polis", tile: 21 },
        x: -6.5,
        y: 0,
        speed: 0.6500000357627869,
        count: 3,
        damage,
        burn: 8,
        poison: 0,
        frost: 0,
      },
    ]);
    assert.equal(
      encounter.fighters.filter((unit) => unit.side === "polis").length,
      1,
    );
    assert.equal(buildings["defense-tower"].available, true);
  }
});

test("Thunderbolt counts adjacent Warband structures rather than their actors", () => {
  for (const [level, count, burn] of [
    [1, 7, 15],
    [2, 14, 30],
    [3, 21, 45],
  ] as const) {
    const game = newGame(42);
    game.owned = [37, 21, 22, 28].map((id) => tileId.parse(id));
    game.placements.push(
      {
        tile: tileId.parse(21),
        id: "thunderbolt-of-zeus",
        level,
        workers: 0,
        rune: null,
      },
      {
        tile: tileId.parse(22),
        id: "spear-camp",
        level: 1,
        workers: 3,
        rune: null,
      },
      {
        tile: tileId.parse(28),
        id: "javelin-camp",
        level: 1,
        workers: 1,
        rune: null,
      },
    );
    assert.deepEqual(practiceMatch(game).towers, [
      {
        item: "thunderbolt-of-zeus",
        side: "polis",
        origin: { side: "polis", tile: 21 },
        x: -6.5,
        y: 0,
        speed: 0.1428571492433548,
        count,
        damage: 0,
        burn,
        poison: 0,
        frost: 0,
      },
    ]);
    assert.equal(buildings["thunderbolt-of-zeus"].available, true);
  }
});

test("the seasonal PvE factory includes the player's actual towers and removes a demolished controller", () => {
  const game = newGame(42);
  game.placements.push({
    tile: tileId.parse(30),
    id: "defense-tower",
    level: 1,
    workers: 0,
    rune: null,
  });
  const played = apply(game, { op: "ready" });
  assert.equal(played.phase.kind, "result");
  if (played.phase.kind !== "result")
    throw new Error("Missing actual encounter");
  assert.equal(played.phase.encounter.kind, "pve");
  assert.deepEqual(played.phase.encounter.towers, [
    {
      item: "defense-tower",
      side: "polis",
      origin: { side: "polis", tile: 30 },
      x: -5.75,
      y: -0.85,
      speed: 0.5,
      count: 1,
      damage: 5,
      burn: 0,
      poison: 0,
      frost: 0,
    },
  ]);
  game.placements.pop();
  assert.deepEqual(practiceMatch(game).towers, []);
});
