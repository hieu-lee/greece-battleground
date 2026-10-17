import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GameStore } from "./store.ts";
import { newGame, parseGame } from "../src/game.ts";
import { sourceMap, startTile } from "../src/map.ts";

test("service reopen compacts source item entries once; ordinary reads retain live holes", () => {
  const directory = mkdtempSync(
    join(homedir(), ".cache/task-tmp/income-resume-"),
  );
  const path = join(directory, "game.sqlite");
  let store: GameStore | null = new GameStore(path);
  try {
    const { guest } = store.create({ clan: "stag", name: "Entry resume" });
    const game = newGame(42, "stag", "async", () => 0);
    const [a, b] = game.owned.filter((tile) => tile !== startTile);
    assert.ok(a !== undefined && b !== undefined);
    const features = ["mountain", "forest", "circle-of-stone"].map(
      (feature) => {
        const tile = sourceMap(42).tiles.find(
          (tile) => tile.feature === feature,
        );
        assert.ok(tile);
        return tile.id;
      },
    );
    game.placements.push({
      tile: b,
      id: "silver-mine",
      level: 1,
      workers: 0,
      rune: null,
    });
    game.itemEntries = {
      slots: [...features, startTile, null, b, null],
      free: [6, 4],
    };
    game.shop = [{ id: "house", price: 4 }, null, null, null];
    game.drachmas = 20;
    parseGame(game);
    const db = new DatabaseSync(path);
    try {
      db.prepare("UPDATE games SET state=? WHERE guest=?").run(
        JSON.stringify(game),
        guest.id,
      );
    } finally {
      db.close();
    }
    const stored = () => {
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        const row = db
          .prepare("SELECT state FROM games WHERE guest=?")
          .get(guest.id);
        assert.ok(row && typeof row.state === "string");
        return parseGame(JSON.parse(row.state));
      } finally {
        db.close();
      }
    };
    store.inspect(guest.id);
    store.profile(guest.id);
    assert.deepEqual(stored().itemEntries, game.itemEntries);
    store.close();
    store = new GameStore(path);
    assert.deepEqual(stored().itemEntries, {
      slots: [...features, startTile, b],
      free: [],
    });
    const reply = store.act(guest.id, {
      requestId: randomUUID(),
      revision: 0,
      actions: [{ op: "buy", slot: 0, tile: a }],
    });
    assert.equal(reply.status, 200);
    assert.deepEqual(stored().itemEntries, {
      slots: [...features, startTile, b, a],
      free: [],
    });
    assert.deepEqual(
      stored().placements.map((p) => p.tile),
      [startTile, b, a],
    );
    store.inspect(guest.id);
    assert.deepEqual(stored().itemEntries, {
      slots: [...features, startTile, b, a],
      free: [],
    });
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
