import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStore, actionRequest } from "./store.ts";
import { newGame, parseGame } from "../src/game.ts";
import { grid, tileId } from "../src/map.ts";
import { fighter } from "../src/combat.ts";
import { publicGame } from "../src/read-model.ts";
import { setTimeout as delay } from "node:timers/promises";

for (const creditedSide of ["polis", "opponent"] as const)
  test(`War Lessons ${creditedSide} kills pay at Ready and survive stored ghost, retry, reopen and claim without a second credit`, async () => {
    const base = join(homedir(), ".cache/task-tmp");
    mkdirSync(base, { recursive: true });
    const directory = mkdtempSync(join(base, "war-lessons-service-"));
    const path = join(directory, "game.sqlite");
    let clock = 0;
    const options = { now: () => clock };
    let store = new GameStore(path, options);
    const inspect = (id: string) => publicGame.parse(store.inspect(id));
    try {
      const trained = store.create({
        clan: "stag",
        name: "War Lessons holder",
      });
      const plain = store.create({ clan: "stag", name: "Plain chief" });
      store.close();
      const fixture = new DatabaseSync(path);
      try {
        for (const guest of [trained.guest.id, plain.guest.id]) {
          // Trusted preparation fixture; requests contain only Ready, never an army.
          const game = newGame(42, "stag", "async", () => 0);
          game.round = 2;
          game.owned = grid
            .filter((tile) => tile.playable)
            .map((tile) => tile.id);
          const hall = game.placements.find((p) => p.id === "polis-hall");
          assert.ok(hall);
          hall.tile = tileId.parse(14);
          if (guest === trained.guest.id)
            game.placements.push({
              id: "javelin-camp",
              tile: tileId.parse(44),
              level: 3,
              workers: 3,
              rune: "athenas-war-lessons",
            });
          fixture
            .prepare("UPDATE games SET state=? WHERE guest=?")
            .run(JSON.stringify(parseGame(game)), guest);
        }
      } finally {
        fixture.close();
      }
      store = new GameStore(path, options);
      const ready = actionRequest.parse({
        requestId: randomUUID(),
        revision: 0,
        actions: [{ op: "ready" }],
      });
      assert.equal(store.act(trained.guest.id, ready).status, 202);
      assert.equal(inspect(trained.guest.id).balance[1], 4);
      const submitted = new DatabaseSync(path, { readOnly: true });
      try {
        const row = submitted
          .prepare("SELECT fighters FROM ghosts WHERE guest=?")
          .get(trained.guest.id);
        assert.ok(row && typeof row.fighters === "string");
        assert.deepEqual(
          fighter
            .array()
            .parse(JSON.parse(row.fighters))
            .filter((unit) => unit.killInsight === 1)
            .map((unit) => [unit.side, unit.sprite]),
          [
            ["opponent", "peltast"],
            ["opponent", "peltast"],
            ["opponent", "peltast"],
          ],
        );
      } finally {
        submitted.close();
      }
      const plainReady = store.act(plain.guest.id, ready);
      const trainedReady = store.act(trained.guest.id, ready);
      assert.equal(plainReady.status, 200);
      assert.equal(trainedReady.status, 200);
      const guest =
        creditedSide === "polis" ? trained.guest.id : plain.guest.id;
      const receipt = creditedSide === "polis" ? trainedReady : plainReady;
      const replay = store.replay(guest);
      assert.ok(replay);
      assert.deepEqual(
        replay.encounter.fighters
          .filter((unit) => unit.killInsight === 1)
          .map((unit) => [unit.side, unit.sprite]),
        [
          [creditedSide, "peltast"],
          [creditedSide, "peltast"],
          [creditedSide, "peltast"],
        ],
      );
      assert.equal(replay.outcome.winner, creditedSide);
      assert.equal(replay.outcome.insight, 1);
      assert.equal(
        inspect(guest).balance[1],
        5,
        "Ready credits the one actual qualifying kill before Continue",
      );
      const settled = inspect(guest);
      assert.deepEqual(store.act(guest, ready), receipt);
      assert.deepEqual(inspect(guest), settled);
      store.close();
      store = new GameStore(path, options);
      assert.deepEqual(store.replay(guest), replay);
      assert.deepEqual(inspect(guest), settled);
      assert.deepEqual(store.act(guest, ready), receipt);
      assert.deepEqual(inspect(guest), settled);
      const claim = actionRequest.parse({
        requestId: randomUUID(),
        revision: settled.r,
        actions: [{ op: "continue" }],
      });
      const claimed = store.act(guest, claim);
      assert.equal(claimed.status, 200);
      for (let i = 0; i < 20 && inspect(guest).phase === "income"; i++) {
        clock += 500;
        await delay(120);
      }
      assert.deepEqual(
        [inspect(guest).round, inspect(guest).phase, inspect(guest).balance[1]],
        [3, "prepare", 10],
        "Continue adds only five ordinary Insight from the Hall and owned Circle, without paying the kill again",
      );
      const next = inspect(guest);
      assert.deepEqual(store.act(guest, claim), claimed);
      assert.deepEqual(inspect(guest), next);
      assert.equal(store.replay(guest), null);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
