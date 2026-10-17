import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession } from "./game.ts";
import { freshRun, runKey } from "./run-storage.ts";
import { createPlaySession } from "./play-session.ts";
import { practiceMatch } from "./warband.ts";

async function ending() {
  const session = gameSession(
    freshRun("stag", "tutorial"),
    () => {},
    () => {},
  );
  for (let i = 0; i < 3; i++) {
    session.act({
      revision: session.state.revision,
      actions: [{ op: "continue" }],
    });
    for (
      let pass = 0;
      pass < 200 && session.state.phase.kind === "income";
      pass++
    )
      session.update(session.runtime.clock.last + 500);
  }
  const game = session.state;
  game.round = 6;
  game.season = "summer";
  game.phase = {
    kind: "result",
    battleId: 1,
    encounter: practiceMatch(game),
    outcome: { winner: "polis", ticks: 20, survivors: [1, 0] },
  };
  const result = gameSession(
    game,
    () => {},
    () => {},
  );
  result.act({ revision: game.revision, actions: [{ op: "continue" }] });
  for (let pass = 0; pass < 200 && result.state.phase.kind === "income"; pass++)
    result.update(result.runtime.clock.last + 500);
  localStorage.setItem(runKey("tutorial"), JSON.stringify(result.state));
  return createPlaySession({
    network: false,
    tutorial: true,
    signal: new AbortController().signal,
  });
}
async function leave(session: Awaited<ReturnType<typeof createPlaySession>>) {
  const action: unknown = Reflect.get(session, "leaveTutorial");
  assert.equal(
    typeof action,
    "function",
    "Session must own the saved-byte CAS for tutorial Leave",
  );
  if (typeof action !== "function") throw new Error("Missing leave action");
  await action();
}

test("ending Leave clears only its own current tutorial and cannot resurrect the closed run", async () => {
  localStorage.clear();
  try {
    const session = await ending();
    const preserved = new Map([
      [runKey("practice"), "ordinary practice bytes Ω\n"],
      ["greece-battleground.tutorial.v26", " \r\nprevious result bytes\t\n"],
      ["unrelated-account-token", "other task identity"],
    ]);
    for (const [key, value] of preserved) localStorage.setItem(key, value);
    await leave(session);
    assert.equal(localStorage.getItem(runKey("tutorial")), null);
    for (const [key, value] of preserved)
      assert.equal(localStorage.getItem(key), value);
    await assert.rejects(
      () =>
        session.act({
          revision: session.state.revision,
          actions: [{ op: "continue" }],
        }),
      /closed|left|ended/i,
    );
    assert.equal(localStorage.getItem(runKey("tutorial")), null);
  } finally {
    localStorage.clear();
  }
});

test("ending Leave refuses a different tab's replacement without deleting either save or archive", async () => {
  localStorage.clear();
  try {
    const session = await ending();
    const replacement = JSON.stringify(freshRun("raven", "tutorial"));
    localStorage.setItem(runKey("tutorial"), replacement);
    await assert.rejects(() => leave(session), /changed|reload/i);
    assert.equal(localStorage.getItem(runKey("tutorial")), replacement);
  } finally {
    localStorage.clear();
  }
});
