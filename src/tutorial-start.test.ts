import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession, inspection, newGame, parseGame } from "./game.ts";
import { freshRun } from "./run-storage.ts";
import { sourceMap } from "./map.ts";
import { sourceItemCosts } from "./source-numbers.ts";

function finishIncome(session: ReturnType<typeof gameSession>) {
  for (
    let pass = 0;
    pass < 100 && session.state.phase.kind === "income";
    pass++
  )
    session.update(session.runtime.clock.last + 500);
}

// The port's entropy boundary is controlled here, not Unity's random stream.
test("a tutorial uses the selected clan and an ordinary randomly seeded starting polis", (t) => {
  t.mock.method(crypto, "getRandomValues", (values: Uint32Array) => {
    values[0] = 123456;
    return values;
  });
  const tutorial = freshRun("raven", "tutorial");
  const normal = newGame(123456, "raven");
  assert.equal(tutorial.seed, 123456);
  assert.equal(tutorial.clan, "raven");
  assert.deepEqual(tutorial.owned, sourceMap(123456).owned);
  assert.deepEqual(tutorial.placements, normal.placements);
  assert.deepEqual(
    [tutorial.drachmas, tutorial.insight, tutorial.workers,
      tutorial.lives, tutorial.wins, tutorial.skills],
    [0, 0, 0, 5, 0, [1, 1, 1]],
  );
});

test("the saved tutorial and public inspection retain a dedicated tutorial mode", () => {
  const tutorial = freshRun("stag", "tutorial");
  assert.equal(tutorial.mode, "tutorial");
  assert.equal(inspection(tutorial).mode, "tutorial");
  assert.equal(parseGame(JSON.parse(JSON.stringify(tutorial))).mode, "tutorial");
});

test("the first tutorial shop is the actual four source offers at normal item prices", () => {
  for (const clan of ["stag", "raven"] as const) {
    const game = gameSession(freshRun(clan, "tutorial"), () => {}, () => {});
    game.act({ revision: game.state.revision, actions: [{ op: "continue" }] });
    finishIncome(game);
    assert.deepEqual([game.state.drachmas, game.state.insight], [11, 4]);
    assert.deepEqual(game.state.shop, [
      { id: "javelin-camp", price: sourceItemCosts["javelin-camp"] },
      { id: "defense-tower", price: sourceItemCosts["defense-tower"] },
      { id: "spear-camp", price: sourceItemCosts["spear-camp"] },
      { id: "shield-camp", price: sourceItemCosts["shield-camp"] },
    ]);
  }
});

test("an eligible Warband lets the first tutorial Fate offer Thor001, Baldr003 and Neutral001", () => {
  for (const clan of ["stag", "raven"] as const) {
    const game = gameSession(freshRun(clan, "tutorial"), () => {}, () => {});
    game.act({ revision: game.state.revision, actions: [{ op: "continue" }] });
    finishIncome(game);
    const tile = game.state.owned.find((id) => !game.state.placements.some((item) => item.tile === id));
    assert.notEqual(tile, undefined);
    game.act({ revision: game.state.revision, actions: [{ op: "buy", slot: 0, tile }] });
    game.act({ revision: game.state.revision, actions: [{ op: "continue" }] });
    assert.deepEqual(game.state.fate, [
      "call-to-war",
      "well-fed",
      "ruins-of-delphi",
    ]);
  }
});

test("ordinary practice keeps its own mode, offers and selected clan", (t) => {
  t.mock.method(crypto, "getRandomValues", (values: Uint32Array) => {
    values[0] = 789;
    return values;
  });
  const practice = freshRun("raven", "practice");
  assert.deepEqual(practice, newGame(789, "raven"));
  assert.equal(inspection(practice).mode, "practice");
});
