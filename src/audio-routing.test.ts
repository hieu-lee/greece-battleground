import assert from "node:assert/strict";
import { test } from "node:test";
import { actionSounds } from "./audio.ts";
import { newGame, inspection } from "./game.ts";
import { playState, publicGame } from "./read-model.ts";
import { tileId } from "./map.ts";

test("preparation cues distinguish placement, merge, Fate kinds and worker actions", () => {
  const game = newGame();
  game.shop = [
    { id: "spear-camp", price: 4 },
    { id: "silver-mine", price: 4 },
    null,
    null,
  ];
  game.fate = ["lost-wanderer", "call-to-peace", "well-fed"];
  const before = playState(publicGame.parse(inspection(game)), null);
  const empty = tileId.parse(19);
  assert.deepEqual(actionSounds({ op: "buy", slot: 0, tile: empty }, before), [
    "build",
    "buy-spear-camp",
  ]);
  assert.deepEqual(actionSounds({ op: "buy", slot: 1, tile: empty }, before), [
    "build",
    "buy-silver-mine",
  ]);
  assert.deepEqual(
    actionSounds({ op: "buy", slot: 0, tile: tileId.parse(37) }, before),
    ["upgrade"],
  );
  assert.deepEqual(actionSounds({ op: "fate", slot: 0 }, before), [
    "fate-gift",
  ]);
  assert.deepEqual(actionSounds({ op: "fate", slot: 1 }, before), [
    "fate-blessing",
  ]);
  // A Charm is attached as it is bought; a spell reveals its upgrade.
  assert.deepEqual(
    actionSounds({ op: "fate", slot: 2, tile: tileId.parse(37) }, before),
    ["fate-rune"],
  );
  assert.deepEqual(
    actionSounds(
      { op: "fate", slot: 0, tile: empty },
      { ...before, fate: ["rite-of-ares", null, null] },
    ),
    ["fate-reveal"],
  );
  assert.deepEqual(actionSounds({ op: "assign", tile: empty }, before), [
    "worker-assign",
  ]);
  assert.deepEqual(actionSounds({ op: "colonize", tile: empty }, before), [
    "colonize",
  ]);
  assert.deepEqual(actionSounds({ op: "ready" }, before), []);
  assert.deepEqual(actionSounds({ op: "continue" }, before), []);
});
