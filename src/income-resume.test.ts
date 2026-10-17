import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { gameSession, newGame } from "./game.ts";
import { tileId } from "./map.ts";
import { createPlaySession } from "./play-session.ts";
import { runKey } from "./run-storage.ts";

test("a real local saved-run reopening compacts source entry holes once before later purchases", async () => {
  localStorage.clear();
  const lifetime = new AbortController();
  try {
    const initial = newGame(42, "stag");
    initial.drachmas = 200;
    initial.insight = 0;
    initial.blessings = ["secrets-of-the-oracle"];
    initial.shop = [
      { id: "spring-of-mnemosyne", price: 12 },
      { id: "watchtower", price: 8 },
      { id: "farm", price: 4 },
      { id: "spring-of-mnemosyne", price: 12 },
    ];
    const game = gameSession(initial, () => {}, () => {});
    const tile = tileId.parse;
    game.act({ revision: 0, actions: [
      { op: "buy", slot: 0, tile: tile(30) },
      { op: "buy", slot: 1, tile: tile(38) },
      { op: "sell", tile: tile(30) },
      { op: "sell", tile: tile(38) },
    ] });
    const key = runKey("practice");
    const saved = JSON.stringify(game.state);
    localStorage.setItem(key, saved);
    const resumed = await createPlaySession({ network: false, tutorial: false, signal: lifetime.signal });
    assert.equal(localStorage.getItem(key), saved, "load grants no currency and does not rewrite the saved transaction");
    await resumed.act({ revision: 1, actions: [
      { op: "buy", slot: 2, tile: tile(30) },
      { op: "buy", slot: 3, tile: tile(38) },
      { op: "move", from: tile(37), to: tile(30) },
    ] });
    await resumed.act({ revision: 2, actions: [{ op: "ready" }, { op: "continue" }] });
    const deadline = performance.now() + 7_000;
    while (resumed.state.phase.kind === "income" && performance.now() < deadline) await delay(20);
    assert.equal(resumed.state.phase.kind, "prepare");
    assert.equal(resumed.state.insight, 5, "compacted entries append Farm before Spring; displaced Hall precedes Spring");
  } finally {
    lifetime.abort();
    localStorage.clear();
  }
});
