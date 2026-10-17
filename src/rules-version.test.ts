import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession, inspection, newGame, parseGame } from "./game.ts";
import { publicGame, replaySchema } from "./read-model.ts";
import { seasonForRound, sourceEncounterKind } from "./rules-version.ts";
import { warband, settlement } from "./warband.ts";

test("current snapshots and replays carry the engine rules identity and exact next reroll costs", () => {
  const run = newGame();
  run.paidFateRerolls = 5;
  const current = publicGame.parse(inspection(run));
  assert.deepEqual(current.calendar, {
    pveRounds: [1, 5, 9, 13],
    maxRoundExclusive: 20,
    pveAvailable: true,
  });
  assert.deepEqual(
    [current.rulesVersion, current.rerollCosts],
    ["greece-118-v31", [0, 32]],
  );
  for (const previous of [
    "greece-118-v29",
    "greece-118-v28",
    "greece-118-v27",
    "greece-118-v26",
    "greece-118-v25",
    "greece-118-v24",
    "greece-118-v23",
    "greece-118-v22",
    "greece-118-v21",
    "greece-118-v20",
    "greece-118-v19",
    "greece-118-v18",
    "greece-118-v14",
    "greece-118-v7",
    "greece-118-v6",
    "greece-118-v5",
    "greece-111-v4",
    "greece-111-v3",
    "greece-111-v2",
    "greece-v1",
  ])
    assert.throws(() =>
      publicGame.parse({ ...current, rulesVersion: previous }),
    );
  const game = gameSession(
    run,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "ready" }] });
  const result = game.state.phase;
  assert.equal(result.kind, "result");
  if (result.kind !== "result") throw new Error("Missing battle result");
  const replay = {
    r: 1,
    battleId: result.battleId,
    rulesVersion: "greece-118-v31",
    encounter: result.encounter,
    outcome: result.outcome,
  };
  assert.deepEqual(replaySchema.parse(replay), replay);
  assert.deepEqual(
    parseGame(JSON.parse(JSON.stringify(game.state))),
    game.state,
  );
  for (const speed of [Number.MIN_VALUE, 1e-40, 1e-37]) {
    const encounter = {
      ...result.encounter,
      fighters: result.encounter.fighters.map((unit, index) =>
        index === 0 ? { ...unit, speed, windupPercent: 100 } : unit,
      ),
    };
    assert.throws(
      () => replaySchema.parse({ ...replay, encounter }),
      /binary32/,
    );
    assert.throws(
      () =>
        parseGame(
          JSON.parse(
            JSON.stringify({
              ...game.state,
              phase: { ...result, encounter },
            }),
          ),
        ),
      /binary32/,
    );
  }
  const { rulesVersion, ...oldReplay } = replay;
  assert.throws(() => replaySchema.parse(oldReplay));
  for (const [version, previous] of [
    [28, "greece-118-v28"],
    [27, "greece-118-v27"],
    [26, "greece-118-v26"],
    [25, "greece-118-v25"],
    [24, "greece-118-v24"],
    [23, "greece-118-v23"],
    [22, "greece-118-v22"],
    [21, "greece-118-v21"],
    [20, "greece-118-v20"],
    [19, "greece-118-v19"],
    [18, "greece-118-v18"],
    [14, "greece-118-v14"],
    [7, "greece-118-v7"],
    [6, "greece-118-v6"],
    [5, "greece-118-v5"],
    [4, "greece-111-v4"],
    [3, "greece-111-v3"],
    [2, "greece-111-v2"],
    [1, "greece-v1"],
  ]) {
    assert.throws(() => parseGame({ ...run, version, rulesVersion: previous }));
    assert.throws(() =>
      replaySchema.parse({ ...replay, rulesVersion: previous }),
    );
  }
});

test("the source calendar clamps winter without scheduling another PvE at round17", () => {
  const rounds = [1, 2, 4, 5, 8, 9, 12, 13, 16, 17, 19];
  assert.deepEqual(rounds.map(seasonForRound), [
    "spring",
    "spring",
    "spring",
    "summer",
    "summer",
    "autumn",
    "autumn",
    "winter",
    "winter",
    "winter",
    "winter",
  ]);
  assert.deepEqual(rounds.map(sourceEncounterKind), [
    "pve",
    "pvp",
    "pvp",
    "pve",
    "pvp",
    "pve",
    "pvp",
    "pve",
    "pvp",
    "pvp",
    "pvp",
  ]);
  assert.throws(() => parseGame({ ...newGame(), season: "winter" }), /Season/);
});

test("round19 is the last battle; crossing the exclusive20 guard grants no new preparation or income", () => {
  const initial = newGame();
  initial.round = 19;
  initial.season = "winter";
  const game = gameSession(
    initial,
    () => {},
    () => {},
  );
  const before = game.inspect().balance;
  game.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
  assert.deepEqual(
    [game.state.round, game.state.phase, game.state.lives, game.state.wins],
    [20, { kind: "finished", outcome: "round-limit" }, 4, 0],
  );
  assert.deepEqual(game.inspect().balance, before);
  assert.equal(game.state.shopRolls, 0);
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "ready" }] }),
    /phase/,
  );
  assert.deepEqual(
    parseGame(JSON.parse(JSON.stringify(game.state))),
    game.state,
  );
  game.act({ revision: 1, actions: [{ op: "restart", clan: "raven" }] });
  assert.deepEqual(
    [game.state.round, game.state.phase, game.state.lives, game.state.wins],
    [1, { kind: "prepare" }, 5, 0],
  );
});

test("a simultaneous elimination is a normal-battle loss and ends the last life", () => {
  const initial = newGame(42, "stag", "async", () => 0);
  initial.round = 2;
  initial.lives = 1;
  const game = gameSession(
    initial,
    () => {},
    () => {},
    {
      offerIndex: () => 0,
      encounter: (current) => ({
        seed: 1,
        kind: "pvp",
        opponentLayout: settlement(current),
        opponent: "Simultaneous elimination",
        fighters: [
          ...warband(current, "polis"),
          ...warband(current, "opponent"),
        ].map((unit) => ({
          ...unit,
          x: unit.side === "polis" ? -0.25 : 0.25,
          health: 1,
          armor: 0,
          damage: 100,
          attackStat: undefined,
          armorStat: undefined,
          crit: 0,
          ward: 0,
          windupPercent: 0,
          range: 1,
        })),
      }),
    },
  );
  game.act({ revision: 0, actions: [{ op: "ready" }] });
  assert.equal(game.inspect().battle?.winner, "draw");
  game.act({ revision: 1, actions: [{ op: "continue" }] });
  assert.deepEqual(
    [game.state.wins, game.state.lives, game.state.phase],
    [0, 0, { kind: "finished", outcome: "defeat" }],
  );
});

test("scheduled PvE uses its admitted factory, and an authority cannot substitute PvE on a normal round", () => {
  for (const round of [1, 2]) {
    const initial = newGame(42, "stag", "async", () => 0);
    initial.round = round;
    let saves = 0;
    const game = gameSession(
      initial,
      () => {
        saves++;
      },
      () => {},
      {
        offerIndex: () => 0,
        encounter: (current) => ({
          seed: 1,
          kind: "pve",
          opponentLayout: null,
          opponent: "Unverified snapshot binding",
          fighters: [
            ...warband(current, "polis"),
            ...warband(current, "opponent"),
          ],
        }),
      },
    );
    const before = game.state;
    if (round === 1) {
      game.act({ revision: 0, actions: [{ op: "ready" }] });
      assert.equal(game.inspect().battle?.kind, "pve");
      assert.equal(game.inspect().battle?.opponent, "Teumessian foxes");
      assert.equal(saves, 1);
    } else {
      assert.throws(
        () => game.act({ revision: 0, actions: [{ op: "ready" }] }),
        /Encounter does not match/,
      );
      assert.deepEqual(game.state, before);
      assert.equal(saves, 0);
    }
  }
});
