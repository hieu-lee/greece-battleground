import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlaySession } from "./play-session.ts";
import { runKey } from "./run-storage.ts";

test("the local owner pumps ordinary Income to Shop and abort stops its sole timer without future save writes", async (context) => {
  localStorage.clear();
  let now = 0;
  context.mock.method(performance, "now", () => now);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const lifetime = new AbortController();
  try {
    const session = await createPlaySession({
      network: false,
      tutorial: false,
      signal: lifetime.signal,
    });
    await session.act({
      revision: session.state.revision,
      actions: [{ op: "ready" }, { op: "continue" }],
    });
    assert.equal(session.state.phase.kind, "income");
    const rejected = await session.act({
      revision: session.state.revision,
      actions: [{ op: "ready" }],
    });
    assert.ok(rejected && typeof rejected === "object" && "error" in rejected);
    assert.equal(session.state.phase.kind, "income");
    now = 500;
    context.mock.timers.tick(50);
    assert.equal(session.state.phase.kind, "income");
    now = 1000;
    context.mock.timers.tick(50);
    assert.equal(session.state.phase.kind, "prepare");
    assert.ok(localStorage.getItem(runKey("practice")));
    lifetime.abort();
    const saved = localStorage.getItem(runKey("practice"));
    now = 100000;
    context.mock.timers.tick(100000);
    assert.equal(localStorage.getItem(runKey("practice")), saved);
    await assert.rejects(
      session.act({
        revision: session.state.revision,
        actions: [{ op: "ready" }],
      }),
      /abort/i,
    );
  } finally {
    lifetime.abort();
    localStorage.clear();
  }
});
