import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { GameStore, actionRequest } from "./store.ts";
import { newGame, parseGame } from "../src/game.ts";
import type { Command } from "../src/game.ts";
import { neighbours, tileId } from "../src/map.ts";
import { publicGame } from "../src/read-model.ts";
import { decodePlacement } from "../src/encounter-layout.ts";

async function fixture(manyTargets: boolean) {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "income-timeline-service-"));
  const path = join(directory, "game.sqlite");
  let clock = 0;
  let store = new GameStore(path, { now: () => clock });
  try {
    const owner = store.create({
      clan: "raven",
      name: "Income timeline owner",
    });
    const rival = manyTargets
      ? store.create({ clan: "raven", name: "Income timeline rival" })
      : null;
    store.close();
    const game = newGame(42, "raven", "async", () => 0);
    game.insight = 16;
    game.favor.athena = 5;
    game.fate = ["memory-of-the-polis", null, null];
    const holder = tileId.parse(manyTargets ? 37 : 30);
    if (manyTargets) {
      const hall = game.placements.find((p) => p.id === "polis-hall");
      assert.ok(hall);
      hall.tile = tileId.parse(35);
      game.owned = [holder, ...neighbours(holder), hall.tile];
      game.placements.push({
        tile: holder,
        id: "watchtower",
        level: 1,
        workers: 0,
        rune: null,
      });
      for (const tile of neighbours(holder))
        game.placements.push({
          tile,
          id: "forge",
          level: 1,
          workers: 0,
          rune: null,
        });
    } else {
      game.owned = [...new Set([...game.owned, holder, tileId.parse(31)])];
      game.placements.push(
        { tile: holder, id: "watchtower", level: 1, workers: 0, rune: null },
        {
          tile: tileId.parse(31),
          id: "farm",
          level: 1,
          workers: 0,
          rune: null,
        },
      );
    }
    const database = new DatabaseSync(path);
    try {
      database
        .prepare("UPDATE games SET state=? WHERE guest=?")
        .run(JSON.stringify(parseGame(game)), owner.guest.id);
      if (rival) {
        const other = newGame(42, "raven", "async", () => 0);
        other.round = 2;
        database
          .prepare("UPDATE games SET state=? WHERE guest=?")
          .run(JSON.stringify(parseGame(other)), rival.guest.id);
      }
    } finally {
      database.close();
    }
    store = new GameStore(path, { now: () => clock });
    if (rival)
      assert.equal(
        store.act(
          rival.guest.id,
          actionRequest.parse({
            requestId: randomUUID(),
            revision: 0,
            actions: [{ op: "ready" }],
          }),
        ).status,
        202,
        "a real round2 saved rival ghost is available for Ready",
      );
    const inspect = () => publicGame.parse(store.inspect(owner.guest.id));
    function act(actions: Command[]) {
      const request = actionRequest.parse({
        requestId: randomUUID(),
        revision: inspect().r,
        actions,
      });
      const reply = store.act(owner.guest.id, request);
      assert.equal(reply.status, 200, JSON.stringify(reply));
      return { request, reply };
    }
    const purchase = act([{ op: "fate", slot: 0, tile: holder }]);
    assert.equal(
      inspect()
        .placements.map(decodePlacement)
        .find((p) => p.tile === holder)?.rune,
      "memory-of-the-polis",
    );
    assert.deepEqual(inspect().balance, [11, 0]);
    act([{ op: "ready" }]);
    const claim = act([{ op: "continue" }]);
    return {
      directory,
      path,
      owner,
      purchase,
      claim,
      inspect,
      act,
      get store() {
        return store;
      },
      async advance(milliseconds: number) {
        clock += milliseconds;
        // Wait for the Store's real timer, without a public tick/payment seam.
        await delay(120);
      },
      reopen(newPath = path) {
        store.close();
        store = new GameStore(newPath, { now: () => clock });
      },
      async recoverSnapshot() {
        const snapshot = join(directory, "controlled-checkpoint.sqlite");
        const database = new DatabaseSync(path, { readOnly: true });
        try {
          await backup(database, snapshot);
        } finally {
          database.close();
        }
        store.close();
        store = new GameStore(snapshot, { now: () => clock });
      },
      cleanup() {
        store.close();
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    store.close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

test("Store income uses only its trusted clock and retains live Memory across Shop, Ready, reconnect and UUID retries", async () => {
  const f = await fixture(true);
  try {
    assert.deepEqual(
      [f.inspect().round, f.inspect().phase, f.inspect().balance],
      [2, "income", [22, 0]],
      "Continue starts Income with Hall Coins paid before the first ordinary wait",
    );
    assert.equal(
      actionRequest.safeParse({ ...f.claim.request, now: 1_000_000 }).success,
      false,
      "client input cannot supply elapsed time",
    );
    await delay(550);
    assert.deepEqual(
      [f.inspect().phase, f.inspect().balance],
      ["income", [22, 0]],
      "real wall time cannot bypass the injected trusted clock",
    );
    await f.advance(500);
    assert.deepEqual(
      [f.inspect().phase, f.inspect().balance],
      ["income", [22, 4]],
      "Hall Lore pays only after the first half second",
    );
    await f.advance(500);
    await f.advance(500);
    const shop = f.inspect();
    assert.equal(shop.phase, "prepare");
    assert.ok(
      shop.balance[0] > 22 || shop.balance[1] > 5,
      "Memory has actually paid at least one direct drop",
    );
    assert.ok(
      shop.balance[0] < 28 || shop.balance[1] < 11,
      "six adjacent items leave Memory drops pending after ordinary income reaches Shop",
    );
    assert.equal(f.store.authenticate(f.owner.token)?.id, f.owner.guest.id);
    assert.deepEqual(
      f.store.act(f.owner.guest.id, f.claim.request),
      f.claim.reply,
      "UUID retry returns the exact old command reply",
    );
    assert.deepEqual(
      f.inspect(),
      shop,
      "reconnect and retry retain the current live owner",
    );
    const ready = f.act([{ op: "ready" }]);
    const replay = f.store.replay(f.owner.guest.id);
    assert.ok(replay);
    assert.equal(f.inspect().phase, "result");
    for (let i = 0; i < 13; i++) await f.advance(500);
    assert.deepEqual(
      f.inspect().balance,
      [28, 11],
      "Hall11/4 + Watchtower Lore1 + six Memory Coins/Lore drops survive Ready",
    );
    assert.deepEqual(
      f.store.replay(f.owner.guest.id)?.encounter,
      replay.encounter,
      "late wallet credits do not regenerate the retained authoritative battle",
    );
    assert.deepEqual(f.store.act(f.owner.guest.id, ready.request), ready.reply);
    const final = f.inspect();
    await f.advance(500);
    assert.deepEqual(
      f.inspect(),
      final,
      "settled timers neither credit nor revise again",
    );
    f.reopen();
    assert.deepEqual(f.inspect().balance, [28, 11]);
    assert.deepEqual(
      f.store.act(f.owner.guest.id, f.claim.request),
      f.claim.reply,
      "original UUID reply is durable after cold reopen",
    );
    assert.deepEqual(f.store.act(f.owner.guest.id, ready.request), ready.reply);
  } finally {
    f.cleanup();
  }
});

test("graceful Store close during Income saves Shop with only the current partial wallet", async () => {
  const f = await fixture(false);
  try {
    assert.deepEqual(
      [f.inspect().phase, f.inspect().balance],
      ["income", [22, 0]],
    );
    f.reopen();
    assert.deepEqual(
      [f.inspect().round, f.inspect().phase, f.inspect().balance],
      [2, "prepare", [22, 0]],
      "successful mid-Income SaveGame skips the remaining ordinary operands",
    );
    await f.advance(100_000);
    assert.deepEqual(
      f.inspect().balance,
      [22, 0],
      "cold reopen restores no pending tasks and pays no offline income",
    );
    assert.deepEqual(
      f.store.act(f.owner.guest.id, f.claim.request),
      f.claim.reply,
    );
    assert.deepEqual(f.inspect().balance, [22, 0]);
  } finally {
    f.cleanup();
  }
});

test("graceful Store close in Shop discards unpaid Memory without replaying ordinary income", async () => {
  const f = await fixture(true);
  try {
    for (let i = 0; i < 3; i++) await f.advance(500);
    const before = f.inspect();
    assert.equal(before.phase, "prepare");
    assert.ok(
      before.balance[0] > 22 || before.balance[1] > 5,
      "the captured partial wallet includes an actual Memory payment",
    );
    assert.ok(
      before.balance[0] < 28 || before.balance[1] < 11,
      "actual live callbacks remain pending at Shop",
    );
    f.reopen();
    assert.deepEqual(f.inspect().balance, before.balance);
    await f.advance(100_000);
    assert.deepEqual(
      [f.inspect().phase, f.inspect().balance],
      ["prepare", before.balance],
      "graceful Shop recreation neither drains nor resurrects old Memory",
    );
    assert.deepEqual(
      f.store.act(f.owner.guest.id, f.claim.request),
      f.claim.reply,
    );
  } finally {
    f.cleanup();
  }
});

test("controlled committed database recovery uses the pre-Income checkpoint and retains exact UUID replies", async () => {
  const f = await fixture(false);
  try {
    await f.advance(500);
    assert.deepEqual(
      [f.inspect().phase, f.inspect().balance],
      ["income", [22, 4]],
    );
    const revision = f.inspect().r;
    await f.recoverSnapshot();
    assert.deepEqual(
      [f.inspect().round, f.inspect().phase, f.inspect().balance],
      [2, "income", [22, 0]],
      "a copied live database retains the earlier source checkpoint, not an invented resumed wrapper offset",
    );
    assert.ok(
      f.inspect().r > revision,
      "reconstruction changes have a newer discoverable revision",
    );
    assert.deepEqual(
      f.store.act(f.owner.guest.id, f.claim.request),
      f.claim.reply,
      "already committed Continue is never re-executed",
    );
    for (let i = 0; i < 10; i++) await f.advance(500);
    assert.deepEqual(
      [f.inspect().phase, f.inspect().balance],
      ["prepare", [24, 6]],
      "fresh full Income pays Hall11/4, Farm1, Watchtower Lore1 and one Memory drop per currency once",
    );
    const final = f.inspect();
    assert.deepEqual(
      f.store.act(f.owner.guest.id, f.claim.request),
      f.claim.reply,
    );
    assert.deepEqual(f.inspect(), final);
  } finally {
    f.cleanup();
  }
});
