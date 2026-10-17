import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession, newGame, parseGame } from "./game.ts";
import * as domain from "./game.ts";
import type { Command, Game } from "./game.ts";
import { tileId } from "./map.ts";
import { practiceMatch } from "./warband.ts";

// Trusted game-owner fixtures, not a transport command for advancing time.
const authority = {
  offerIndex: (_context: unknown, bound: number) => Math.floor(bound / 2),
  encounter: practiceMatch,
};
function fixture(last = false): Game {
  const g = newGame(42, "raven", "practice");
  g.round = 2;
  g.owned.push(tileId.parse(31));
  const watch = { tile: tileId.parse(30), id: "watchtower", level: 1, workers: 0, rune: "memory-of-the-polis" } as const;
  const farm = { tile: tileId.parse(31), id: "farm", level: 1, workers: 0, rune: null } as const;
  g.placements.push(...(last ? [farm, watch] : [watch, farm]));
  return parseGame(g);
}
function owner(g: Game, now = 0) {
  return gameSession(g, () => {}, () => {}, authority, { now });
}
function act(s: ReturnType<typeof owner>, ...actions: Command[]) {
  s.act({ revision: s.state.revision, actions });
}
function begin(s: ReturnType<typeof owner>) {
  act(s, { op: "ready" });
  act(s, { op: "continue" });
  assert.equal(s.state.phase.kind, "income", "ordinary Income is an actual waiting phase");
}
function wallet(s: ReturnType<typeof owner>) {
  return [s.state.drachmas, s.state.insight];
}

test("ordinary waits, deferred Memory and binary32 due time use the live wallet", () => {
  const s = owner(fixture());
  begin(s);
  assert.equal(s.state.phase.kind, "income");
  assert.deepEqual(wallet(s), [22, 4]);
  assert.throws(() => act(s, { op: "ready" }), /phase|income/i);
  s.update(500);
  assert.deepEqual(wallet(s), [22, 8]);
  s.update(1000);
  assert.deepEqual(wallet(s), [22, 9]);
  s.update(1500);
  assert.deepEqual(wallet(s), [23, 9], "queueing zero delay is not inline payment");
  s.update(1500);
  assert.deepEqual(wallet(s), [23, 10]);
  s.update(1749.99999);
  assert.deepEqual(wallet(s), [24, 10], "binary32 Time rounds the predicate to 0.25 seconds");
  s.update(2000);
  assert.equal(s.state.phase.kind, "prepare");
  assert.deepEqual(wallet(s), [24, 10]);
  const r = s.state.revision;
  s.update(9000);
  assert.equal(s.state.revision, r, "idle updates do not create revisions");
});

test("pause freezes future drops while the Update runner can pay an already due zero drop", () => {
  const s = owner(fixture());
  begin(s);
  for (const t of [500, 1000, 1500]) s.update(t);
  s.pause(true, 1500);
  s.update(5000);
  assert.deepEqual(wallet(s), [23, 10]);
  s.update(9000);
  assert.deepEqual(wallet(s), [23, 10]);
  s.pause(false, 9000);
  s.update(9250);
  assert.deepEqual(wallet(s), [24, 10]);
});

test("Shop and Ready do not drain Memory; pending drops preserve the frozen battle", () => {
  const s = owner(fixture(true));
  begin(s);
  for (const t of [500, 1000, 1500, 2000]) s.update(t);
  assert.equal(s.state.phase.kind, "prepare");
  assert.deepEqual(wallet(s), [23, 9]);
  act(s, { op: "villager" });
  assert.deepEqual(wallet(s), [19, 9]);
  act(s, { op: "ready" });
  const battle = structuredClone(s.state.phase);
  s.update(2000);
  s.update(2250);
  assert.deepEqual(wallet(s), [20, 10]);
  assert.deepEqual(s.state.phase, battle, "new balance does not rewrite the submitted army or battle identity");
});

for (const level of [1, 2, 3] as const)
  test(`Stag level${level} queues N targets once and Gather reads before those callbacks`, () => {
    const g = newGame(42, "stag", "practice");
    g.round = 2;
    g.insight = 3;
    g.skills[0] = level;
    g.blessings = ["secrets-of-the-oracle"];
    g.placements[0]!.level = 3;
    g.placements.push({ tile: tileId.parse(30), id: "spear-camp", level: 3, workers: 0, rune: null });
    const s = owner(parseGame(g));
    act(s, { op: "move", from: tileId.parse(37), to: tileId.parse(30) });
    begin(s);
    s.update(500);
    s.update(1000);
    assert.equal(s.state.phase.kind, "prepare");
    assert.deepEqual(wallet(s), [26, 10], "Hall15/6, then Gather floor(9/5); delayed drops not inline");
    for (let t = 1000; t <= 2500; t += 250) s.update(t);
    assert.deepEqual(wallet(s), level === 1 ? [28, 10] : level === 2 ? [28, 12] : [30, 12]);
  });

test("Silver Mine worker and terrain gains merge into one currency payment and wait", () => {
  const g = newGame(42, "raven", "practice");
  g.round = 2;
  g.placements.push({ tile: tileId.parse(38), id: "silver-mine", level: 1, workers: 2, rune: null });
  const s = owner(parseGame(g));
  begin(s);
  s.update(500);
  s.update(1000);
  assert.deepEqual(wallet(s), [26, 8]);
  assert.equal(s.state.phase.kind, "income");
  s.update(1500);
  assert.equal(s.state.phase.kind, "prepare");
});

test("mapped save-and-exit during a gain wait resumes Shop with only the paid wallet", () => {
  const s = owner(fixture());
  begin(s);
  assert.deepEqual(wallet(s), [22, 4]);
  s.saveAndExit();
  const next = owner(domain.recreateGame(s.state), 100_000);
  assert.equal(next.state.phase.kind, "prepare");
  next.update(200_000);
  assert.deepEqual(wallet(next), [22, 4]);
});

test("controlled pre-Income checkpoint recreation restarts the full phase without old callback offsets", () => {
  const s = owner(fixture());
  begin(s);
  const partial = s.state;
  s.dispose();
  const next = owner(domain.recreateGame(partial), 100_000);
  assert.equal(next.state.phase.kind, "income");
  assert.deepEqual(wallet(next), [22, 4], "restore11/4 then firstHall11, not partial22+11");
  for (const t of [100_500, 101_000, 101_500, 101_500, 101_750, 102_000]) next.update(t);
  assert.deepEqual(wallet(next), [24, 10]);
  assert.ok(next.state.revision > partial.revision);
});

test("closing Shop drops unpaid callbacks without offline catch-up or a new Income", () => {
  const s = owner(fixture(true));
  begin(s);
  for (const t of [500, 1000, 1500, 2000]) s.update(t);
  assert.deepEqual(wallet(s), [23, 9]);
  s.saveAndExit();
  const next = owner(domain.recreateGame(s.state), 100_000);
  next.update(200_000);
  assert.equal(next.state.phase.kind, "prepare");
  assert.deepEqual(wallet(next), [23, 9]);
});
