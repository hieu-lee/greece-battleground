import assert from "node:assert/strict";
import { test } from "node:test";
import { exportRunArchive, freshRun, readRun, runKey } from "./run-storage.ts";

test("a current save under the other local mode's key is preserved for export and never resumed as that run", () => {
  localStorage.clear();
  try {
    for (const mode of ["practice", "tutorial"] as const) {
      const other = mode === "practice" ? "tutorial" : "practice";
      const encoded = JSON.stringify(freshRun("stag", other));
      localStorage.setItem(runKey(mode), encoded);
      const saved = readRun(mode);
      assert.equal(saved.game, null);
      assert.ok(saved.issue);
      assert.equal(saved.encoded, encoded);
      assert.equal(localStorage.getItem(runKey(mode)), encoded);
      assert.equal(exportRunArchive(mode, runKey(mode))?.content, encoded);
    }
  } finally { localStorage.clear(); }
});
