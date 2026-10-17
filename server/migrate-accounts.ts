import { DatabaseSync, backup } from "node:sqlite";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  linkSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { rulesVersion } from "../src/rules-version.ts";
import { createAccountTables } from "./accounts.ts";
import { createMatchmakingTables } from "./matchmaking.ts";

export async function migrateAccounts(
  sourcePath: string,
  destinationPath: string,
) {
  const source = resolve(sourcePath),
    destination = resolve(destinationPath);
  function requireFreshPath() {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try {
        lstatSync(destination + suffix);
        throw new Error(
          "Destination or SQLite sidecar already exists; choose a fresh basename.",
        );
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
  }
  requireFreshPath();
  const database = new DatabaseSync(source, {
    readOnly: true,
    timeout: 3000,
    allowExtension: false,
  });
  let temporary: string | null = null;
  try {
    const version = z
      .object({ user_version: z.number() })
      .parse(database.prepare("PRAGMA user_version").get());
    const rules = z
      .object({ value: z.string() })
      .parse(
        database.prepare("SELECT value FROM rules_metadata WHERE id=1").get(),
      );
    if (
      ![12, 13].includes(version.user_version) ||
      rules.value !== rulesVersion
    )
      throw new Error(
        "Only schema12 or schema13 with the current identical rules identity can be migrated.",
      );
    if (
      version.user_version === 12 &&
      database
        .prepare(
          "SELECT 1 FROM sqlite_schema WHERE name IN ('accounts','account_sessions')",
        )
        .get()
    )
      throw new Error(
        "Schema12 must not contain account tables; preserve and inspect this source.",
      );
    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((row) => row.name),
    );
    if (
      version.user_version === 13 &&
      ["accounts", "account_sessions"].some((table) => !tables.has(table))
    )
      throw new Error("Source schema13 is missing required account tables.");
    if (
      [
        "guests",
        "account_recovery",
        "games",
        "ghosts",
        "deltas",
        "receipts",
        "private_random",
        "rules_metadata",
        "profiles",
        "ranked_battles",
        "results",
      ].some((table) => !tables.has(table))
    )
      throw new Error(
        "Source schema12 or schema13 is missing required tables.",
      );
    if (
      database
        .prepare("SELECT length(key) AS size FROM private_random WHERE id=1")
        .get()?.size !== 32
    )
      throw new Error("Source database has no valid private randomness key.");
    const integrity = z
      .object({ quick_check: z.literal("ok") })
      .array()
      .parse(database.prepare("PRAGMA quick_check").all());
    if (
      integrity.length !== 1 ||
      database.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Source database integrity check failed.");
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    temporary = mkdtempSync(
      join(dirname(destination), ".greece-account-migration-"),
    );
    const staged = join(temporary, "database.sqlite");
    await backup(database, staged);
    chmodSync(staged, 0o600);
    const target = new DatabaseSync(staged, { allowExtension: false });
    try {
      target.exec(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE",
      );
      createAccountTables(target);
      createMatchmakingTables(target);
      target.exec("PRAGMA user_version=14; COMMIT");
    } catch (error) {
      if (target.isTransaction) target.exec("ROLLBACK");
      throw error;
    } finally {
      target.close();
    }
    const handle = openSync(staged, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    requireFreshPath();
    linkSync(staged, destination);
    const directory = openSync(dirname(destination), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    database.close();
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { source: { type: "string" }, destination: { type: "string" } },
  });
  if (!values.source || !values.destination)
    throw new Error(
      "Provide --source schema12-or13.sqlite --destination new-schema14.sqlite",
    );
  await migrateAccounts(values.source, values.destination);
  process.stdout.write(
    JSON.stringify({ migrated: true, schema: 14, rulesVersion }) + "\n",
  );
}
