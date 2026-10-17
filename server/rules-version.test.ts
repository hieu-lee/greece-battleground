import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GameStore, schemaVersion } from "./store.ts";
import { rulesVersion } from "../src/rules-version.ts";

test("the service refuses an unversioned populated database without altering saved battles or requests", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-build111-database-"));
  try {
    const path = join(directory, "previous.sqlite");
    const database = new DatabaseSync(path);
    database.exec(
      "CREATE TABLE games (state TEXT); CREATE TABLE receipts (reply TEXT); PRAGMA user_version=2;",
    );
    const battle =
      '{"version":1,"phase":{"kind":"result","outcome":{"winner":"polis"}}}';
    const receipt =
      '{"r":4,"changes":[{"r":4,"delta":{"battle":{"winner":"polis"}}}]}';
    database.prepare("INSERT INTO games VALUES (?)").run(battle);
    database.prepare("INSERT INTO receipts VALUES (?)").run(receipt);
    database.close();
    const bytes = readFileSync(path);
    assert.throws(() => new GameStore(path), /previous-rules/);
    assert.deepEqual(readFileSync(path), bytes);
    const archive = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      archive.prepare("SELECT state FROM games").get()?.state,
      battle,
    );
    assert.equal(
      archive.prepare("SELECT reply FROM receipts").get()?.reply,
      receipt,
    );
    archive.close();
    const freshPath = join(directory, "current.sqlite");
    const store = new GameStore(freshPath);
    const created = store.create({ clan: "raven", name: "Version test" });
    assert.equal(created.state.rulesVersion, "greece-118-v31");
    store.close();
    const resumed = new GameStore(freshPath);
    assert.deepEqual(resumed.inspect(created.guest.id), created.state);
    resumed.close();
    const current = new DatabaseSync(freshPath, { readOnly: true });
    const saved = current.prepare("SELECT state FROM games").get()?.state;
    assert.equal(typeof saved, "string");
    if (typeof saved !== "string") throw new Error("Missing saved game");
    assert.equal(JSON.parse(saved).version, 31);
    assert.equal(
      current.prepare("PRAGMA user_version").get()?.user_version,
      schemaVersion,
    );
    current.close();
    const wrongRules = new DatabaseSync(freshPath);
    wrongRules.prepare("UPDATE rules_metadata SET value='future-rules'").run();
    wrongRules.close();
    assert.throws(() => new GameStore(freshPath), /other game rules/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [kind, expectedError] of [
  ["unversioned", /previous-rules/],
  ["greece-118-v28", /other game rules/],
  ["greece-118-v27", /other game rules/],
  ["greece-118-v26", /other game rules/],
  ["greece-118-v25", /other game rules/],
  ["greece-118-v24", /other game rules/],
  ["greece-118-v23", /other game rules/],
  ["greece-118-v22", /other game rules/],
  ["greece-118-v21", /other game rules/],
  ["greece-118-v20", /other game rules/],
  ["greece-118-v19", /other game rules/],
  ["greece-118-v18", /other game rules/],
  ["greece-118-v14", /other game rules/],
  ["greece-118-v7", /other game rules/],
  ["greece-118-v6", /other game rules/],
  ["greece-118-v5", /other game rules/],
  ["greece-111-v4", /other game rules/],
  ["greece-111-v3", /other game rules/],
  ["greece-111-v2", /other game rules/],
  ["greece-v1", /other game rules/],
  ["foreign-rules", /other game rules/],
  ["future-schema", /newer service/],
] as const) {
  test(`${kind} refusal preserves a surviving WAL archive's durable bytes and saved outcomes`, () => {
    const base = join(homedir(), ".cache/task-tmp");
    mkdirSync(base, { recursive: true });
    const directory = mkdtempSync(join(base, "greece-build111-wal-"));
    try {
      const path = join(directory, "previous.sqlite");
      const oldVersion =
        kind === "greece-118-v28" ? 28 : kind === "greece-118-v27" ? 27 : null;
      const battle =
        oldVersion !== null
          ? ` \r\n{"version":${oldVersion},"rulesVersion":"greece-118-v${oldVersion}","phase":{"kind":"result","outcome":{"winner":"polis","ticks":912}},"label":"Ω •"}\t\n`
          : '{"version":1,"outcome":{"winner":"polis","ticks":912}}';
      const receipt =
        oldVersion !== null
          ? ` \r\n{"r":4,"reply":{"rulesVersion":"greece-118-v${oldVersion}","battle":{"winner":"polis"}},"label":"π"}\t\n`
          : '{"r":4,"reply":{"battle":{"winner":"polis"}}}';
      const producer = spawnSync(
        process.execPath,
        [
          "-e",
          `const { DatabaseSync } = require('node:sqlite');
const database = new DatabaseSync(process.argv[1]);
database.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE games(state TEXT); CREATE TABLE receipts(reply TEXT);');
database.prepare('INSERT INTO games VALUES (?)').run(process.argv[3]);
database.prepare('INSERT INTO receipts VALUES (?)').run(process.argv[4]);
if (process.argv[2] !== 'unversioned') {
  database.exec('CREATE TABLE rules_metadata(id INTEGER PRIMARY KEY,value TEXT);');
  database.prepare('INSERT INTO rules_metadata VALUES (1,?)').run(process.argv[2] === 'foreign-rules' ? 'future-rules' : process.argv[2].startsWith('greece') ? process.argv[2] : process.argv[5]);
}
database.exec('PRAGMA user_version=' + (process.argv[2] === 'future-schema' ? ${schemaVersion + 1} : ['greece-118-v29', 'greece-118-v28', 'greece-118-v27', 'greece-118-v26', 'greece-118-v25', 'greece-118-v24', 'greece-118-v23'].includes(process.argv[2]) ? 12 : process.argv[2] === 'greece-118-v22' ? 11 : process.argv[2] === 'greece-118-v21' ? 10 : ['greece-118-v18', 'greece-118-v14', 'greece-118-v7'].includes(process.argv[2]) ? 9 : process.argv[2] === 'greece-118-v6' ? 7 : process.argv[2] === 'greece-118-v5' ? 6 : process.argv[2] === 'greece-111-v4' ? 4 : process.argv[2] === 'greece-111-v3' ? 3 : process.argv[2] === 'greece-v1' ? 1 : 2));
process.exit(0);`,
          path,
          kind,
          battle,
          receipt,
          rulesVersion,
        ],
        { encoding: "utf8" },
      );
      assert.equal(producer.status, 0, producer.stderr);
      chmodSync(path, 0o640);
      chmodSync(path + "-wal", 0o640);
      const bytes = readFileSync(path);
      const wal = readFileSync(path + "-wal");
      const mode = statSync(path).mode;
      const walMode = statSync(path + "-wal").mode;
      assert.ok(
        wal.length > 0,
        "An abrupt service exit must leave a committed WAL",
      );
      assert.throws(() => new GameStore(path), expectedError);
      const digest = (data: Uint8Array) =>
        createHash("sha256").update(data).digest("hex");
      assert.equal(
        digest(readFileSync(path)),
        digest(bytes),
        "Refusal must not checkpoint the archived database",
      );
      assert.equal(
        digest(readFileSync(path + "-wal")),
        digest(wal),
        "Refusal must preserve the original committed WAL",
      );
      assert.equal(
        statSync(path).mode,
        mode,
        "Refusal must not chmod the archive",
      );
      assert.equal(statSync(path + "-wal").mode, walMode);
      const archive = new DatabaseSync(path, { readOnly: true });
      try {
        assert.equal(
          archive.prepare("SELECT state FROM games").get()?.state,
          battle,
        );
        assert.equal(
          archive.prepare("SELECT reply FROM receipts").get()?.reply,
          receipt,
        );
      } finally {
        archive.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("an older same-rules schema-5 database is refused without changing its runs", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-schema5-"));
  try {
    const path = join(directory, "game.sqlite");
    const store = new GameStore(path);
    store.create({ clan: "stag", name: "Schema five" });
    store.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(`DROP TABLE ghost_matchmaking; DROP TABLE match_history; DROP INDEX ghosts_queue_round_guest;
      ALTER TABLE games DROP COLUMN ranked; ALTER TABLE ghosts DROP COLUMN ranked;
      DROP TABLE profiles; DROP TABLE ranked_battles; DROP TABLE results; DROP TABLE account_sessions; DROP TABLE accounts; PRAGMA user_version=5;`);
    const games = legacy
      .prepare("SELECT guest,run,revision,state,source_opponents FROM games")
      .all();
    legacy.close();
    const archivedBytes = readFileSync(path);
    assert.throws(() => new GameStore(path), /explicit account migration/);
    assert.deepEqual(readFileSync(path), archivedBytes);
    const current = new DatabaseSync(path, { readOnly: true });
    assert.equal(current.prepare("PRAGMA user_version").get()?.user_version, 5);
    assert.deepEqual(
      current
        .prepare("SELECT guest,run,revision,state,source_opponents FROM games")
        .all(),
      games,
    );
    current.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
