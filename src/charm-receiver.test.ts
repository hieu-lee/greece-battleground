import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession, newGame } from "./game.ts";
import { tileId } from "./map.ts";
import { sourceItemCosts } from "./source-numbers.ts";
import { boardOf, modifiers } from "./warband.ts";

for (const id of ["pit-of-tartarus", "hephaestus-forge"] as const)
  test(`ordinary stat modifiers skip ${id}'s missing receiver`, () => {
    const initial = newGame(42, "stag");
    initial.drachmas = 100;
    initial.blessings = ["wrath-of-the-titans"];
    initial.shop = [{ id, price: sourceItemCosts[id] }, null, null, null];
    const session = gameSession(
      initial,
      () => {},
      () => {},
    );
    session.act({
      revision: 0,
      actions: [{ op: "buy", slot: 0, tile: tileId.parse(30) }],
    });
    const board = boardOf(session.state);
    const target = session.state.placements.find((p) => p.id === id);
    const hall = session.state.placements.find((p) => p.id === "polis-hall");
    assert.ok(target && hall);
    assert.equal(
      modifiers(board, hall).damage.add,
      8,
      "ordinary Unit receiver remains active",
    );
    assert.equal(
      modifiers(board, target).damage.add,
      0,
      "Mythical tags do not supply a stat receiver",
    );
  });
