import { spawnSync } from "node:child_process";
import { globSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = globSync(["src/**/*.test.ts", "server/**/*.test.ts"], {
  cwd: root,
}).sort();
if (!files.length) throw new Error("No game or server tests were discovered");
const cache = join(homedir(), ".cache/task-tmp");
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, "greece-tests-"));
try {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-webstorage",
      `--localstorage-file=${join(temporary, "storage.sqlite")}`,
      "--test",
      "--test-concurrency=1",
      ...files,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
