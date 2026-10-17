import { test } from "node:test";
import assert from "node:assert/strict";
import { gameSession, newGame, parseGame } from "./game.ts";

test("both clan chiefs retain their own sprite when a played battle is saved and resumed", () => {
  for (const [clan, sprite, name] of [
    ["stag", "aegeus", "Aegeus"],
    ["raven", "atalanta", "Atalanta"],
  ] satisfies ["stag" | "raven", string, string][]) {
    let saved: unknown;
    const game = gameSession(
      newGame(2026, clan),
      (state) => {
        saved = state;
      },
      () => {},
    );
    game.act({ revision: 0, actions: [{ op: "ready" }] });
    const resumed = parseGame(saved);
    assert.equal(resumed.phase.kind, "result");
    if (resumed.phase.kind !== "result")
      throw new Error("Battle was not saved");
    const chief = resumed.phase.encounter.fighters.find(
      (unit) => unit.side === "polis",
    );
    assert.equal(chief?.name, name);
    assert.equal(chief?.sprite, sprite);
  }
});
