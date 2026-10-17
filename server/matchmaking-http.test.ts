import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { gameServer } from "./http.ts";
import { parseGame } from "../src/game.ts";
import { seasonForRound } from "../src/rules-version.ts";

async function fixture() {
  const directory = mkdtempSync(
    join(homedir(), ".cache/task-tmp/matchmaking-http-"),
  );
  const path = join(directory, "game.sqlite");
  let server = gameServer({ database: path });
  let origin = "";
  async function start() {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
  }
  async function stop() {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    });
  }
  await start();
  async function request(route: string, cookie = "", body?: object) {
    const response = await fetch(origin + route, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload: unknown = await response.json();
    return {
      status: response.status,
      headers: response.headers,
      body: payload,
    };
  }
  function prepare(
    id: string,
    options: {
      round?: number;
      wins?: number;
      lives?: number;
      elo?: number;
      games?: number;
    } = {},
  ) {
    // Trusted saved-state fixtures vary matching inputs, never the selected opponent or result.
    const database = new DatabaseSync(path);
    try {
      const row = database
        .prepare("SELECT state FROM games WHERE guest=?")
        .get(id);
      assert.ok(row && typeof row.state === "string");
      const game = parseGame(JSON.parse(row.state));
      game.round = options.round ?? 8;
      game.season = seasonForRound(game.round);
      game.phase = { kind: "prepare" };
      game.wins = options.wins ?? 0;
      game.lives = options.lives ?? 5;
      database
        .prepare("UPDATE games SET state=? WHERE guest=?")
        .run(JSON.stringify(parseGame(game)), id);
      database
        .prepare(
          "UPDATE profiles SET elo=?,ranked_games=?,freeplay_elo=?,freeplay_games=? WHERE guest=?",
        )
        .run(
          options.elo ?? 100,
          options.games ?? 10,
          options.elo ?? 100,
          options.games ?? 10,
          id,
        );
    } finally {
      database.close();
    }
  }
  async function guest(
    name: string,
    options: Parameters<typeof prepare>[1] & {
      queue?: "ranked" | "unranked";
    } = {},
  ) {
    const created = await request("/api/guest", "", {
      name,
      clan: "stag",
      queue: options.queue ?? "ranked",
    });
    assert.equal(created.status, 200);
    const id = z
      .object({ guest: z.object({ id: z.uuid() }) })
      .parse(created.body).guest.id;
    const cookie = created.headers
      .getSetCookie()
      .find((value) => value.startsWith("greece_guest="))
      ?.split(";")[0];
    assert.ok(cookie);
    prepare(id, options);
    return { id, cookie };
  }
  async function ready(
    owner: Awaited<ReturnType<typeof guest>>,
    requestId = randomUUID(),
  ) {
    const state = await request("/api/game", owner.cookie);
    const { r } = z.object({ r: z.number() }).parse(state.body);
    return request("/api/game/act", owner.cookie, {
      requestId,
      revision: r,
      actions: [{ op: "ready" }],
    });
  }
  async function opponent(owner: Awaited<ReturnType<typeof guest>>) {
    const replay = await request("/api/game/replay", owner.cookie);
    assert.equal(replay.status, 200);
    return z
      .object({ encounter: z.object({ opponent: z.string() }) })
      .parse(replay.body).encounter.opponent;
  }
  return {
    path,
    request,
    prepare,
    guest,
    ready,
    opponent,
    async restart() {
      await stop();
      server = gameServer({ database: path });
      await start();
    },
    async close() {
      await stop();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

for (const scenario of [
  {
    name: "rating",
    target: { elo: 100 },
    older: { elo: 110 },
    newer: { elo: 900 },
  },
  {
    name: "placement experience",
    target: { games: 0 },
    older: { games: 0 },
    newer: { games: 30 },
  },
  {
    name: "campaign record",
    target: { wins: 3, lives: 3 },
    older: { wins: 3, lives: 3 },
    newer: { wins: 0, lives: 1 },
  },
]) {
  test(`HTTP matchmaking prefers comparable ${scenario.name} over the newest ghost`, async () => {
    const f = await fixture();
    try {
      const target = await f.guest("Target", scenario.target);
      const older = await f.guest("Comparable", scenario.older);
      const newer = await f.guest("Newest mismatch", scenario.newer);
      assert.equal((await f.ready(older)).status, 202);
      assert.equal(
        (await f.ready(newer)).status,
        200,
        "sparse pools still match outside the preferred bracket",
      );
      assert.equal((await f.ready(target)).status, 200);
      assert.equal(await f.opponent(target), "Comparable");
    } finally {
      await f.close();
    }
  });
}

test("submitted rating and record stay frozen; completed Ready survives retry and service reopen", async () => {
  const f = await fixture();
  try {
    const target = await f.guest("Target", { elo: 500, wins: 3, lives: 3 });
    const older = await f.guest("Frozen comparable", {
      elo: 510,
      wins: 3,
      lives: 3,
    });
    const newer = await f.guest("Newest mismatch", {
      elo: 1000,
      wins: 0,
      lives: 1,
    });
    assert.equal((await f.ready(older)).status, 202);
    assert.equal((await f.ready(newer)).status, 200);
    f.prepare(older.id, { elo: 2500, wins: 0, lives: 1 });
    const before = await f.request("/api/game?match=1", target.cookie);
    assert.ok(
      !JSON.stringify(before.body).includes("Frozen comparable"),
      "preparation keeps candidate identities private",
    );
    const requestId = randomUUID();
    const response = await f.ready(target, requestId);
    assert.equal(response.status, 200);
    assert.equal(await f.opponent(target), "Frozen comparable");
    const database = new DatabaseSync(f.path, { readOnly: true });
    try {
      assert.equal(
        database
          .prepare("SELECT opponent_elo FROM ranked_battles WHERE guest=?")
          .get(target.id)?.opponent_elo,
        510,
      );
    } finally {
      database.close();
    }
    await f.restart();
    const retry = await f.request("/api/game/act", target.cookie, {
      requestId,
      revision: 0,
      actions: [{ op: "ready" }],
    });
    assert.deepEqual(retry.body, response.body);
    assert.equal(await f.opponent(target), "Frozen comparable");
  } finally {
    await f.close();
  }
});

test("comparable unseen opponents rotate within a run, but a closer rating bracket wins over diversity", async () => {
  const f = await fixture();
  try {
    const target = await f.guest("Target");
    const repeated = await f.guest("Repeated");
    assert.equal((await f.ready(repeated)).status, 202);
    assert.equal((await f.ready(target)).status, 200);
    assert.equal(await f.opponent(target), "Repeated");
    f.prepare(target.id, { round: 10 });
    const unseen = await f.guest("Unseen", { round: 10, elo: 150 });
    assert.equal((await f.ready(unseen)).status, 202);
    f.prepare(repeated.id, { round: 10 });
    assert.equal((await f.ready(repeated)).status, 200);
    assert.equal((await f.ready(target)).status, 200);
    assert.equal(await f.opponent(target), "Unseen");
    f.prepare(target.id, { round: 11 });
    f.prepare(repeated.id, { round: 11 });
    assert.equal((await f.ready(repeated)).status, 202);
    const distant = await f.guest("Distant unseen", { round: 11, elo: 900 });
    assert.equal((await f.ready(distant)).status, 200);
    assert.equal((await f.ready(target)).status, 200);
    assert.equal(await f.opponent(target), "Repeated");
  } finally {
    await f.close();
  }
});

test("waiting never uses another queue, another round, or one's own old run; cancel withdraws its snapshot", async () => {
  const f = await fixture();
  try {
    const target = await f.guest("Target");
    const otherRound = await f.guest("Wrong round", { round: 10 });
    const casual = await f.guest("Wrong queue", { queue: "unranked" });
    assert.equal((await f.ready(otherRound)).status, 202);
    assert.equal((await f.ready(casual)).status, 202);
    const requestId = randomUUID();
    assert.equal((await f.ready(target, requestId)).status, 202);
    const database = new DatabaseSync(f.path);
    try {
      database
        .prepare("UPDATE games SET run=? WHERE guest=?")
        .run(randomUUID(), target.id);
    } finally {
      database.close();
    }
    const second = randomUUID();
    assert.equal((await f.ready(target, second)).status, 202);
    assert.equal(
      (
        await f.request("/api/game/cancel", target.cookie, {
          requestId: second,
        })
      ).status,
      200,
    );
    const inspect = await f.request("/api/game?match=1", target.cookie);
    assert.deepEqual(
      z
        .object({
          matchmaking: z.object({
            submitted: z.boolean(),
            available: z.boolean(),
          }),
        })
        .parse(inspect.body).matchmaking,
      { submitted: false, available: false },
    );
  } finally {
    await f.close();
  }
});

for (const queue of ["ranked", "unranked"] as const) {
  test(`${queue} history survives many campaigns and service reopen for a lone returning player`, async () => {
    const f = await fixture();
    try {
      const target = await f.guest("Target", { queue });
      const rival = await f.guest("Returning rival", { queue });
      assert.equal((await f.ready(rival)).status, 202);
      const foil = await f.guest("Distant rival", { elo: 1500, queue });
      assert.equal((await f.ready(foil)).status, 200);
      for (let campaign = 0; campaign < 5; campaign++) {
        const database = new DatabaseSync(f.path);
        try {
          database
            .prepare("UPDATE games SET run=? WHERE guest=?")
            .run(randomUUID(), rival.id);
        } finally {
          database.close();
        }
        f.prepare(rival.id, { elo: 1000 });
        assert.equal((await f.ready(rival)).status, 200);
      }
      await f.restart();
      assert.equal((await f.ready(target)).status, 200);
      assert.equal(await f.opponent(target), "Returning rival");
      const audit = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(
          audit
            .prepare("SELECT opponent_elo FROM ranked_battles WHERE guest=?")
            .get(target.id)?.opponent_elo,
          100,
        );
        assert.equal(
          audit
            .prepare(
              "SELECT COUNT(*) AS total FROM ghosts WHERE guest=? AND ranked=?",
            )
            .get(rival.id, queue === "ranked" ? 1 : 0)?.total,
          6,
          "all six submitted campaigns remain available after reopening",
        );
      } finally {
        audit.close();
      }
    } finally {
      await f.close();
    }
  });
}
