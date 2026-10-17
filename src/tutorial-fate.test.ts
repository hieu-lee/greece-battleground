import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession, inspection, parseGame } from "./game.ts";
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
  session.act({ revision: session.state.revision, actions: [{ op: "continue" }] });
  finishIncome(session);
  session.act({ revision: session.state.revision, actions: [{ op: "continue" }] });
  return session;
}
function act(session: ReturnType<typeof start>, op: "reroll-fate" | "fate") {
  session.act({ revision: session.state.revision, actions: [op === "fate" ? { op, slot: session.state.fate.indexOf("ruins-of-delphi") } : { op }] });
}

test("the source tutorial collection excludes a Charm without an eligible owned Warband", () => {
  const session = start();
  assert.deepEqual(session.state.fate, ["call-to-war", "ruins-of-delphi", null]);
});

test("an empty tutorial reroll is saved as unchosen and the next roll uses the same collection", () => {
  let session = start();
  act(session, "reroll-fate");
  assert.deepEqual(session.state.fate, [null, null, null]);
  assert.equal(Reflect.get(inspection(session.state), "fateChosen"), false);
  assert.equal(session.state.insight, 3);
  session = gameSession(parseGame(JSON.parse(JSON.stringify(session.state))), () => {}, () => {});
  act(session, "reroll-fate");
  assert.deepEqual(session.state.fate, ["call-to-war", "ruins-of-delphi", null]);
  assert.equal(session.state.insight, 1);
});

test("buying a tutorial Fate ends its choice and cannot be mistaken for an empty reroll", () => {
  const session = start();
  act(session, "fate");
  assert.deepEqual(session.state.fate, [null, null, null]);
  assert.equal(session.state.insight, 0);
  assert.equal(Reflect.get(inspection(session.state), "fateChosen"), true);
  assert.throws(() => act(session, "reroll-fate"), /already woven/);
});
