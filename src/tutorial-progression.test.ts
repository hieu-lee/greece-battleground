import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { gameSession, inspection, newGame, parseGame } from "./game.ts";
import type { Game } from "./game.ts";
import { freshRun } from "./run-storage.ts";
import { seasonForRound } from "./rules-version.ts";
import { practiceMatch } from "./warband.ts";

// Consumer contract: no future implementation import or private cursor fixture.
const guide = z
  .object({
    stage: z.enum(["welcome", "shop", "fate", "prepare"]),
    chapter: z
      .object({
        id: z.enum([
          "welcome",
          "structures",
          "fate",
          "preparation",
          "workers",
          "pvp",
          "post-battle",
          "synergies",
          "affinity",
          "upgrades",
          "seasons",
          "second-pve",
          "selling",
          "ending",
        ]),
        origin: z.enum(["automatic", "manual"]),
      })
      .strict()
      .nullable(),
    postBattleShown: z.boolean(),
    ending: z.enum(["none", "continued"]),
  })
  .strict();

type Session = ReturnType<typeof gameSession>;
function view(game: Game) {
  return z.object({ tutorial: guide }).parse(inspection(game)).tutorial;
}
function act(session: Session, ...actions: unknown[]) {
  return session.act({ revision: session.state.revision, actions });
}
function finishIncome(session: Session) {
  for (
    let pass = 0;
    pass < 100 && session.state.phase.kind === "income";
    pass++
  )
    session.update(session.runtime.clock.last + 500);
}
function start() {
  return gameSession(
    freshRun("stag", "tutorial"),
    () => {},
    () => {},
  );
}
function prepare(session: Session) {
  act(session, { op: "continue" }); // Welcome -> first income and Shop.
  finishIncome(session);
  act(session, { op: "continue" }); // Nonblocking Structures -> Fate.
  act(session, { op: "continue" }); // Nonblocking Fate -> Prepare.
}
function roundTwo() {
  const session = start();
  prepare(session);
  act(session, { op: "ready" });
  act(session, { op: "continue" });
  finishIncome(session);
  return session;
}
function roundTwoResult() {
  const session = roundTwo();
  act(session, { op: "tutorial-close" }); // Blocking Workers chapter.
  act(session, { op: "continue" });
  act(session, { op: "continue" });
  act(session, { op: "ready" });
  return session;
}
function totals(game: Game) {
  return [
    game.round,
    game.wins,
    game.lives,
    game.drachmas,
    game.insight,
    game.chiefBattles,
    game.phase.kind,
  ];
}
function incomingResult(round: number) {
  const session = start();
  prepare(session);
  if (view(session.state).chapter) act(session, { op: "tutorial-close" });
  const game = session.state;
  // Trusted round/outcome fixture, keeping the real provider's actual NPC army.
  game.round = round;
  game.season = seasonForRound(round);
  game.wins = 1;
  game.drachmas = 37;
  game.insight = 12;
  game.phase = {
    kind: "result",
    battleId: 1,
    encounter: practiceMatch(game),
    outcome: { winner: "polis", ticks: 20, survivors: [1, 0] },
  };
  return gameSession(
    game,
    () => {},
    () => {},
  );
}

test("tutorial stages guard Ready but never require buying, staffing or expanding", () => {
  const session = start();
  const initial = session.state;
  assert.throws(() => act(session, { op: "ready" }));
  assert.deepEqual(session.state, initial);
  act(session, { op: "continue" });
  finishIncome(session);
  assert.equal(view(session.state).stage, "shop");
  assert.throws(() => act(session, { op: "ready" }));
  act(session, { op: "continue" });
  assert.equal(view(session.state).stage, "fate");
  assert.throws(() => act(session, { op: "ready" }));
  act(session, { op: "continue" });
  assert.equal(view(session.state).stage, "prepare");
  assert.deepEqual(
    [session.state.owned, session.state.placements],
    [initial.owned, initial.placements],
  );
  act(session, { op: "ready" });
  const result = session.state.phase;
  assert.ok(result.kind === "result");
  assert.equal(result.encounter.kind, "pve");
});

test("closing the blocking round2 Workers chapter restores the same Shop without income or stage advancement", () => {
  const session = roundTwo();
  assert.deepEqual(view(session.state).chapter, {
    id: "workers",
    origin: "automatic",
  });
  const before = totals(session.state);
  assert.throws(() => act(session, { op: "continue" }));
  assert.throws(() => act(session, { op: "ready" }));
  act(session, { op: "tutorial-close" });
  assert.deepEqual(totals(session.state), before);
  assert.deepEqual(
    [view(session.state).stage, view(session.state).chapter],
    ["shop", null],
  );
  act(session, { op: "continue" });
  assert.equal(view(session.state).stage, "fate");
  assert.deepEqual([session.state.drachmas, session.state.insight], [22, 8]);
});

test("round2 post-battle acknowledgement persists before a separate single claim and next-round income", () => {
  let session = roundTwoResult();
  const result = session.state.phase;
  assert.ok(result.kind === "result");
  assert.deepEqual(
    [session.state.wins, session.state.lives],
    result.outcome.winner === "polis" ? [1, 5] : [0, 4],
  );
  assert.deepEqual(view(session.state).chapter, {
    id: "post-battle",
    origin: "automatic",
  });
  assert.equal(view(session.state).postBattleShown, false);
  const before = totals(session.state);
  assert.throws(() => act(session, { op: "continue" }));
  act(session, { op: "tutorial-close" });
  assert.equal(view(session.state).postBattleShown, true);
  assert.deepEqual(totals(session.state), before);
  const encoded = JSON.stringify(session.state);
  session = gameSession(
    parseGame(JSON.parse(encoded)),
    () => {},
    () => {},
  );
  assert.deepEqual(
    [view(session.state).postBattleShown, view(session.state).chapter],
    [true, null],
  );
  const request = {
    revision: session.state.revision,
    actions: [{ op: "continue" }],
  };
  session.act(request);
  finishIncome(session);
  assert.deepEqual(
    [
      session.state.round,
      session.state.chiefBattles,
      session.state.drachmas,
      session.state.insight,
    ],
    [3, 2, 33, 12],
  );
  assert.deepEqual(
    [session.state.wins, session.state.lives],
    before.slice(1, 3),
  );
  assert.deepEqual(view(session.state).chapter, {
    id: "synergies",
    origin: "automatic",
  });
  const claimed = session.state;
  assert.throws(() => session.act(request), /Stale revision/);
  assert.deepEqual(session.state, claimed);
});

test("continuing the round7 ending dialog keeps tutorial mode and the same funded Shop", () => {
  const session = incomingResult(6);
  act(session, { op: "continue" });
  finishIncome(session);
  assert.deepEqual(view(session.state).chapter, {
    id: "ending",
    origin: "automatic",
  });
  const before = totals(session.state);
  const offers = session.state.shop;
  act(session, { op: "continue" });
  assert.equal(session.state.mode, "tutorial");
  assert.deepEqual(
    [
      view(session.state).stage,
      view(session.state).chapter,
      view(session.state).ending,
    ],
    ["shop", null, "continued"],
  );
  assert.deepEqual(totals(session.state), before);
  assert.deepEqual(session.state.shop, offers);
  act(session, { op: "continue" });
  assert.deepEqual(
    [session.state.round, view(session.state).stage],
    [7, "fate"],
  );
});

test("opening and closing a manual chapter changes no stage, economic state or automatic progression", () => {
  const session = start();
  act(session, { op: "continue" });
  finishIncome(session);
  const before = totals(session.state);
  act(session, { op: "tutorial-chapter", chapter: "seasons" });
  assert.deepEqual(view(session.state).chapter, {
    id: "seasons",
    origin: "manual",
  });
  assert.throws(() => act(session, { op: "continue" }));
  assert.throws(() => act(session, { op: "ready" }));
  act(session, { op: "tutorial-close" });
  assert.deepEqual(
    [view(session.state).stage, view(session.state).chapter],
    ["shop", null],
  );
  assert.deepEqual(totals(session.state), before);
  act(session, { op: "continue" });
  assert.equal(view(session.state).stage, "fate");
});

test("the season chapter blocks round5's choice before income, then closes without bypassing the ordinary upgrade", () => {
  const session = incomingResult(4);
  act(session, { op: "continue" });
  assert.deepEqual(
    [session.state.round, session.state.phase.kind],
    [5, "season"],
  );
  assert.deepEqual(view(session.state).chapter, {
    id: "seasons",
    origin: "automatic",
  });
  assert.deepEqual([session.state.drachmas, session.state.insight], [37, 12]);
  assert.throws(() => act(session, { op: "upgrade", choice: "hall" }));
  assert.throws(() => act(session, { op: "continue" }));
  act(session, { op: "tutorial-close" });
  assert.deepEqual(
    [session.state.phase.kind, session.state.drachmas, session.state.insight],
    ["season", 37, 12],
  );
  act(session, { op: "upgrade", choice: "hall" });
  finishIncome(session);
  assert.deepEqual(
    [
      session.state.phase.kind,
      view(session.state).stage,
      session.state.drachmas,
      session.state.insight,
    ],
    ["prepare", "shop", 50, 17],
  );
  act(session, { op: "continue" });
  act(session, { op: "continue" });
  assert.deepEqual(view(session.state).chapter, {
    id: "second-pve",
    origin: "automatic",
  });
});

function ordinary(winner: "polis" | "opponent") {
  const game = newGame(42, "stag");
  game.round = winner === "polis" ? 2 : 18;
  game.season = seasonForRound(game.round);
  if (winner === "polis") game.chiefGrowth = { health: 10000, damage: 10000 };
  return game;
}

test("ordinary wins and losses settle at Ready while Continue performs cleanup without another counter delta", () => {
  for (const winner of ["polis", "opponent"] as const) {
    const session = gameSession(
      ordinary(winner),
      () => {},
      () => {},
    );
    act(session, { op: "ready" });
    const result = session.state.phase;
    assert.ok(result.kind === "result");
    assert.equal(result.outcome.winner, winner);
    const expected = winner === "polis" ? [1, 5] : [0, 4];
    assert.deepEqual([session.state.wins, session.state.lives], expected);
    act(session, { op: "continue" });
    assert.deepEqual(
      [session.state.wins, session.state.lives, session.state.chiefBattles],
      [...expected, 1],
    );
  }
});

test("a terminal pending result roundtrips and finishes once without counting its ordinary outcome twice", () => {
  for (const winner of ["polis", "opponent"] as const) {
    const initial = ordinary(winner);
    if (winner === "polis") initial.wins = 9;
    else initial.lives = 1;
    let session = gameSession(
      initial,
      () => {},
      () => {},
    );
    act(session, { op: "ready" });
    const expected = winner === "polis" ? [10, 5] : [0, 0];
    assert.deepEqual(
      [session.state.wins, session.state.lives, session.state.phase.kind],
      [...expected, "result"],
    );
    const saved = parseGame(JSON.parse(JSON.stringify(session.state)));
    const corrupt = structuredClone(saved);
    assert.ok(corrupt.phase.kind === "result");
    corrupt.phase.outcome.winner = winner === "polis" ? "opponent" : "polis";
    assert.throws(() => parseGame(corrupt));
    session = gameSession(
      saved,
      () => {},
      () => {},
    );
    act(session, { op: "continue" });
    assert.deepEqual(session.state.phase, {
      kind: "finished",
      outcome: winner === "polis" ? "victory" : "defeat",
    });
    assert.deepEqual(
      [session.state.wins, session.state.lives, session.state.chiefBattles],
      [...expected, 1],
    );
    const finished = session.state;
    assert.throws(() => act(session, { op: "continue" }));
    assert.deepEqual(session.state, finished);
  }
});

test("failed Ready persistence rolls back the pending outcome, settled counters and revision together", () => {
  const session = gameSession(
    ordinary("polis"),
    () => {
      throw new Error("Storage blocked");
    },
    () => {},
  );
  const before = session.state;
  assert.throws(() => act(session, { op: "ready" }), /Storage blocked/);
  assert.deepEqual(session.state, before);
});
