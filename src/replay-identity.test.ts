import assert from "node:assert/strict";
import { test } from "node:test";
import { inspection, newGame } from "./game.ts";
import { practiceMatch } from "./warband.ts";
import { resolveBattle } from "./combat.ts";
import { playState, publicGame } from "./read-model.ts";

function result() {
  const initial = newGame(42, "stag");
  const encounter = practiceMatch(initial);
  const outcome = resolveBattle(encounter);
  const state = publicGame.parse({
    ...inspection(initial),
    r: 11,
    phase: "result" as const,
    battleId: 41,
    battle: { ...outcome, opponent: encounter.opponent, kind: encounter.kind },
  });
  const replay = {
    r: 10,
    battleId: 41,
    rulesVersion: initial.rulesVersion,
    encounter,
    outcome,
  };
  return { state, replay };
}

test("a wallet revision keeps the same battle's replay admitted for ongoing playback", () => {
  const { state, replay } = result();
  const view = playState(state, replay);
  assert.equal(view.phase.kind, "result");
  assert.ok(view.phase.kind === "result");
  assert.equal(view.phase.encounter, replay.encounter);
});

test("a different battle ID rejects an old replay even with the same revision, seed and fighters", () => {
  const { state, replay } = result();
  const old = { ...replay, r: state.r, battleId: 40 };
  const view = playState(state, old);
  assert.ok(view.phase.kind === "result");
  assert.equal(view.phase.encounter, null);
});
