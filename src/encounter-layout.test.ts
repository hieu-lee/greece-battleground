import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { newGame, apply, parseGame } from "./game.ts";
import { warband, practiceMatch } from "./warband.ts";
import { battle, createCombat } from "./combat.ts";
import { tileId } from "./map.ts";
import { sourceItemCosts } from "./source-numbers.ts";
import { GameStore } from "../server/store.ts";
import { replaySchema, publicGame, mapRows } from "./read-model.ts";

// Game commands are the same public owner used by practice; no test-only exports.
test("chief and each camp worker retain their actual source tile through save and combat movement", () => {
  let game = newGame(42, "raven");
  game.drachmas = 24;
  game.shop = [
    { id: "spear-camp", price: sourceItemCosts["spear-camp"] },
    { id: "archer-camp", price: sourceItemCosts["archer-camp"] },
    null,
    null,
  ];
  game = apply(game, { op: "buy", slot: 0, tile: tileId.parse(30) });
  game = apply(game, { op: "buy", slot: 1, tile: tileId.parse(43) });
  const units = warband(game, "polis");
  assert.deepEqual(
    units.map((u) => [u.sprite, u.origin]),
    [
      ["atalanta", { side: "polis", tile: 37 }],
      ["hoplite", { side: "polis", tile: 30 }],
      ["tracker", { side: "polis", tile: 43 }],
    ],
  );
  const result = apply(game, { op: "ready" });
  const resumed = parseGame(JSON.parse(JSON.stringify(result)));
  assert.equal(resumed.phase.kind, "result");
  if (resumed.phase.kind !== "result") throw new Error("Missing result");
  const combat = createCombat(resumed.phase.encounter);
  for (let i = 0; i < 20; i++) combat.advance();
  assert.deepEqual(
    combat.units.filter((u) => u.side === "polis").map((u) => u.origin),
    [
      { side: "polis", tile: 37 },
      { side: "polis", tile: 30 },
      { side: "polis", tile: 43 },
    ],
  );
});

test("synthetic practice opponents have no invented settlement or originating camp", () => {
  const encounter = practiceMatch(newGame());
  assert.equal(encounter.opponentLayout, null);
  assert.ok(
    encounter.fighters
      .filter((u) => u.side === "opponent")
      .every((u) => u.origin === null),
  );
  assert.throws(
    () => battle.parse({ ...encounter, kind: "pvp" }),
    /actual opponent layout/,
  );
  assert.throws(
    () =>
      battle.parse({
        ...encounter,
        fighters: encounter.fighters.map((u, i) =>
          i === 0 ? { ...u, origin: { side: "opponent", tile: 37 } } : u,
        ),
      }),
    /origin side mismatch/,
  );
});

const WORKERS = join(homedir(), ".cache/task-tmp");
function withStore(run: (store: GameStore, path: string) => void) {
  mkdirSync(WORKERS, { recursive: true });
  const directory = mkdtempSync(join(WORKERS, "greece-layout-contract-"));
  const path = join(directory, "game.sqlite");
  const store = new GameStore(path);
  try {
    run(store, path);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
}

function prepareOrdinaryRound(path: string, guest: string) {
  // Trusted server fixture: these layout contracts exercise round-2 PvP, after authored PvE.
  const database = new DatabaseSync(path);
  try {
    const row = database
      .prepare("SELECT state FROM games WHERE guest=?")
      .get(guest);
    assert.ok(row && typeof row.state === "string");
    const game = parseGame(JSON.parse(row.state));
    game.round = 2;
    database
      .prepare("UPDATE games SET state=? WHERE guest=?")
      .run(JSON.stringify(parseGame(game)), guest);
  } finally {
    database.close();
  }
}

test("matched replay retains the submitted opponent's exact layout after further edits and SQLite restart", () => {
  withStore((store, path) => {
    const first = store.create({ clan: "raven", name: "Submitted layout" });
    prepareOrdinaryRound(path, first.guest.id);
    const before = publicGame.parse(store.inspect(first.guest.id));
    const frontier = tileId.parse(before.fog.indexOf("unlockable"));
    const beforeMap = mapRows.parse(
      store.inspect(first.guest.id, { map: true }).map,
    );
    const pending = store.act(first.guest.id, {
      revision: 0,
      actions: [{ op: "ready" }],
      requestId: randomUUID(),
    });
    assert.equal(pending.status, 202);
    const edited = store.act(first.guest.id, {
      revision: 0,
      actions: [{ op: "villager" }, { op: "colonize", tile: frontier }],
      requestId: randomUUID(),
    });
    assert.equal(edited.status, 200);
    const second = store.create({ clan: "stag", name: "Recipient" });
    prepareOrdinaryRound(path, second.guest.id);
    assert.equal(
      store.act(second.guest.id, {
        revision: 0,
        actions: [{ op: "ready" }],
        requestId: randomUUID(),
      }).status,
      200,
    );
    const replay = replaySchema.parse(store.replay(second.guest.id));
    // Hidden fog cells reach neither the owner's public map nor the rival's replay payload.
    const hidden = before.fog.flatMap((state, id) =>
      state === "hidden" ? [id] : [],
    );
    assert.ok(hidden.length > 0);
    for (const rows of [beforeMap, replay.encounter.opponentLayout?.map ?? []])
      for (const id of hidden)
        assert.deepEqual(rows[id]?.slice(3), [null, null]);
    assert.deepEqual(replay.encounter.opponentLayout, {
      clan: "raven",
      map: beforeMap,
      owned: before.owned,
      featureRunes: before.featureRunes,
      placements: before.placements,
    });
    assert.deepEqual(
      replay.encounter.fighters
        .filter((u) => u.side === "opponent")
        .map((u) => u.origin),
      [{ side: "opponent", tile: 37 }],
    );
    const reloaded = new GameStore(path);
    try {
      assert.deepEqual(reloaded.replay(second.guest.id), replay);
    } finally {
      reloaded.close();
    }
    const layout = replay.encounter.opponentLayout;
    assert.ok(layout);
    assert.throws(
      () =>
        battle.parse({
          ...replay.encounter,
          opponentLayout: {
            ...layout,
            owned: [...layout.owned, layout.owned[0]],
          },
        }),
      /Invalid opponent settlement/,
    );
    assert.throws(
      () =>
        battle.parse({
          ...replay.encounter,
          fighters: replay.encounter.fighters.map((u) =>
            u.side === "opponent"
              ? { ...u, origin: { side: "opponent", tile: tileId.parse(35) } }
              : u,
          ),
        }),
      /actual opponent layout/,
    );
  });
});

test("cancelling an old pending UUID preserves a newer territory-only submission", () => {
  withStore((store, path) => {
    const first = store.create({ clan: "raven", name: "Cancellation lineage" });
    prepareOrdinaryRound(path, first.guest.id);
    const frontier = tileId.parse(
      publicGame.parse(store.inspect(first.guest.id)).fog.indexOf("unlockable"),
    );
    const oldId = randomUUID(),
      nextId = randomUUID();
    assert.equal(
      store.act(first.guest.id, {
        revision: 0,
        actions: [{ op: "ready" }],
        requestId: oldId,
      }).status,
      202,
    );
    assert.equal(
      store.act(first.guest.id, {
        revision: 0,
        actions: [{ op: "villager" }, { op: "colonize", tile: frontier }],
        requestId: randomUUID(),
      }).status,
      200,
    );
    assert.equal(
      store.act(first.guest.id, {
        revision: 1,
        actions: [{ op: "ready" }],
        requestId: nextId,
      }).status,
      202,
    );
    assert.equal(store.cancel(first.guest.id, oldId).status, 200);
    const match = store.inspect(first.guest.id, { match: true }).matchmaking;
    assert.ok(match);
    assert.equal(match.submitted, true);
    const other = store.create({ clan: "stag", name: "Newer ghost recipient" });
    prepareOrdinaryRound(path, other.guest.id);
    assert.equal(
      store.act(other.guest.id, {
        revision: 0,
        actions: [{ op: "ready" }],
        requestId: randomUUID(),
      }).status,
      200,
    );
    assert.ok(
      store
        .replay(other.guest.id)
        ?.encounter.opponentLayout?.owned.includes(frontier),
    );
  });
});

test("previous rules databases are rejected without altering their stored bytes", () => {
  mkdirSync(WORKERS, { recursive: true });
  const directory = mkdtempSync(join(WORKERS, "greece-layout-legacy-"));
  const path = join(directory, "previous.sqlite");
  try {
    const database = new DatabaseSync(path);
    database.exec(
      "CREATE TABLE rules_metadata(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO rules_metadata VALUES(1,'greece-111-v2'); PRAGMA user_version=2;",
    );
    database.close();
    const bytes = readFileSync(path);
    assert.throws(() => new GameStore(path), /other game rules/);
    assert.deepEqual(readFileSync(path), bytes);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
