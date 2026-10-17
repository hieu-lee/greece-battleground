import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { newGame, parseGame } from "./game.ts";
import type { Command } from "./game.ts";
import { tileId } from "./map.ts";
import { createPlaySession } from "./play-session.ts";
import { runKey } from "./run-storage.ts";

test("a purchased Memory Charm pays its two direct drops through the live local session", async () => {
  const lifetime = new AbortController();
  const key = runKey("practice");
  const previous = localStorage.getItem(key);
  try {
    // Trusted preparation fixture; the actual Fate action attaches the Charm.
    const game = newGame(42, "raven", "practice", () => 0);
    game.round = 2;
    game.phase = { kind: "prepare" };
    game.insight = 16;
    game.favor.athena = 5;
    game.owned.push(tileId.parse(31));
    game.placements.push(
      { tile: tileId.parse(30), id: "watchtower", level: 1, workers: 0, rune: null },
      { tile: tileId.parse(31), id: "farm", level: 1, workers: 0, rune: null },
    );
    game.fate = ["memory-of-the-polis", null, null];
    localStorage.setItem(key, JSON.stringify(parseGame(game)));
    const session = await createPlaySession({
      network: false,
      tutorial: false,
      signal: lifetime.signal,
    });
    async function act(actions: Command[]) {
      const reply = await session.act({ revision: session.state.r, actions });
      assert.ok(
        reply && typeof reply === "object" && !("error" in reply),
        JSON.stringify(reply),
      );
    }
    await act([{ op: "fate", slot: 0, tile: tileId.parse(30) }]);
    assert.deepEqual(session.state.placements.find((p) => p.tile === 30)?.rune, "memory-of-the-polis");
    assert.deepEqual([session.state.drachmas, session.state.insight], [11, 0]);
    await act([{ op: "ready" }]);
    await act([{ op: "continue" }]);
    const deadline = performance.now() + 7_000;
    while (
      performance.now() < deadline &&
      (session.state.phase.kind !== "prepare" ||
        session.state.drachmas !== 24 || session.state.insight !== 6)
    ) await delay(20);
    assert.deepEqual(
      [session.state.round, session.state.phase.kind, session.state.drachmas, session.state.insight],
      [3, "prepare", 24, 6],
      "Hall11/4, Farm1 Drachma, Watchtower1 Insight, then one Memory drop of each currency",
    );
  } finally {
    lifetime.abort();
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
  }
});
