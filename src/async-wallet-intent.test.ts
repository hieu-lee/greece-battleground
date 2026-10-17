import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gameServer } from "../server/http.ts";
import { actionRequest, GameStore } from "../server/store.ts";
import { newGame, parseGame } from "./game.ts";
import { neighbours, tileId } from "./map.ts";
import { publicGame } from "./read-model.ts";
import { createPlaySession } from "./play-session.ts";
import { createActionDispatch } from "./action-dispatch.ts";

for (const delivery of ["lost-ack", "before-post"] as const)
  test(`a new Ready intent (${delivery}) survives a real Memory wallet-only preflight; saved UUID retries and semantic staleness remain strict`, async () => {
    const base = join(homedir(), ".cache/task-tmp");
    mkdirSync(base, { recursive: true });
    const directory = mkdtempSync(join(base, "async-wallet-intent-"));
    const path = join(directory, "game.sqlite");
    let store = new GameStore(path);
    const owner = store.create({
      name: "Wallet intent private owner",
      clan: "raven",
    });
    const rival = store.create({
      name: "Wallet intent private rival",
      clan: "raven",
    });
    store.close();
    const game = newGame(42, "raven", "async", () => 0);
    game.insight = 16;
    game.favor.athena = 5;
    game.fate = ["memory-of-the-polis", null, null];
    const holder = tileId.parse(37),
      hall = tileId.parse(35);
    game.owned = [holder, ...neighbours(holder), hall];
    game.placements[0]!.tile = hall;
    game.placements.push({
      tile: holder,
      id: "watchtower",
      level: 1,
      workers: 0,
      rune: null,
    });
    for (const tile of neighbours(holder))
      game.placements.push({
        tile,
        id: "forge",
        level: 1,
        workers: 0,
        rune: null,
      });
    const other = newGame(42, "raven", "async", () => 0);
    other.round = 2;
    const database = new DatabaseSync(path);
    database
      .prepare("UPDATE games SET state=? WHERE guest=?")
      .run(JSON.stringify(parseGame(game)), owner.guest.id);
    database
      .prepare("UPDATE games SET state=? WHERE guest=?")
      .run(JSON.stringify(parseGame(other)), rival.guest.id);
    database.close();
    store = new GameStore(path);
    assert.equal(
      store.act(
        rival.guest.id,
        actionRequest.parse({
          requestId: randomUUID(),
          revision: 0,
          actions: [{ op: "ready" }],
        }),
      ).status,
      202,
    );
    store.close();
    const server = gameServer({ database: path });
    const lifetime = new AbortController();
    const nativeFetch = fetch;
    const names = [
      "fetch",
      "navigator",
      "document",
      "localStorage",
      "addEventListener",
    ];
    const originals = names.map(
      (name) =>
        [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
    );
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const origin = `http://127.0.0.1:${address.port}`;
      const cookie = "greece_guest=" + owner.token;
      const read = async () =>
        publicGame.parse(
          await (
            await nativeFetch(origin + "/api/game", {
              headers: { Cookie: cookie },
            })
          ).json(),
        );
      const posted: ReturnType<typeof actionRequest.parse>[] = [];
      const values = new Map<string, string>();
      const locks = new Map<string, Promise<unknown>>();
      const events = new EventTarget();
      let walletPreflight = false;
      let semanticPreflight = false;
      let loseReply = false;
      let preflightRevision: number | null = null;
      const boundary = {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), origin);
          let capturedPreflight = false;
          if (url.pathname === "/api/game" && walletPreflight) {
            walletPreflight = false;
            const before = await read();
            let current = before;
            const deadline = performance.now() + 1500;
            while (current.r === before.r && performance.now() < deadline) {
              await delay(10);
              current = await read();
            }
            assert.ok(
              current.r > before.r,
              "the real Memory owner makes a later wallet payment during preflight",
            );
            assert.equal(current.phase, "prepare");
            capturedPreflight = true;
          }
          if (url.pathname === "/api/game" && semanticPreflight) {
            semanticPreflight = false;
            const current = await read();
            const response = await nativeFetch(origin + "/api/game/act", {
              method: "POST",
              headers: { Cookie: cookie, "Content-Type": "application/json" },
              body: JSON.stringify({
                requestId: randomUUID(),
                revision: current.r,
                actions: [{ op: "continue" }],
              }),
            });
            assert.equal(
              response.status,
              200,
              "the other actor really advances the battle phase",
            );
          }
          const payload =
            url.pathname === "/api/game/act"
              ? actionRequest.parse(JSON.parse(String(init?.body)))
              : null;
          if (payload) posted.push(payload);
          if (payload && loseReply && delivery === "before-post") {
            loseReply = false;
            throw Error("Deliberately fail before the action reaches HTTP");
          }
          const response = await nativeFetch(url, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              Cookie: cookie,
            },
          });
          if (capturedPreflight)
            preflightRevision = publicGame
              .pick({ r: true })
              .loose()
              .parse(await response.clone().json()).r;
          if (payload && loseReply) {
            loseReply = false;
            assert.equal(
              response.status,
              200,
              "the server really commits Ready before acknowledgement loss",
            );
            throw Error("Deliberately lost successful HTTP acknowledgement");
          }
          return response;
        },
        navigator: {
          locks: {
            request(
              name: string,
              options: LockOptions | (() => Promise<unknown>),
              callback?: () => Promise<unknown>,
            ) {
              const work = typeof options === "function" ? options : callback;
              assert.ok(work);
              const next = (locks.get(name) ?? Promise.resolve()).then(work);
              locks.set(
                name,
                next.catch(() => {}),
              );
              return next;
            },
          },
        },
        document: { hidden: true },
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        },
        addEventListener: events.addEventListener.bind(events),
      };
      for (const [name, value] of Object.entries(boundary))
        Object.defineProperty(globalThis, name, { configurable: true, value });
      const session = await createPlaySession({
        network: true,
        tutorial: false,
        signal: lifetime.signal,
      });
      const sounds: string[] = [];
      const dispatch = createActionDispatch(session, {
        play(id) {
          sounds.push(id);
          return true;
        },
      });
      const act = (op: "ready" | "continue") =>
        dispatch({ revision: session.state.revision, actions: [{ op }] });
      await session.act({
        revision: session.state.revision,
        actions: [{ op: "fate", slot: 0, tile: holder }],
      });
      await act("ready");
      await act("continue");
      const shopDeadline = performance.now() + 3000;
      while (
        session.state.phase.kind === "income" &&
        performance.now() < shopDeadline
      ) {
        await delay(25);
        await session.recover();
      }
      assert.equal(session.state.phase.kind, "prepare");
      assert.ok(
        session.state.balance[0] < 28 || session.state.balance[1] < 11,
        "real direct drops remain pending at Shop",
      );
      const cached = session.state.revision;
      const count = posted.length;
      walletPreflight = true;
      loseReply = true;
      sounds.length = 0;
      const reply = await act("ready");
      assert.equal(
        posted.length,
        count + 1,
        "wallet-only preflight must send the new Ready intent rather than reject it as stale: " +
          JSON.stringify(reply),
      );
      assert.ok(reply && typeof reply === "object" && "error" in reply);
      assert.equal(
        reply.error,
        "uncertain",
        "wallet advancement does not acknowledge this command",
      );
      assert.deepEqual(
        sounds,
        [],
        "an unacknowledged command produces no success cue",
      );
      const first = posted.at(-1)!;
      assert.ok(first.revision > cached);
      assert.equal(
        first.revision,
        preflightRevision,
        "only the new intent uses the trusted newer wallet revision",
      );
      assert.equal(session.connection?.pending?.status, "uncertain");
      if (delivery === "before-post") {
        assert.equal(
          (await read()).phase,
          "prepare",
          "the HTTP server never received Ready",
        );
        return;
      }
      await delay(550);
      await session.recover();
      assert.deepEqual(
        posted.at(-1),
        first,
        "uncertain retry preserves every original UUID/payload byte despite later wallet updates",
      );
      assert.equal(session.state.phase.kind, "result");
      assert.equal(session.connection?.pending, null);
      const staleCount = posted.length;
      const stale = await session.act({
        revision: cached,
        actions: [{ op: "continue" }],
      });
      assert.ok(
        stale &&
          typeof stale === "object" &&
          "error" in stale &&
          stale.error === "stale",
      );
      assert.equal(
        posted.length,
        staleCount,
        "an already-stale caller never sends a new command",
      );
      // Allow the real tail to finish so the distinct semantic control has no clock race.
      const settledDeadline = performance.now() + 7000;
      let current = await read();
      while (
        (current.balance[0] !== 28 || current.balance[1] !== 11) &&
        performance.now() < settledDeadline
      ) {
        await delay(25);
        current = await read();
      }
      assert.deepEqual(current.balance, [28, 11]);
      await session.recover();
      semanticPreflight = true;
      const semantic = await act("continue");
      assert.ok(
        semantic &&
          typeof semantic === "object" &&
          "error" in semantic &&
          semantic.error === "stale",
      );
      assert.equal(
        posted.length,
        staleCount,
        "a changed phase cannot be rebased into a second Continue",
      );
      assert.equal(session.state.phase.kind, "income");
      assert.equal(session.state.round, 3);
      assert.equal(values.size, 0);
    } finally {
      lifetime.abort();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      rmSync(directory, { recursive: true, force: true });
    }
  });
