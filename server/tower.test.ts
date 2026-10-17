import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GameStore, actionRequest } from "./store.ts";
import { newGame, parseGame } from "../src/game.ts";
import { battle } from "../src/combat.ts";
import { tileId } from "../src/map.ts";
import { publicGame } from "../src/read-model.ts";

test("server freezes both teams' tower controllers across preparation edits, UUID retry and reopen without hidden terrain", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "tower-service-"));
  const path = join(directory, "current.sqlite");
  let store: GameStore | undefined;
  try {
    store = new GameStore(path);
    const owner = store.create({ clan: "stag", name: "Tower owner" });
    const rival = store.create({ clan: "raven", name: "Tower rival" });
    store.close();
    store = undefined;
    const prepared = newGame(42, "stag", "async", () => 0);
    prepared.round = 2;
    prepared.placements.push(
      {
        id: "defense-tower",
        tile: tileId.parse(30),
        level: 2,
        workers: 2,
        rune: null,
      },
      {
        id: "thunderbolt-of-zeus",
        tile: tileId.parse(43),
        level: 3,
        workers: 0,
        rune: null,
      },
    );
    const other = newGame(42, "raven", "async", () => 0);
    other.round = 2;
    other.placements.push({
      id: "defense-tower",
      tile: tileId.parse(30),
      level: 1,
      workers: 0,
      rune: null,
    });
    // Trusted preparation fixtures; Ready never accepts client-authored controllers.
    const fixture = new DatabaseSync(path);
    try {
      for (const [id, game] of [
        [owner.guest.id, prepared],
        [rival.guest.id, other],
      ] as const)
        fixture
          .prepare("UPDATE games SET state=? WHERE guest=?")
          .run(JSON.stringify(parseGame(game)), id);
    } finally {
      fixture.close();
    }
    store = new GameStore(path);
    const before = publicGame.parse(store.inspect(owner.guest.id));
    const ready = actionRequest.parse({
      revision: 0,
      requestId: randomUUID(),
      actions: [{ op: "ready" }],
    });
    for (const override of [
      { towers: [] },
      { actions: [{ op: "ready", towers: [] }] },
    ])
      assert.equal(
        actionRequest.safeParse({ ...ready, ...override }).success,
        false,
      );
    assert.equal(store.act(owner.guest.id, ready).status, 202);
    const edited = store.act(owner.guest.id, {
      revision: 0,
      requestId: randomUUID(),
      actions: [{ op: "sell", tile: tileId.parse(30) }],
    });
    assert.equal(edited.status, 200);
    assert.equal(
      store.inspect(owner.guest.id, { match: true }).matchmaking?.submitted,
      false,
      "A later preparation is distinct from the frozen submitted lineup",
    );
    const matched = store.act(rival.guest.id, ready);
    assert.equal(matched.status, 200);
    const replay = store.replay(rival.guest.id);
    assert.ok(replay && "encounter" in replay);
    const encounter = battle.parse(replay.encounter);
    const expected = [
      {
        item: "defense-tower",
        side: "polis",
        origin: { side: "polis", tile: 30 },
        x: -5.75,
        y: -0.85,
        speed: 0.5,
        count: 1,
        damage: 5,
        burn: 0,
        poison: 0,
        frost: 0,
      },
      {
        item: "defense-tower",
        side: "opponent",
        origin: { side: "opponent", tile: 30 },
        x: 5.75,
        y: -0.85,
        speed: 0.5,
        count: 3,
        damage: 10,
        burn: 0,
        poison: 0,
        frost: 0,
      },
      {
        item: "thunderbolt-of-zeus",
        side: "opponent",
        origin: { side: "opponent", tile: 43 },
        x: 5.25,
        y: 0.85,
        speed: 0.1428571492433548,
        count: 15,
        damage: 0,
        burn: 45,
        poison: 0,
        frost: 0,
      },
    ];
    assert.deepEqual(
      encounter.towers,
      expected,
      "The current local controller and the opponent's original submitted controllers are authoritative replay inputs",
    );
    const hidden = before.fog.flatMap((state, id) =>
      state === "hidden" ? [id] : [],
    );
    assert.ok(hidden.length > 0);
    for (const id of hidden)
      assert.deepEqual(encounter.opponentLayout?.map[id]?.slice(3), [
        null,
        null,
      ]);
    const snapshot = new DatabaseSync(path, { readOnly: true });
    try {
      const row = snapshot
        .prepare("SELECT towers FROM ghosts WHERE guest=?")
        .get(owner.guest.id);
      assert.ok(row && typeof row.towers === "string");
      assert.deepEqual(JSON.parse(row.towers), expected.slice(1));
    } finally {
      snapshot.close();
    }
    assert.deepEqual(store.act(rival.guest.id, ready), matched);
    store.close();
    store = new GameStore(path);
    assert.deepEqual(store.replay(rival.guest.id), replay);
    assert.deepEqual(store.act(rival.guest.id, ready), matched);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
