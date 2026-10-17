import assert from "node:assert/strict";
import { test } from "node:test";
import { fatePool, gameSession, newGame, parseGame } from "./game.ts";
import type { Command, Game } from "./game.ts";
import type { FateId } from "./rules.ts";

// Trusted wallets and eligible Fate offers; acquisition, shops, claims and restart use Game.act.
// Source timing: evidence/appearance-rules-2026-10-16/SNAPSHOT-RESUME.md.
// Offer literals use the port's seeded RNG; they do not assert Unity RNG parity.
type Session = ReturnType<typeof gameSession>;
function open(initial: Game) {
  let saved = "";
  const game = gameSession(
    initial,
    (next) => {
      saved = JSON.stringify(next);
    },
    () => {},
  );
  return {
    game,
    saved() {
      assert.notEqual(saved, "", "a real transaction must persist the save");
      return saved;
    },
  };
}
function act(game: Session, ...actions: Command[]) {
  return game.act({ revision: game.state.revision, actions });
}
function nextRound(game: Session) {
  act(game, { op: "ready" }, { op: "continue" });
  if (game.state.phase.kind === "season")
    act(game, { op: "upgrade", choice: "hall" });
  for (let pass = 0; pass < 100 && game.state.phase.kind === "income"; pass++)
    game.update(game.runtime.clock.last + 500);
}
function offered(card: FateId, round = 1) {
  const initial = newGame(42, "stag");
  initial.drachmas = 200;
  initial.insight = 200;
  initial.favor = { zeus: 10, athena: 10, apollo: 10 };
  const progression = open(initial);
  while (progression.game.state.round < round) nextRound(progression.game);
  const state = progression.game.state;
  assert.equal(
    fatePool(state).includes(card),
    true,
    "the source offer must be eligible",
  );
  state.fate = [card, null, null];
  return open(state);
}
function shopIds(game: Session) {
  return game.state.shop.map((offer) => offer?.id ?? null);
}
const springUnweighted = [
  "spear-camp",
  "defense-tower",
  "silver-mine",
  "house",
];

for (const [card, round, unweighted, weighted] of [
  [
    "apollos-sentinels",
    1,
    springUnweighted,
    ["woodcutter", "watchtower", "shield-camp", "sentry-camp"],
  ],
  [
    "seek-the-oracle",
    5,
    ["shield-camp", "scout-camp", "dactyl-camp", "spring-of-mnemosyne"],
    ["sentry-camp", "defense-tower", "javelin-camp", "hall-of-rhapsodes"],
  ],
  [
    "zeus-war-council",
    1,
    springUnweighted,
    ["woodcutter", "shield-camp", "watchtower", "sentry-camp"],
  ],
] as const) {
  test(`${card}: acquisition keeps this shop's weights and the next Shop initialization applies its positive tag`, () => {
    const appearance = offered(card, round);
    const control = offered("athenas-apprentices", round);
    assert.deepEqual(shopIds(appearance.game), shopIds(control.game));
    for (const current of [appearance, control])
      act(current.game, { op: "fate", slot: 0 }, { op: "reroll-shop" });
    assert.deepEqual(control.game.state.blessings, ["athenas-apprentices"]);
    assert.deepEqual(appearance.game.state.blessings, [card]);
    assert.deepEqual(shopIds(control.game), unweighted);
    assert.deepEqual(shopIds(appearance.game), unweighted);
    nextRound(appearance.game);
    assert.equal(appearance.game.state.round, round + 1);
    assert.deepEqual(shopIds(appearance.game), weighted);
  });
}

test("JSON reopening preserves the current shop snapshot before and after its next initialization", () => {
  const first = offered("apollos-sentinels");
  act(first.game, { op: "fate", slot: 0 });
  const reopened = open(parseGame(JSON.parse(first.saved())));
  assert.deepEqual(reopened.game.state.blessings, ["apollos-sentinels"]);
  act(reopened.game, { op: "reroll-shop" });
  assert.deepEqual(shopIds(reopened.game), springUnweighted);
  nextRound(reopened.game);
  const active = open(parseGame(JSON.parse(reopened.saved())));
  act(active.game, { op: "reroll-shop" });
  assert.deepEqual(shopIds(active.game), [
    "healers-hut",
    "defense-tower",
    "dactyl-camp",
    "brewery",
  ]);
});

test("an owned appearance Blessing is excluded and a repeated purchase cannot stack or mutate its active shop", () => {
  const first = offered("apollos-sentinels");
  act(first.game, { op: "fate", slot: 0 });
  nextRound(first.game);
  assert.equal(fatePool(first.game.state).includes("apollos-sentinels"), false);
  const repeated = first.game.state;
  repeated.fate = ["apollos-sentinels", null, null];
  const current = open(repeated);
  const before = current.game.state;
  assert.throws(
    () => act(current.game, { op: "fate", slot: 0 }),
    /already owned/,
  );
  assert.deepEqual(current.game.state, before);
  act(current.game, { op: "reroll-shop" });
  assert.deepEqual(current.game.state.blessings, ["apollos-sentinels"]);
  assert.deepEqual(shopIds(current.game), [
    "woodcutter",
    "silver-mine",
    "watchtower",
    "shield-camp",
  ]);
});

test("an actual completed run restarts with an empty appearance collection and unweighted initial plus rerolled shops", () => {
  const current = offered("apollos-sentinels");
  act(current.game, { op: "fate", slot: 0 });
  while (current.game.state.phase.kind !== "finished") nextRound(current.game);
  assert.deepEqual(current.game.state.phase, {
    kind: "finished",
    outcome: "defeat",
  });
  act(current.game, { op: "restart", clan: "stag" });
  assert.equal(current.game.state.seed, 1083814273);
  assert.deepEqual(current.game.state.blessings, []);
  assert.deepEqual(shopIds(current.game), [
    "healers-hut",
    "defense-tower",
    "farm",
    "spear-camp",
  ]);
  const reopened = open(parseGame(JSON.parse(current.saved())));
  act(reopened.game, { op: "reroll-shop" });
  assert.deepEqual(shopIds(reopened.game), [
    "woodcutter",
    "silver-mine",
    "hall-of-rhapsodes",
    "apollo-fountain",
  ]);
});
