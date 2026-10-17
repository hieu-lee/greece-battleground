import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession } from "./game.ts";
import { freshRun } from "./run-storage.ts";

function finishIncome(session: ReturnType<typeof gameSession>) {
  for (
    let pass = 0;
    pass < 100 && session.state.phase.kind === "income";
    pass++
  )
    session.update(session.runtime.clock.last + 500);
}

function start() {
  const session = gameSession(freshRun("stag", "tutorial"), () => {}, () => {});
  session.act({ revision: 0, actions: [{ op: "continue" }] });
  finishIncome(session);
  return session;
}
function act(session: ReturnType<typeof start>, action: unknown) {
  return session.act({ revision: session.state.revision, actions: [action] });
}

test("tutorial Shop has no Event offers before entering its Fate stage", () => {
  const session = start();
  assert.deepEqual(session.state.fate, [null, null, null]);
  act(session, { op: "continue" });
  assert.deepEqual(session.state.fate, ["call-to-war", "ruins-of-delphi", null]);
});

for (const action of [{ op: "fate", slot: 1 }, { op: "reroll-fate" }]) {
  test(`tutorial ${action.op} cannot spend in Shop or Preparation and cannot prevent stage progression`, () => {
    const session = start();
    const before = session.state;
    assert.throws(() => act(session, action), /tutorial Fate stage/);
    assert.deepEqual(session.state, before);
    act(session, { op: "continue" });
    act(session, { op: "continue" });
    const prepared = session.state;
    assert.throws(() => act(session, action), /tutorial Fate stage/);
    assert.deepEqual(session.state, prepared);
  });
}

test("a choice made in tutorial Fate survives advancing to Preparation without recreating offers", () => {
  const session = start();
  act(session, { op: "continue" });
  act(session, { op: "fate", slot: 1 });
  assert.equal(session.state.insight, 0);
  act(session, { op: "continue" });
  assert.equal(session.state.tutorial?.stage, "prepare");
  assert.deepEqual(session.state.fate, [null, null, null]);
  assert.equal(session.state.fateChosen, true);
});
