import { backup, DatabaseSync } from "node:sqlite";
import { chmod, link, lstat, mkdtemp, open, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { schemaVersion } from "./store.ts";
import { rulesVersion } from "../src/rules-version.ts";

const requiredTables = [
  "guests",
  "account_recovery",
  "accounts",
  "account_sessions",
  "games",
  "ghosts",
  "deltas",
  "receipts",
  "private_random",
  "rules_metadata",
  "profiles",
  "ranked_battles",
  "results",
];

function validate(database: DatabaseSync) {
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok")
    throw new Error("Database integrity check failed");
  if (database.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Database foreign key check failed");
  if (
    database.prepare("PRAGMA user_version").get()?.user_version !==
    schemaVersion
  )
    throw new Error("Database schema is not the current schema");
  const tables = new Set(
    database
      .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
      .all()
      .map((row) => row.name),
  );
  if (requiredTables.some((name) => !tables.has(name)))
    throw new Error("Database is missing current schema tables");
  if (
    database.prepare("SELECT value FROM rules_metadata WHERE id=1").get()
      ?.value !== rulesVersion
  )
    throw new Error("Database belongs to another game engine");
  if (
    database
      .prepare("SELECT length(key) AS size FROM private_random WHERE id=1")
      .get()?.size !== 32
  )
    throw new Error("Database has no valid private randomness key");
}

const { values } = parseArgs({
  options: {
    database: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.database || !values.output)
  throw new Error(
    "Provide --database /path/source.sqlite --output /path/new.sqlite",
  );
const source = resolve(values.database);
const destination = resolve(values.output);
const parent = dirname(destination);
const sourceInfo = await stat(source);
if (!sourceInfo.isFile()) throw new Error("Source must be a SQLite file");
if (!(await stat(parent)).isDirectory())
  throw new Error("Output parent must exist");
if (destination === source)
  throw new Error("Do not overwrite the source database");
async function requireFreshPath() {
  // A dangling symlink is occupied too: `exists` and `stat` miss it.
  for (const path of [
    destination,
    destination + "-wal",
    destination + "-shm",
    destination + "-journal",
  ]) {
    try {
      await lstat(path);
      throw new Error(
        "Output path or SQLite sidecar already exists; choose a fresh basename",
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
await requireFreshPath();
const original = new DatabaseSync(source, {
  readOnly: true,
  timeout: 5000,
  allowExtension: false,
});
let temporary: string | undefined;
try {
  validate(original);
  temporary = await mkdtemp(join(parent, ".greece-snapshot-"));
  const staged = join(temporary, "database.sqlite");
  await backup(original, staged);
  await chmod(staged, 0o600);
  const writable = new DatabaseSync(staged, { allowExtension: false });
  try {
    if (
      writable.prepare("PRAGMA journal_mode=DELETE").get()?.journal_mode !==
      "delete"
    )
      throw new Error("Snapshot could not be made self-contained");
  } finally {
    writable.close();
  }
  const checked = new DatabaseSync(staged, {
    readOnly: true,
    allowExtension: false,
  });
  try {
    validate(checked);
  } finally {
    checked.close();
  }
  const handle = await open(staged, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await requireFreshPath();
  // link(2) is an atomic no-replace publish, unlike rename(2) or backup's target behavior.
  await link(staged, destination);
  const directory = await open(parent, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  process.stdout.write("Verified database snapshot published at new path\n");
} finally {
  original.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
