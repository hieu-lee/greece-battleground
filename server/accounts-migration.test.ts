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
      "DROP TABLE account_sessions; DROP TABLE accounts; PRAGMA user_version=12",
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

test("schema13 snapshot refuses a missing account-session table before publishing", () => {
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
