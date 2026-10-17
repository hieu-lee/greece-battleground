import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GameStore } from "./store.ts";
import { migrateAccounts } from "./migrate-accounts.ts";
import { rulesVersion } from "../src/rules-version.ts";

test("account migration refuses occupied SQLite destination sidecars without changing them", async () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(join(base, "greece-account-http-"));
  try {
    const source = join(folder, "source.sqlite"),
      store = new GameStore(source);
    store.create({ name: "Sidecar migration fixture", clan: "raven" });
    store.close();
    const previous = new DatabaseSync(source);
    previous.exec(
      "DROP TABLE IF EXISTS ghost_matchmaking; DROP TABLE IF EXISTS match_history; DROP TABLE account_sessions; DROP TABLE accounts; PRAGMA user_version=12",
    );
    previous.close();
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const destination = join(folder, suffix.slice(1) + ".sqlite"),
        occupied = destination + suffix,
        bytes = Buffer.from("Unrelated pre-existing SQLite sidecar");
      writeFileSync(occupied, bytes);
      await assert.rejects(
        migrateAccounts(source, destination),
        /already exists|fresh basename/i,
      );
      assert.equal(existsSync(destination), false);
      assert.ok(readFileSync(occupied).equals(bytes));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("current-schema snapshot refuses a missing account-session table before publishing", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(join(base, "greece-account-http-"));
  try {
    const source = join(folder, "malformed.sqlite"),
      destination = join(folder, "archive.sqlite"),
      store = new GameStore(source);
    store.create({ name: "Snapshot validation fixture", clan: "raven" });
    store.close();
    const malformed = new DatabaseSync(source);
    malformed.exec("DROP TABLE account_sessions");
    malformed.close();
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./snapshot.ts", import.meta.url)),
        "--database",
        source,
        "--output",
        destination,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("account migration refuses incomplete schema12 without publishing or rewriting the source", async () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(join(base, "greece-account-http-"));
  try {
    const source = join(folder, "incomplete.sqlite"),
      destination = join(folder, "destination.sqlite"),
      fixture = new DatabaseSync(source);
    fixture.exec(
      "CREATE TABLE rules_metadata(id INTEGER PRIMARY KEY,value TEXT); PRAGMA user_version=12",
    );
    fixture.prepare("INSERT INTO rules_metadata VALUES(1,?)").run(rulesVersion);
    fixture.close();
    const before = readFileSync(source);
    await assert.rejects(
      migrateAccounts(source, destination),
      /missing|schema/i,
    );
    assert.equal(existsSync(destination), false);
    assert.ok(readFileSync(source).equals(before));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("schema13 migration preserves account sessions, legacy ghosts and receipts without inventing matchmaking metadata", async () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(join(base, "greece-account-migration-"));
  try {
    const source = join(folder, "source13.sqlite"),
      destination = join(folder, "destination14.sqlite"),
      owner = new GameStore(source);
    const authorization = await owner.signupAccount(
      {
        username: "migration13",
        password: "Migration fixture password only",
        guest: {
          name: "Schema13 migration fixture",
          clan: "raven",
          queue: "ranked",
        },
      },
      null,
    );
    const guest = authorization.account.guest.id;
    owner.act(guest, {
      requestId: "11111111-1111-4111-8111-111111111111",
      revision: 0,
      actions: [{ op: "villager" }],
    });
    owner.close();
    const previous = new DatabaseSync(source);
    previous.exec(`
      DROP TABLE IF EXISTS ghost_matchmaking;
      DROP TABLE IF EXISTS match_history;
      PRAGMA user_version=13;
      INSERT INTO ghosts (guest,run,round,revision,fighters,horns,towers,layout,lineup_hash,ranked)
        SELECT guest,run,2,revision,'[]','[]','[]','null','legacy-lineup',1 FROM games;
      INSERT INTO ranked_battles (guest,run,round,opponent_elo)
        SELECT guest,run,2,1000 FROM games;
      INSERT INTO results (guest,run,ranked,wins,outcome,xp_award,k,opponent_elo,elo_before,elo_change,elo_after)
        SELECT guest,run,1,4,'defeat',2,40,1000,1000,-20,980 FROM games;
    `);
    const tables = previous
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
      )
      .all()
      .map(({ name }) => {
        assert.ok(typeof name === "string");
        return name;
      });
    const original = Object.fromEntries(
      tables.map((name) => [
        name,
        JSON.stringify(
          previous.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
        ),
      ]),
    );
    for (const table of [
      "accounts",
      "account_sessions",
      "ghosts",
      "receipts",
      "results",
    ])
      assert.equal(
        previous.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()
          ?.count,
        1,
        table + " fixture has an archived row",
      );
    previous.close();
    const bytes = readFileSync(source);
    await migrateAccounts(source, destination);
    assert.ok(readFileSync(source).equals(bytes), "source bytes stay archived");
    const copied = new DatabaseSync(destination, { readOnly: true });
    try {
      assert.equal(
        copied.prepare("PRAGMA user_version").get()?.user_version,
        14,
      );
      for (const [table, expected] of Object.entries(original))
        assert.equal(
          JSON.stringify(
            copied.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
          ),
          expected,
        );
      assert.equal(
        copied.prepare("SELECT COUNT(*) AS count FROM ghost_matchmaking").get()
          ?.count,
        0,
      );
      assert.equal(
        copied.prepare("SELECT COUNT(*) AS count FROM match_history").get()
          ?.count,
        0,
      );
      assert.deepEqual(copied.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      copied.close();
    }
    const migrated = new GameStore(destination);
    try {
      assert.deepEqual(migrated.accountSession(authorization.session.token), {
        account: authorization.account,
        expiresAt: authorization.session.expiresAt,
      });
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("schema13 migration refuses missing account tables without publishing or rewriting the source", async () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const folder = mkdtempSync(join(base, "greece-account-migration-"));
  try {
    const source = join(folder, "incomplete13.sqlite"),
      destination = join(folder, "destination14.sqlite"),
      owner = new GameStore(source);
    owner.create({ name: "Incomplete schema13 fixture", clan: "raven" });
    owner.close();
    const previous = new DatabaseSync(source);
    previous.exec("DROP TABLE account_sessions; PRAGMA user_version=13");
    previous.close();
    const bytes = readFileSync(source);
    await assert.rejects(
      migrateAccounts(source, destination),
      /schema13.*missing.*account/i,
    );
    assert.equal(existsSync(destination), false);
    assert.ok(readFileSync(source).equals(bytes));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
