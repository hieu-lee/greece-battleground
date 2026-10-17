import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GameStore, actionRequest } from "./store.ts";
import { newGame, parseGame } from "../src/game.ts";
import { grid, sourceMap, tileId } from "../src/map.ts";
import { warband } from "../src/warband.ts";
import { fighter } from "../src/combat.ts";

test("server recomputes owned/current Coins counts and publishes server-built opponent snapshots", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "sentry-mercenary-owner-"));
  const path = join(directory, "current.sqlite");
  let store: GameStore | undefined;
  try {
    store = new GameStore(path);
    const created = store.create({ clan: "raven", name: "Count owner" });
    store.close();
    store = undefined;
    const game = newGame(42, "raven", "async", () => 0);
    game.round = 2;
    game.drachmas = 12;
    game.skills = [1, 1, 1];
    game.owned = grid.filter((t) => t.playable).map((t) => t.id);
    game.placements.push(
      {
        id: "sentry-camp",
        tile: tileId.parse(29),
        level: 1,
        workers: 0,
        rune: null,
      },
      {
        id: "misthophoros-camp",
        tile: tileId.parse(44),
        level: 1,
        workers: 0,
        rune: null,
      },
      {
        id: "silver-mine",
        tile: tileId.parse(14),
        level: 1,
        workers: 3,
        rune: null,
      },
    );
    const cyclopsTile = game.owned.find(
      (tile) =>
        !game.placements.some((placement) => placement.tile === tile) &&
        !sourceMap(game.seed).tiles[tile]?.feature,
    );
    assert.ok(cyclopsTile !== undefined);
    game.placements.push({
      id: "gigantes-camp",
      tile: cyclopsTile,
      level: 1,
      workers: 0,
      rune: null,
    });
    const frostTile = game.owned.find(
      (tile) =>
        !game.placements.some((p) => p.tile === tile) &&
        !sourceMap(game.seed).tiles[tile]?.feature,
    );
    assert.ok(frostTile !== undefined);
    game.placements.push({
      id: "charons-barge",
      tile: frostTile,
      level: 1,
      workers: 0,
      rune: null,
    });
    // Fixture writes private server state; the client request never supplies it.
    const fixture = new DatabaseSync(path);
    fixture
      .prepare("UPDATE games SET state=? WHERE guest=?")
      .run(JSON.stringify(parseGame(game)), created.guest.id);
    fixture.close();
    store = new GameStore(path);
    const before = store.inspect(created.guest.id, { own: true });
    assert.equal(before.warband?.filter((u) => u[0] === "Peripolos").length, 1);
    assert.equal(
      before.warband?.filter((u) => u[0] === "Misthophoros").length,
      2,
    );
    const buy = actionRequest.parse({
      revision: 0,
      requestId: randomUUID(),
      actions: [{ op: "villager" }],
    });
    assert.equal(store.act(created.guest.id, buy).status, 200);
    assert.equal(
      store
        .inspect(created.guest.id, { own: true })
        .warband?.filter((u) => u[0] === "Misthophoros").length,
      1,
    );
    assert.equal(store.act(created.guest.id, buy).status, 200);
    assert.equal(
      store
        .inspect(created.guest.id, { own: true })
        .warband?.filter((u) => u[0] === "Misthophoros").length,
      1,
    );
    for (const override of [
      { fighters: [] },
      { count: 99 },
      { actions: [{ op: "ready", count: 99 }] },
    ])
      assert.equal(
        actionRequest.safeParse({ ...buy, ...override }).success,
        false,
      );
    const ready = actionRequest.parse({
      revision: 1,
      requestId: randomUUID(),
      actions: [{ op: "ready" }],
    });
    assert.equal(store.act(created.guest.id, ready).status, 202);
    const snapshot = new DatabaseSync(path, { readOnly: true });
    const row = snapshot
      .prepare("SELECT fighters FROM ghosts WHERE guest=?")
      .get(created.guest.id);
    assert.ok(row && typeof row.fighters === "string");
    const submitted = fighter.array().parse(JSON.parse(row.fighters));
    assert.equal(
      submitted.find((unit) => unit.sprite === "cyclops")?.stun,
      0.4000000059604645,
      "The server-built immutable ghost retains Cyclops Stun",
    );
    const giant = submitted.find((unit) => unit.sprite === "boreal-giant");
    assert.equal(
      giant?.frost,
      8,
      "Ghost Frost uses the current server-owned Coins after purchase",
    );
    assert.deepEqual(giant?.speedStat, {
      basis: 0.4000000059604645,
      multiply: 1,
    });
    const latest = {
      ...game,
      revision: 1,
      drachmas: 8,
      workers: 1,
      villagerPurchases: 1,
    };
    assert.deepEqual(submitted, warband(parseGame(latest), "opponent"));
    snapshot.close();
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
