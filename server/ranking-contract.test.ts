import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { GameStore } from "./store.ts";
import { parseGame } from "../src/game.ts";
import type { Game } from "../src/game.ts";

function fixture() {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-ranking-contract-"));
  const path = join(directory, "game.sqlite");
  let clock = 0;
  const options = { now: () => clock };
  let store = new GameStore(path, options);
  const db = new DatabaseSync(path);
  function game(id: string) {
    const row = db.prepare("SELECT state FROM games WHERE guest=?").get(id);
    assert.ok(row && typeof row.state === "string");
    return parseGame(JSON.parse(row.state));
  }
  return {
    get store() {
      return store;
    },
    db,
    game,
    patch(id: string, change: Partial<Game>) {
      db.prepare("UPDATE games SET state=? WHERE guest=?").run(
        JSON.stringify(parseGame({ ...game(id), ...change })),
        id,
      );
    },
    opponents(id: string) {
      const row = db
        .prepare("SELECT source_opponents FROM games WHERE guest=?")
        .get(id);
      assert.ok(row && typeof row.source_opponents === "string");
      return JSON.parse(row.source_opponents);
    },
    source(id: string, values: readonly number[]) {
      db.prepare("UPDATE games SET source_opponents=? WHERE guest=?").run(
        JSON.stringify(values),
        id,
      );
    },
    act(id: string, op: "ready" | "continue", requestId = randomUUID()) {
      return store.act(id, {
        requestId,
        revision: game(id).revision,
        actions: [{ op }],
      });
    },
    reopen() {
      store.close();
      store = new GameStore(path, options);
    },
    async waitIncome(id: string) {
      for (let i = 0; i < 20 && game(id).phase.kind === "income"; i++) {
        clock += 500;
        await delay(120);
      }
      if (game(id).phase.kind === "income")
        throw new Error("Income did not finish");
    },
    close() {
      store.close();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function ordinaryResult(
  f: ReturnType<typeof fixture>,
  queue: "ranked" | "unranked",
  victory = false,
) {
  const a = f.store.create({ name: "Player", clan: "stag", queue });
  const b = f.store.create({ name: "Rival", clan: "stag", queue });
  for (const id of [a.guest.id, b.guest.id]) f.patch(id, { round: 2 });
  if (victory) {
    const army = f.game(a.guest.id);
    const tile = army.owned.find(
      (candidate) => !army.placements.some((p) => p.tile === candidate),
    );
    assert.ok(tile !== undefined);
    army.placements.push({
      id: "spear-camp",
      tile,
      level: 3,
      workers: 3,
      rune: null,
    });
    f.patch(a.guest.id, { placements: army.placements });
  }
  f.db
    .prepare("UPDATE profiles SET elo=999,freeplay_elo=777 WHERE guest=?")
    .run(b.guest.id);
  const requestId = randomUUID();
  assert.equal(f.act(a.guest.id, "ready", requestId).status, 202);
  assert.equal(f.act(b.guest.id, "ready").status, 200);
  assert.equal(f.act(a.guest.id, "ready", requestId).status, 200);
  const result = f.game(a.guest.id);
  assert.equal(result.phase.kind, "result");
  assert.ok(
    result.phase.kind === "result" &&
      (victory
        ? result.phase.outcome.winner === "polis"
        : result.phase.outcome.winner !== "polis"),
  );
  // Ready has settled the outcome; later fixtures supply post-battle counters.
  return a.guest.id;
}

test("both queues award their source mean before the deciding opponent, with independent placement counts", () => {
  for (const queue of ["ranked", "unranked"] as const) {
    const f = fixture();
    try {
      const id = ordinaryResult(f, queue);
      f.source(id, [0, 3]);
      f.patch(id, { wins: 9, lives: 0 });
      f.db
        .prepare(
          "UPDATE profiles SET elo=640,ranked_games=25,freeplay_elo=640,freeplay_games=5,xp=8 WHERE guest=?",
        )
        .run(id);
      const claim = {
        requestId: randomUUID(),
        revision: f.game(id).revision,
        actions: [{ op: "continue" as const }],
      };
      const reply = f.store.act(id, claim);
      assert.equal(reply.status, 200);
      const profile = f.store.profile(id);
      assert.deepEqual(profile.history[0], {
        queue,
        wins: 9,
        outcome: "defeat",
        xp: 2,
        elo: {
          before: 640,
          change: queue === "ranked" ? 2 : 3,
          after: queue === "ranked" ? 642 : 643,
          k: queue === "ranked" ? 10 : 20,
          opponent: 1,
        },
      });
      assert.deepEqual(
        {
          ranked: profile.elo,
          rankedGames: profile.rankedGames,
          freeplay: profile.freeplayElo,
          freeplayGames: profile.freeplayGames,
          xp: profile.xp,
        },
        {
          ranked: queue === "ranked" ? 642 : 640,
          rankedGames: queue === "ranked" ? 26 : 25,
          freeplay: queue === "unranked" ? 643 : 640,
          freeplayGames: queue === "unranked" ? 6 : 5,
          xp: 10,
        },
      );
      assert.deepEqual(f.opponents(id), []);
      assert.deepEqual(f.store.act(id, claim), reply);
      assert.deepEqual(f.store.profile(id), profile);
      assert.equal(
        f.db
          .prepare("SELECT opponent_elo FROM ranked_battles WHERE guest=?")
          .get(id)?.opponent_elo,
        queue === "ranked" ? 999 : 777,
        "actual ghost audit uses its selected queue, independently of the report list",
      );
    } finally {
      f.close();
    }
  }
});

for (const victory of [false, true])
  test(`terminal Elo ${victory ? "wraps the final signed32 sum before clamping" : "rounds each Int32 input before subtraction"}`, () => {
    const f = fixture();
    try {
      const id = ordinaryResult(f, "ranked", victory);
      f.source(id, victory ? [2147483520] : [16777216]);
      f.patch(
        id,
        victory ? { round: 10, season: "autumn", wins: 10 } : { lives: 0 },
      );
      f.db
        .prepare("UPDATE profiles SET elo=?,ranked_games=0 WHERE guest=?")
        .run(victory ? 2147483647 : 16777217, id);
      assert.equal(f.act(id, "continue").status, 200);
      const profile = f.store.profile(id);
      assert.deepEqual(
        profile.history[0],
        victory
          ? {
              queue: "ranked",
              wins: 10,
              outcome: "victory",
              xp: 5,
              elo: {
                before: 2147483647,
                change: 72,
                after: 0,
                k: 40,
                opponent: 2147483520,
              },
            }
          : {
              queue: "ranked",
              wins: 0,
              outcome: "defeat",
              xp: 0,
              elo: {
                before: 16777217,
                change: -90,
                after: 16777127,
                k: 40,
                opponent: 16777216,
              },
            },
      );
      assert.deepEqual(
        [profile.elo, profile.rankedGames, profile.xp],
        victory ? [0, 1, 5] : [16777127, 1, 0],
      );
    } finally {
      f.close();
    }
  });

test("normal terminal with no previous source reports uses zero; round-limit reports then clears without any award", () => {
  for (const roundLimit of [false, true]) {
    const f = fixture();
    try {
      const id = ordinaryResult(f, "ranked");
      f.source(id, roundLimit ? [0, 3] : []);
      f.patch(
        id,
        roundLimit
          ? { round: 19, season: "winter", wins: 8, lives: 1 }
          : { lives: 0 },
      );
      f.db
        .prepare(
          "UPDATE profiles SET elo=100,xp=8,ranked_games=3 WHERE guest=?",
        )
        .run(id);
      // The round-19 fixture keeps the captured actual ghost rating attached to its round.
      if (roundLimit)
        f.db
          .prepare("UPDATE ranked_battles SET round=19 WHERE guest=?")
          .run(id);
      assert.equal(f.act(id, "continue").status, 200);
      const p = f.store.profile(id);
      assert.deepEqual(
        p.history[0],
        roundLimit
          ? {
              queue: "ranked",
              wins: 8,
              outcome: "round-limit",
              xp: 0,
              elo: null,
            }
          : {
              queue: "ranked",
              wins: 0,
              outcome: "defeat",
              xp: 0,
              elo: { before: 100, change: -116, after: 0, k: 40, opponent: 0 },
            },
      );
      assert.deepEqual(
        [p.elo, p.rankedGames, p.xp],
        roundLimit ? [100, 3, 8] : [0, 4, 8],
      );
      assert.deepEqual(f.opponents(id), []);
    } finally {
      f.close();
    }
  }
});

test("reported opponent averages use source binary32 and Int32 conversion", () => {
  for (const [values, expected] of [
    [[1, 2], 1],
    [[0, 3, 0], 1],
    [[16777217], 16777216],
    [[2147483647], -2147483648],
  ] as const) {
    const f = fixture();
    try {
      const id = ordinaryResult(f, "ranked");
      f.source(id, values);
      f.patch(id, { lives: 0 });
      assert.equal(f.act(id, "continue").status, 200);
      assert.equal(f.store.profile(id).history[0]?.elo?.opponent, expected);
    } finally {
      f.close();
    }
  }
});

test("nonterminal PvP appends its actual selected-queue rating at battle time after the PvE zero", async () => {
  for (const queue of ["ranked", "unranked"] as const) {
    const f = fixture();
    try {
      const a = f.store.create({ name: "Player", clan: "stag", queue }).guest
        .id;
      const b = f.store.create({ name: "Rival", clan: "stag", queue }).guest.id;
      assert.equal(f.act(a, "ready").status, 200);
      assert.equal(f.act(a, "continue").status, 200);
      await f.waitIncome(a);
      f.patch(b, { round: 2 });
      f.db
        .prepare("UPDATE profiles SET elo=3,freeplay_elo=7 WHERE guest=?")
        .run(b);
      const waiting = randomUUID();
      assert.equal(f.act(a, "ready", waiting).status, 202);
      assert.equal(f.act(b, "ready").status, 200);
      assert.equal(f.act(a, "ready", waiting).status, 200);
      f.db
        .prepare("UPDATE profiles SET elo=1000,freeplay_elo=2000 WHERE guest=?")
        .run(b);
      assert.equal(f.act(a, "continue").status, 200);
      assert.deepEqual(f.opponents(a), queue === "ranked" ? [0, 3] : [0, 7]);
      assert.equal(f.store.profile(a).history.length, 0);
    } finally {
      f.close();
    }
  }
});

test("PvE reports zero once, browser reconnects preserve the live list, and authoritative reopen restores the saved mean", async () => {
  for (const reopen of [false, true]) {
    const f = fixture();
    try {
      const owner = f.store.create({ name: "PvE", clan: "stag" });
      const id = owner.guest.id;
      assert.equal(f.act(id, "ready").status, 200);
      f.source(id, [0, 3]);
      for (let i = 0; i < 2; i++) {
        const publicResponses = [
          f.store.inspect(id, { match: true }),
          f.store.profile(id),
          f.store.replay(id),
        ];
        assert.ok(
          !JSON.stringify(publicResponses).includes("source_opponents"),
        );
        assert.deepEqual(f.opponents(id), [0, 3]);
      }
      if (reopen) {
        f.reopen();
        assert.deepEqual(f.opponents(id), [1, 1]);
      }
      const request = {
        requestId: randomUUID(),
        revision: 1,
        actions: [{ op: "continue" as const }],
      };
      const reply = f.store.act(id, request);
      assert.equal(reply.status, 200);
      assert.deepEqual(f.opponents(id), reopen ? [1, 1, 0] : [0, 3, 0]);
      assert.deepEqual(f.store.act(id, request), reply);
      assert.deepEqual(f.opponents(id), reopen ? [1, 1, 0] : [0, 3, 0]);
      await f.waitIncome(id);
      for (const table of ["ghosts", "ranked_battles", "results"])
        assert.equal(
          f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
          0,
        );
      const waiting = randomUUID();
      assert.equal(f.act(id, "ready", waiting).status, 202);
      assert.equal(f.store.cancel(id, waiting).status, 200);
      assert.deepEqual(f.opponents(id), reopen ? [1, 1, 0] : [0, 3, 0]);
      assert.equal(
        f.store.enter(id, {
          requestId: randomUUID(),
          revision: f.game(id).revision,
          queue: "ranked",
          clan: "stag",
        }).status,
        200,
      );
      assert.deepEqual(f.opponents(id), []);
    } finally {
      f.close();
    }
  }
});

test("failed claims and rejected command batches roll back private reports and preserve prior source state", () => {
  const f = fixture();
  try {
    const id = ordinaryResult(f, "ranked");
    f.source(id, [0, 3]);
    f.patch(id, { lives: 0 });
    const revision = f.game(id).revision;
    assert.equal(
      f.store.act(id, {
        requestId: randomUUID(),
        revision,
        actions: [{ op: "continue" }, { op: "ready" }],
      }).status,
      422,
    );
    assert.deepEqual(f.opponents(id), [0, 3]);
    f.db.exec(
      "CREATE TRIGGER fail_award BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'fixture award failure'); END",
    );
    assert.throws(() => f.act(id, "continue"), /fixture award failure/);
    assert.deepEqual(
      [f.game(id).revision, f.game(id).phase.kind, f.opponents(id)],
      [revision, "result", [0, 3]],
    );
    assert.equal(f.store.profile(id).rankedGames, 0);
    f.db.exec("DROP TRIGGER fail_award");
    assert.equal(f.act(id, "continue").status, 200);
    assert.deepEqual(f.opponents(id), []);
  } finally {
    f.close();
  }
});

test("private source reports reject corrupt or out-of-domain persisted values", () => {
  const f = fixture();
  try {
    const id = f.store.create({ name: "Boundary", clan: "stag" }).guest.id;
    for (const raw of [
      "null",
      "[1.5]",
      "[2147483648]",
      JSON.stringify(Array(20).fill(0)),
    ]) {
      f.db
        .prepare("UPDATE games SET source_opponents=? WHERE guest=?")
        .run(raw, id);
      assert.throws(() => f.store.inspect(id));
    }
    f.source(id, []);
  } finally {
    f.close();
  }
});

test("unranked queue abandonment settles only committed round3-or-later wins and the prior source mean once", () => {
  for (const [round, wins, pendingResult] of [
    [1, 0, false],
    [2, 0, false],
    [3, 1, false],
    [8, 5, false],
    [3, 1, true],
  ] as const) {
    const f = fixture();
    try {
      const id = pendingResult
        ? ordinaryResult(f, "unranked")
        : f.store.create({ name: "Abandon", clan: "stag" }).guest.id;
      f.patch(id, { round, season: round < 5 ? "spring" : "summer", wins });
      f.source(id, round < 3 ? [] : [200]);
      f.db
        .prepare(
          "UPDATE profiles SET elo=640,ranked_games=25,freeplay_elo=200,freeplay_games=2,xp=8 WHERE guest=?",
        )
        .run(id);
      const request = {
        requestId: randomUUID(),
        revision: f.game(id).revision,
        queue: "ranked" as const,
        clan: "raven" as const,
      };
      const reply = f.store.enter(id, request);
      assert.equal(reply.status, 200);
      const p = f.store.profile(id);
      const rated = round >= 3;
      assert.deepEqual(
        p.history,
        rated
          ? [
              {
                queue: "unranked",
                wins,
                outcome: "abandoned",
                xp: wins === 5 ? 1 : 0,
                elo: {
                  before: 200,
                  change: wins === 5 ? 10 : -70,
                  after: wins === 5 ? 210 : 130,
                  k: 40,
                  opponent: 200,
                },
              },
            ]
          : [],
      );
      assert.deepEqual(
        [p.elo, p.rankedGames, p.freeplayElo, p.freeplayGames, p.xp],
        [
          640,
          25,
          rated ? (wins === 5 ? 210 : 130) : 200,
          rated ? 3 : 2,
          wins === 5 ? 9 : 8,
        ],
      );
      assert.deepEqual(
        [p.current.queue, p.current.round, p.current.phase, f.opponents(id)],
        ["ranked", 1, "prepare", []],
      );
      assert.deepEqual(f.store.enter(id, request), reply);
      assert.deepEqual(f.store.profile(id), p);
    } finally {
      f.close();
    }
  }
});

test("give-up persists abandonment once, keeps queue policy and rejects waiting or stale intents", () => {
  for (const queue of ["unranked", "ranked"] as const) {
    for (const round of [1, 3]) {
      const f = fixture();
      try {
        const id = f.store.create({ name: "Give up", clan: "stag", queue })
          .guest.id;
        f.patch(id, { round, wins: round === 3 ? 1 : 0 });
        const request = {
          requestId: randomUUID(),
          revision: f.game(id).revision,
          actions: [{ op: "give-up" as const }],
        };
        assert.equal(
          f.store.act(id, { ...request, revision: request.revision + 1 })
            .status,
          409,
        );
        assert.equal(f.store.profile(id).history.length, 0);
        const valid = { ...request, requestId: randomUUID() };
        const reply = f.store.act(id, valid);
        assert.equal(reply.status, 200);
        assert.deepEqual(f.game(id).phase, {
          kind: "finished",
          outcome: "defeat",
        });
        const profile = f.store.profile(id);
        assert.equal(profile.current.queue, queue);
        assert.equal(
          profile.history.length,
          queue === "ranked" || round >= 3 ? 1 : 0,
        );
        if (profile.history.length)
          assert.equal(profile.history[0]?.outcome, "abandoned");
        if (profile.history.length)
          assert.equal(profile.history[0]?.wins, round === 3 ? 1 : 0);
        f.reopen();
        assert.deepEqual(
          f.store.act(id, valid),
          reply,
          "lost acknowledgement retries the original receipt",
        );
        assert.deepEqual(f.store.profile(id), profile);
        assert.equal(
          f.store.act(id, { ...valid, actions: [{ op: "ready" }] }).status,
          409,
        );
        assert.equal(
          f.store.act(id, {
            ...valid,
            requestId: randomUUID(),
            revision: f.game(id).revision,
          }).status,
          422,
        );
        assert.deepEqual(f.store.profile(id), profile);
      } finally {
        f.close();
      }
    }
  }
  const f = fixture();
  try {
    const id = f.store.create({
      name: "Waiting surrender",
      clan: "stag",
      queue: "ranked",
    }).guest.id;
    f.patch(id, { round: 2 });
    const wait = randomUUID();
    assert.equal(f.act(id, "ready", wait).status, 202);
    const request = {
      requestId: randomUUID(),
      revision: f.game(id).revision,
      actions: [{ op: "give-up" as const }],
    };
    const before = f.game(id);
    assert.equal(f.store.act(id, request).status, 422);
    assert.deepEqual(f.game(id), before);
    assert.equal(f.store.profile(id).history.length, 0);
    assert.equal(f.store.cancel(id, wait).status, 200);
    const accepted = { ...request, requestId: randomUUID() };
    f.db.exec(
      "CREATE TRIGGER fail_give_up BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'give-up rollback'); END",
    );
    assert.throws(() => f.store.act(id, accepted), /give-up rollback/);
    assert.deepEqual(f.game(id), before);
    f.db.exec("DROP TRIGGER fail_give_up");
    assert.equal(f.store.act(id, accepted).status, 200);
    assert.equal(f.store.profile(id).history[0]?.outcome, "abandoned");
    assert.equal(f.store.replay(id), null);
  } finally {
    f.close();
  }
});

test("give-up ignores an older waiting receipt after another client advances the polis", () => {
  const f = fixture();
  try {
    const id = f.store.create({
      name: "Old waiting receipt",
      clan: "stag",
      queue: "ranked",
    }).guest.id;
    f.patch(id, { round: 2 });
    assert.equal(f.act(id, "ready").status, 202);
    assert.equal(
      f.store.act(id, {
        requestId: randomUUID(),
        revision: f.game(id).revision,
        actions: [{ op: "villager" }],
      }).status,
      200,
    );
    const revision = f.game(id).revision;
    assert.equal(
      f.store.act(id, {
        requestId: randomUUID(),
        revision,
        actions: [{ op: "give-up" }, { op: "restart", clan: "stag" }],
      }).status,
      422,
    );
    assert.equal(f.game(id).revision, revision);
    assert.equal(
      f.store.act(id, {
        requestId: randomUUID(),
        revision,
        actions: [{ op: "give-up" }],
      }).status,
      200,
    );
    assert.equal(f.store.profile(id).history[0]?.outcome, "abandoned");
  } finally {
    f.close();
  }
});

test("ranked paid abandonment settles a persisted round1 or later run before changing queues", () => {
  for (const [round, wins, pending, elo, expectedChange] of [
    [1, 0, false, 100, -116],
    [2, 1, true, 200, -70],
    [8, 5, false, 200, 10],
  ] as const) {
    const f = fixture();
    try {
      const id = pending
        ? ordinaryResult(f, "ranked")
        : f.store.create({
            name: "Paid abandon",
            clan: "stag",
            queue: "ranked",
          }).guest.id;
      f.patch(id, { round, wins, season: round < 5 ? "spring" : "summer" });
      f.source(id, round === 1 ? [] : [200]);
      f.db
        .prepare(
          "UPDATE profiles SET elo=?,ranked_games=2,freeplay_elo=640,freeplay_games=25,xp=8 WHERE guest=?",
        )
        .run(elo, id);
      const request = {
        requestId: randomUUID(),
        revision: f.game(id).revision,
        queue: "unranked" as const,
        clan: "raven" as const,
      };
      const reply = f.store.enter(id, request);
      assert.equal(reply.status, 200);
      const p = f.store.profile(id);
      const after = Math.max(0, elo + expectedChange);
      assert.deepEqual(p.history, [
        {
          queue: "ranked",
          wins,
          outcome: "abandoned",
          xp: wins === 5 ? 1 : 0,
          elo: {
            before: elo,
            change: expectedChange,
            after,
            k: 40,
            opponent: round === 1 ? 0 : 200,
          },
        },
      ]);
      assert.deepEqual(
        [
          p.elo,
          p.rankedGames,
          p.freeplayElo,
          p.freeplayGames,
          p.xp,
          p.standing,
        ],
        [after, 3, 640, 25, wins === 5 ? 9 : 8, { rank: 1, position: 1 }],
      );
      assert.deepEqual(
        [p.current.queue, p.current.round, p.current.phase, f.opponents(id)],
        ["unranked", 1, "prepare", []],
      );
      assert.deepEqual(f.store.enter(id, request), reply);
      assert.deepEqual(f.store.profile(id), p);
      assert.equal(f.store.leaderboard(1, id).rows[0]?.games, 3);
    } finally {
      f.close();
    }
  }
});

test("paid ranked abandonment keeps pending cancel-first, stale and UUID conflict protections", () => {
  const f = fixture();
  try {
    const id = f.store.create({
      name: "Waiting abandon",
      clan: "stag",
      queue: "ranked",
    }).guest.id;
    f.patch(id, { round: 2 });
    const wait = randomUUID();
    assert.equal(f.act(id, "ready", wait).status, 202);
    const request = {
      requestId: randomUUID(),
      revision: 0,
      queue: "unranked" as const,
      clan: "stag" as const,
    };
    assert.deepEqual(f.store.enter(id, request), {
      status: 409,
      body: { r: 0, error: "waiting" },
    });
    assert.equal(f.store.profile(id).history.length, 0);
    assert.equal(f.store.cancel(id, wait).status, 200);
    assert.deepEqual(
      f.store.enter(id, { ...request, requestId: randomUUID(), revision: 1 }),
      { status: 409, body: { r: 0, error: "stale" } },
    );
    const accepted = { ...request, requestId: randomUUID() };
    assert.equal(f.store.enter(id, accepted).status, 200);
    const paid = f.store.profile(id);
    assert.equal(paid.rankedGames, 1);
    assert.equal(paid.history[0]?.elo?.change, -90);
    assert.deepEqual(f.store.enter(id, { ...accepted, queue: "ranked" }), {
      status: 409,
      body: { error: "request-conflict" },
    });
    assert.deepEqual(f.store.profile(id), paid);
  } finally {
    f.close();
  }
});

test("abandon settlement and new queue state share one rollback boundary in either queue", () => {
  for (const queue of ["unranked", "ranked"] as const) {
    const f = fixture();
    try {
      const id = f.store.create({ name: "Rollback", clan: "stag", queue }).guest
        .id;
      f.patch(id, { round: 3 });
      f.source(id, [200]);
      const before = f.store.profile(id);
      f.db.exec(
        "CREATE TRIGGER fail_abandon BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'fixture abandon failure'); END",
      );
      const request = {
        requestId: randomUUID(),
        revision: 0,
        queue: "ranked" as const,
        clan: "stag" as const,
      };
      assert.throws(
        () => f.store.enter(id, request),
        /fixture abandon failure/,
      );
      assert.deepEqual(f.store.profile(id), before);
      assert.deepEqual(f.opponents(id), [200]);
      f.db.exec("DROP TRIGGER fail_abandon");
      assert.equal(f.store.enter(id, request).status, 200);
      const paid = f.store.profile(id);
      assert.equal(
        queue === "ranked" ? paid.rankedGames : paid.freeplayGames,
        1,
      );
    } finally {
      f.close();
    }
  }
});

test("the trusted profile keeps source first-match Elo leagues separate from XP rank", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-source-league-"));
  const path = join(directory, "game.sqlite");
  const store = new GameStore(path);
  try {
    const created = store.create({ name: "Source league", clan: "stag" });
    assert.equal(store.profile(created.guest.id).elo, 0);
    // The actual selected source collection is ascending, but its native selector
    // returns the FIRST qualifying row/index. Elo100 does not enter row2.
    const database = new DatabaseSync(path);
    try {
      for (const elo of [0, 99, 100, 599, 600]) {
        database
          .prepare("UPDATE profiles SET elo=?,xp=30 WHERE guest=?")
          .run(elo, created.guest.id);
        const profile = store.profile(created.guest.id);
        assert.deepEqual(
          { elo: profile.elo, league: profile.league, rank: profile.rank },
          {
            elo,
            league: { band: 1, tier: 1 },
            rank: { band: 3, floor: 30, next: 90 },
          },
        );
      }
    } finally {
      database.close();
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
