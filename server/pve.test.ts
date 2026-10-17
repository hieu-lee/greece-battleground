import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GameStore, actionRequest } from "./store.ts";
import { parseGame } from "../src/game.ts";
import { battle } from "../src/combat.ts";
import { setTimeout as delay } from "node:timers/promises";

test("ranked PvE needs no rival, remains private, and claims once across retry and reopen", async () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "pve-service-"));
  const path = join(directory, "current.sqlite");
  let store: GameStore | undefined;
  let clock = 0;
  const options = { now: () => clock };
  const saved = (id: string) => {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const row = database
        .prepare("SELECT state FROM games WHERE guest=?")
        .get(id);
      assert.ok(row && typeof row.state === "string");
      return parseGame(JSON.parse(row.state));
    } finally {
      database.close();
    }
  };
  const privateRows = () => {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return ["ghosts", "ranked_battles", "results"].map(
        (table) =>
          database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
            ?.count,
      );
    } finally {
      database.close();
    }
  };
  try {
    store = new GameStore(path, options);
    const owner = store.create({
      clan: "stag",
      name: "PvE owner",
      queue: "ranked",
    });
    const initialMatch = store.inspect(owner.guest.id, {
      match: true,
    }).matchmaking;
    const ready = actionRequest.parse({
      revision: 0,
      requestId: randomUUID(),
      actions: [{ op: "ready" }],
    });
    const result = store.act(owner.guest.id, ready);
    assert.equal(
      result.status,
      200,
      "Round 1 is an authored PvE battle, never a waiting PvP submission",
    );
    assert.deepEqual(initialMatch, {
      round: 1,
      submitted: false,
      available: true,
    });
    const replay = store.replay(owner.guest.id);
    assert.ok(replay && "encounter" in replay);
    const encounter = battle.parse(replay.encounter);
    assert.equal(encounter.kind, "pve");
    assert.equal(encounter.opponentLayout, null);
    assert.deepEqual(
      encounter.fighters
        .filter((unit) => unit.side === "opponent")
        .map((unit) => [
          unit.sprite,
          unit.origin?.tile,
          unit.health,
          unit.armor,
          unit.damage,
          unit.speed,
          unit.movement,
          unit.range,
          unit.crit,
          unit.burn,
          unit.poison ?? 0,
          unit.frost ?? 0,
          unit.stun ?? 0,
          unit.cleave ?? 0,
        ]),
      Array.from({ length: 4 }, () => [
        "fox",
        21,
        50,
        0,
        8,
        0.75,
        3.5,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
    );
    assert.deepEqual(privateRows(), [0, 0, 0]);
    assert.deepEqual(store.act(owner.guest.id, ready), result);
    store.close();
    store = new GameStore(path, options);
    assert.deepEqual(store.replay(owner.guest.id), replay);
    assert.deepEqual(store.act(owner.guest.id, ready), result);
    const claim = actionRequest.parse({
      revision: 1,
      requestId: randomUUID(),
      actions: [{ op: "continue" }],
    });
    const claimed = store.act(owner.guest.id, claim);
    assert.equal(claimed.status, 200);
    for (
      let i = 0;
      i < 20 && saved(owner.guest.id).phase.kind === "income";
      i++
    ) {
      clock += 500;
      await delay(120);
    }
    const next = saved(owner.guest.id);
    assert.deepEqual(
      [
        next.revision,
        next.round,
        next.phase.kind,
        next.wins,
        next.lives,
        next.chiefBattles,
        next.drachmas,
        next.insight,
      ],
      [4, 2, "prepare", 0, 5, 1, 22, 8],
      "PvE grants no encounter currency, wins or lost lives; normal income and chief growth remain",
    );
    assert.equal(store.replay(owner.guest.id), null);
    assert.deepEqual(
      store.inspect(owner.guest.id, { match: true }).matchmaking,
      { round: 2, submitted: false, available: false },
    );
    assert.deepEqual(store.act(owner.guest.id, claim), claimed);
    store.close();
    store = new GameStore(path, options);
    assert.deepEqual(store.act(owner.guest.id, claim), claimed);
    assert.deepEqual(saved(owner.guest.id), next);
    assert.deepEqual(privateRows(), [0, 0, 0]);
    assert.equal(store.profile(owner.guest.id).rankedGames, 0);
    const ordinaryReady = actionRequest.parse({
      revision: next.revision,
      requestId: randomUUID(),
      actions: [{ op: "ready" }],
    });
    assert.equal(store.act(owner.guest.id, ordinaryReady).status, 202);
    assert.deepEqual(privateRows(), [1, 0, 0]);
    assert.deepEqual(
      store.inspect(owner.guest.id, { match: true }).matchmaking,
      { round: 2, submitted: true, available: false },
    );
    assert.equal(
      store.cancel(owner.guest.id, ordinaryReady.requestId).status,
      200,
    );
    assert.deepEqual(privateRows(), [0, 0, 0]);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
