import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameStore } from "./store.ts";
import { kFactor, rate, xpAward, xpRank } from "./ranking.ts";
import { parseGame } from "../src/game.ts";

function prepareOrdinaryRound(path: string, guests: readonly string[]) {
  // Trusted server preparation fixtures isolate ordinary PvP ranking from round-1 PvE.
  const database = new DatabaseSync(path);
  try {
    for (const guest of guests) {
      const row = database
        .prepare("SELECT state FROM games WHERE guest=?")
        .get(guest);
      assert.ok(row && typeof row.state === "string");
      const game = parseGame(JSON.parse(row.state));
      game.round = 2;
      database
        .prepare("UPDATE games SET state=? WHERE guest=?")
        .run(JSON.stringify(parseGame(game)), guest);
    }
  } finally {
    database.close();
  }
}

// Expected values follow handoffs/20261013-build118-ranking-source-next/README.md:
// K = 40/20/10 for placements <5 / <20 / otherwise; D = player-opponent when wins>5, else
// opponent-player; P = 1/(1+10^(D/400)); raw = (wins-4.5)·P·K in binary32; ceil when wins>5,
// else floor; rating = max(0, player+change).
test("Elo change matches the source table and its K placement steps", () => {
  // Equal ratings: D=0, P=1/(1+1)=0.5.
  // 4 wins, K40: (4-4.5)·0.5·40 = -10 → floor -10 → 100-10 = 90.
  assert.deepEqual(rate(4, 100, 100, 0), { k: 40, change: -10, elo: 90 });
  // 5 wins is positive: (5-4.5)·0.5·40 = 10 → floor 10 → 110.
  assert.deepEqual(rate(5, 100, 100, 0), { k: 40, change: 10, elo: 110 });
  // 6 wins: 1.5·0.5·40 = 30 → ceil 30 → 130.
  assert.deepEqual(rate(6, 100, 100, 0), { k: 40, change: 30, elo: 130 });
  // Fifth placement already played (count 5): K20, 1.5·0.5·20 = 15 → 115.
  assert.deepEqual(rate(6, 100, 100, 5), { k: 20, change: 15, elo: 115 });
  // Count 20: K10, 1.5·0.5·10 = 7.5 → ceil 8 → 108.
  assert.deepEqual(rate(6, 100, 100, 20), { k: 10, change: 8, elo: 108 });
  // 0 wins from 0: -4.5·0.5·40 = -90 is the recorded change; the rating clamps to 0.
  assert.deepEqual(rate(0, 0, 0, 0), { k: 40, change: -90, elo: 0 });
  // 10 wins from 0: 5.5·0.5·40 = 110 → 110.
  assert.deepEqual(rate(10, 0, 0, 0), { k: 40, change: 110, elo: 110 });
});

test("Elo change weighs the opponent rating on the 400 scale", () => {
  // 7 wins, 200 vs 100, K40: D = 200-100 = 100; 10^(100/400) = 1.7782794;
  // P = 1/2.7782794 = 0.35993502; 2.5·P·40 = 35.993504 → ceil 36 → 236.
  assert.deepEqual(rate(7, 200, 100, 3), { k: 40, change: 36, elo: 236 });
  // 2 wins, 50 vs a 150.5 opponent mean, K20 (count 7): D = 150.5-50 = 100.5;
  // 10^(100.5/400) = 1.7834051; P = 0.35927218; -2.5·P·20 = -17.96361 → floor -18 → 32.
  assert.deepEqual(rate(2, 50, 150.5, 7), { k: 20, change: -18, elo: 32 });
  // 9 wins, 640 vs 800, K10 (count 25): D = 640-800 = -160; 10^(-0.4) = 0.39810717;
  // P = 1/1.39810717 = 0.71525276; 4.5·P·10 = 32.186375 → ceil 33 → 673.
  assert.deepEqual(rate(9, 640, 800, 25), { k: 10, change: 33, elo: 673 });
  assert.deepEqual([4, 5, 19, 20].map(kFactor), [40, 20, 20, 10]);
});

test("XP awards and rank bands follow GameOver and GetRanking", () => {
  // handoffs/20261013-build118-ranking-callers-next: <5 wins 0, 5–7 1, 8–9 2, 10+ 5.
  assert.deepEqual([0, 4, 5, 7, 8, 9, 10].map(xpAward), [0, 0, 1, 1, 2, 2, 5]);
  // Thresholds 0/10/30/90/150/300/600/1200; XP 9 is 9/10 in band 1, XP 10 starts band 2
  // (0/20), XP 29 is 19/20, and XP 1200 is the terminal band reporting 1200 as its next.
  assert.deepEqual(xpRank(0), { band: 1, floor: 0, next: 10 });
  assert.deepEqual(xpRank(9), { band: 1, floor: 0, next: 10 });
  assert.deepEqual(xpRank(10), { band: 2, floor: 10, next: 30 });
  assert.deepEqual(xpRank(29), { band: 2, floor: 10, next: 30 });
  assert.deepEqual(xpRank(599), { band: 6, floor: 300, next: 600 });
  assert.deepEqual(xpRank(1200), { band: 8, floor: 1200, next: 1200 });
  assert.deepEqual(xpRank(5000), { band: 8, floor: 1200, next: 1200 });
});

test("a ranked finishing claim awards the source Elo and XP exactly once", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-ranked-store-"));
  const path = join(directory, "game.sqlite");
  let store = new GameStore(path);
  try {
    const a = store.create({ name: "Rated A", clan: "stag", queue: "ranked" });
    const b = store.create({ name: "Rated B", clan: "stag", queue: "ranked" });
    const unranked = store.create({ name: "Casual", clan: "stag" });
    prepareOrdinaryRound(path, [a.guest.id, b.guest.id, unranked.guest.id]);
    const ready = (id: string, r: number, requestId = randomUUID()) =>
      store.act(id, { requestId, revision: r, actions: [{ op: "ready" }] });
    // Unranked ghosts never meet a ranked run.
    assert.equal(ready(unranked.guest.id, 0).status, 202);
    const waitA = randomUUID();
    assert.equal(ready(a.guest.id, 0, waitA).status, 202);
    assert.equal(ready(b.guest.id, 0).status, 200);
    assert.equal(ready(a.guest.id, 0, waitA).status, 200);
    store.close();
    // Fixture: A is a 640-rated player with 25 ranked games and 8 XP; earlier reported
    // opponents have mean800. Ready has settled the real stag mirror draw's last-life
    // loss, leaving a nine-win terminal result pending Continue cleanup.
    const fixture = new DatabaseSync(path);
    const row = fixture
      .prepare("SELECT state FROM games WHERE guest=?")
      .get(a.guest.id);
    const game = JSON.parse(String(row?.state));
    assert.equal(game.phase.outcome.winner, "draw");
    Object.assign(game, { round: 10, season: "autumn", wins: 9, lives: 0 });
    fixture
      .prepare(
        "UPDATE games SET state=?,source_opponents='[800]' WHERE guest=?",
      )
      .run(JSON.stringify(game), a.guest.id);
    fixture
      .prepare(
        "UPDATE profiles SET elo=640,xp=8,ranked_games=25,last_ranked=0 WHERE guest=?",
      )
      .run(a.guest.id);
    fixture
      .prepare("UPDATE ranked_battles SET opponent_elo=800 WHERE guest=?")
      .run(a.guest.id);
    fixture.close();
    store = new GameStore(path);
    const claim = {
      requestId: randomUUID(),
      revision: game.revision,
      actions: [{ op: "continue" as const }],
    };
    const first = store.act(a.guest.id, claim);
    assert.equal(first.status, 200);
    // 9 wins, 640 vs 800, K10: change +33 → 673 (arithmetic in the first tests); XP 8+2 = 10.
    const awarded = store.profile(a.guest.id);
    assert.deepEqual(
      {
        elo: awarded.elo,
        xp: awarded.xp,
        rank: awarded.rank,
        rankedGames: awarded.rankedGames,
        standing: awarded.standing,
        current: awarded.current.phase,
        history: awarded.history,
      },
      {
        elo: 673,
        xp: 10,
        rank: { band: 2, floor: 10, next: 30 },
        rankedGames: 26,
        standing: { rank: 1, position: 1 },
        current: "finished",
        history: [
          {
            queue: "ranked",
            wins: 9,
            outcome: "defeat",
            xp: 2,
            elo: { before: 640, change: 33, after: 673, k: 10, opponent: 800 },
          },
        ],
      },
    );
    // A retried claim replays its receipt; a fresh claim is refused. Neither awards again.
    assert.deepEqual(store.act(a.guest.id, claim), first);
    assert.equal(
      store.act(a.guest.id, {
        ...claim,
        requestId: randomUUID(),
        revision: game.revision + 1,
      }).status,
      422,
    );
    assert.deepEqual(store.profile(a.guest.id), awarded);
    const board = store.leaderboard(1, a.guest.id);
    assert.deepEqual(board.rows, [
      {
        rank: 1,
        position: 1,
        name: "Rated A",
        elo: 673,
        xp: 10,
        band: 2,
        games: 26,
        you: true,
      },
    ]);
    assert.equal(store.leaderboard(1, null).rows[0]?.you, false);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unchanged rating keeps its place in a tie", () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-ranked-tie-"));
  const path = join(directory, "game.sqlite");
  let store = new GameStore(path);
  try {
    const first = store.create({
      name: "First",
      clan: "stag",
      queue: "ranked",
    });
    const second = store.create({
      name: "Second",
      clan: "stag",
      queue: "ranked",
    });
    prepareOrdinaryRound(path, [first.guest.id, second.guest.id]);
    const wait = randomUUID();
    const ready = (id: string, requestId = randomUUID()) =>
      store.act(id, { requestId, revision: 0, actions: [{ op: "ready" }] });
    assert.equal(ready(first.guest.id, wait).status, 202);
    assert.equal(ready(second.guest.id).status, 200);
    assert.equal(ready(first.guest.id, wait).status, 200);
    store.close();
    // Fixture: both already hold 0 Elo from one ranked game, First having reached it earlier
    // (result 1 before 2); Ready has settled First's last-life loss from the mirror draw.
    const fixture = new DatabaseSync(path);
    const row = fixture
      .prepare("SELECT state FROM games WHERE guest=?")
      .get(first.guest.id);
    const game = JSON.parse(String(row?.state));
    fixture
      .prepare("UPDATE games SET state=? WHERE guest=?")
      .run(JSON.stringify({ ...game, lives: 0 }), first.guest.id);
    for (const [id, marker] of [
      [first.guest.id, 1],
      [second.guest.id, 2],
    ] as const)
      fixture
        .prepare(
          "UPDATE profiles SET elo=0,ranked_games=1,last_ranked=? WHERE guest=?",
        )
        .run(marker, id);
    fixture.close();
    store = new GameStore(path);
    const names = () =>
      store.leaderboard(1, null).rows.map((r) => [r.position, r.name, r.elo]);
    assert.deepEqual(names(), [
      [1, "First", 0],
      [2, "Second", 0],
    ]);
    // 0 wins from 0: change -90, rating stays 0, so First keeps the earlier tie position.
    assert.equal(
      store.act(first.guest.id, {
        requestId: randomUUID(),
        revision: game.revision,
        actions: [{ op: "continue" }],
      }).status,
      200,
    );
    assert.equal(store.profile(first.guest.id).rankedGames, 2);
    assert.deepEqual(names(), [
      [1, "First", 0],
      [2, "Second", 0],
    ]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
