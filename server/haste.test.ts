import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GameStore, actionRequest } from "./store.ts";
import { newGame, parseGame } from "../src/game.ts";
import { sourceMap } from "../src/map.ts";
import { battle, createCombat } from "../src/combat.ts";

test("submitted Horn controllers survive matching, identical Ready retry and service reopen", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "haste-service-"));
  const path = join(directory, "current.sqlite");
  let store: GameStore | undefined;
  try {
    store = new GameStore(path);
    const owner = store.create({ clan: "stag", name: "Horn owner" });
    const rival = store.create({ clan: "raven", name: "Horn rival" });
    store.close();
    store = undefined;
    // Trusted server preparation fixtures; clients cannot submit either layout.
    const prepared = newGame(42, "stag", "async", () => 0);
    prepared.round = 2;
    const hall = prepared.placements.find((p) => p.id === "polis-hall");
    assert.ok(hall);
    const hornTile = prepared.owned.find(
      (tile) =>
        !prepared.placements.some((p) => p.tile === tile) &&
        !sourceMap(prepared.seed).tiles[tile]?.feature,
    );
    assert.ok(hornTile !== undefined);
    prepared.placements.push({
      id: "tritons-conch",
      tile: hornTile,
      level: 3,
      workers: 0,
      rune: null,
    });
    const other = newGame(43, "raven", "async", () => 0);
    other.round = 2;
    const fixture = new DatabaseSync(path);
    try {
      fixture
        .prepare("UPDATE games SET state=? WHERE guest=?")
        .run(JSON.stringify(parseGame(prepared)), owner.guest.id);
      fixture
        .prepare("UPDATE games SET state=? WHERE guest=?")
        .run(JSON.stringify(parseGame(other)), rival.guest.id);
    } finally {
      fixture.close();
    }
    store = new GameStore(path);
    const ready = actionRequest.parse({
      revision: 0,
      requestId: randomUUID(),
      actions: [{ op: "ready" }],
    });
    assert.equal(store.act(owner.guest.id, ready).status, 202);
    const matched = store.act(rival.guest.id, ready);
    assert.equal(matched.status, 200);
    const replay = store.replay(rival.guest.id);
    assert.ok(replay !== null && "encounter" in replay);
    const encounter = battle.parse(replay.encounter);
    // Seed42 puts this Conch at30, adjacent to the Circle at23: one Divine operand.
    assert.deepEqual(encounter.horns, [
      {
        side: "opponent",
        speed: 0.16249999403953552,
        duration: 3,
        targets: [hall.tile],
      },
    ]);
    assert.deepEqual(store.act(rival.guest.id, ready), matched);
    store.close();
    store = new GameStore(path);
    assert.deepEqual(store.replay(rival.guest.id), replay);
    const combat = createCombat(encounter);
    // The stored controller is a real replay input, not receipt-only metadata.
    while (!combat.result && combat.ticks < 162) combat.advance();
    assert.ok(
      combat.events.some(
        (event) =>
          event.kind === "haste" &&
          combat.units[event.unit]?.side === "opponent",
      ),
    );
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
