import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { z } from "zod";
import { createActionDispatch } from "./action-dispatch.ts";
import { gameSession, newGame, transaction } from "./game.ts";
import { createPlaySession } from "./play-session.ts";
import { runKey } from "./run-storage.ts";
import type { createAudio } from "./audio.ts";

function browserBoundary(t: TestContext) {
  const names = [
    "localStorage",
    "navigator",
    "document",
    "addEventListener",
    "fetch",
  ];
  const originals = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] satisfies [
        string,
        PropertyDescriptor | undefined,
      ],
  );
  const lifetime = new AbortController();
  t.after(() => {
    lifetime.abort();
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const values = new Map<string, string>();
  const faults = { outboxRemoval: false };
  const queues = new Map<string, Promise<unknown>>();
  const events = new EventTarget();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem(name: string) {
        if (
          faults.outboxRemoval &&
          name.startsWith("greece-battleground.async.outbox.")
        )
          throw new DOMException("Outbox cleanup unavailable", "SecurityError");
        values.delete(name);
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      locks: {
        request(
          name: string,
          options: LockOptions | (() => Promise<unknown>),
          callback?: () => Promise<unknown>,
        ) {
          const work = typeof options === "function" ? options : callback;
          if (!work) throw new TypeError("Missing Web Lock callback");
          const current = (queues.get(name) ?? Promise.resolve()).then(work);
          queues.set(
            name,
            current.catch(() => {}),
          );
          return current;
        },
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  Object.defineProperty(globalThis, "addEventListener", {
    configurable: true,
    value: events.addEventListener.bind(events),
  });
  return { values, faults, signal: lifetime.signal };
}

const spearCamp = (context: { draw: "rarity" | "entry" | "delay" }) =>
  context.draw === "rarity" ? 0 : 8;

test("concurrent same-UUID receipts acknowledge one actual commit; later commits retain first-action feedback", async (t) => {
  const boundary = browserBoundary(t);
  const guest = {
    id: "a07daa9b-c354-4022-a2de-7c73b6a90a61",
    name: "Dispatch test",
  };
  let commits = 0;
  const server = gameSession(
    // Common rarity, entry 8 = Spear Camp.
    newGame(42, "stag", "async", spearCamp),
    () => commits++,
    () => {},
    {
      offerIndex: spearCamp,
      encounter: () => {
        throw new Error("This test submits preparation actions only");
      },
    },
  );
  const receipts = new Map<string, ReturnType<typeof server.act>>();
  const delivered: string[] = [];
  const intent = transaction
    .extend({ requestId: z.uuid(), guestId: z.uuid() })
    .strict();
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        "http://fixture",
      );
      if (url.pathname === "/api/guest") return Response.json({ guest });
      if (url.pathname === "/api/game")
        return Response.json(
          server.inspect(
            url.searchParams.has("since")
              ? Number(url.searchParams.get("since"))
              : undefined,
          ),
        );
      assert.equal(url.pathname, "/api/game/act");
      const payload = intent.parse(JSON.parse(String(init?.body)));
      assert.equal(payload.guestId, guest.id);
      delivered.push(payload.requestId);
      let reply = receipts.get(payload.requestId);
      if (!reply) {
        try {
          reply = server.act({
            revision: payload.revision,
            actions: payload.actions,
          });
        } catch (error) {
          return Response.json(
            {
              r: server.state.revision,
              error: "rejected",
              message: String(error),
            },
            { status: 422 },
          );
        }
        receipts.set(payload.requestId, reply);
      }
      return Response.json(reply);
    },
  });
  const game = await createPlaySession({
    network: true,
    tutorial: false,
    signal: boundary.signal,
  });
  const heard: Parameters<ReturnType<typeof createAudio>["play"]>[0][] = [];
  const dispatch = createActionDispatch(game, {
    play(id) {
      heard.push(id);
      return true;
    },
  });
  boundary.faults.outboxRemoval = true;
  const input = { revision: 0, actions: [{ op: "villager" }] };
  const replies = await Promise.all([dispatch(input), dispatch(input)]);
  assert.deepEqual(replies, [
    { r: 1, error: "committed", message: "Outbox cleanup unavailable" },
    { r: 1, error: "committed", message: "Outbox cleanup unavailable" },
  ]);
  assert.equal(commits, 1);
  assert.equal(game.state.revision, 1);
  assert.equal(server.state.workers, 1);
  assert.equal(delivered.length, 2);
  assert.equal(
    new Set(delivered).size,
    1,
    "Both calls retry the actual same persisted UUID",
  );
  assert.deepEqual(
    heard,
    ["purchase"],
    "One committed revision emits one acknowledgement",
  );
  boundary.faults.outboxRemoval = false;
  await game.recover();
  assert.deepEqual(
    heard,
    ["purchase"],
    "Recovery does not repeat action feedback",
  );
  const batch = await dispatch({
    revision: 1,
    actions: [
      { op: "buy", slot: 0, tile: 30 },
      { op: "assign", tile: 30 },
    ],
  });
  assert.ok(
    batch &&
      typeof batch === "object" &&
      "r" in batch &&
      batch.r === 2 &&
      !("error" in batch),
  );
  assert.equal(commits, 2);
  assert.equal(server.state.placements.find((p) => p.tile === 30)?.workers, 2);
  assert.deepEqual(
    heard,
    ["purchase", "build", "buy-spear-camp"],
    "Only the first committed batch action acknowledges; WorkerAssign stays silent",
  );
  const before = game.inspect();
  for (const request of [
    { revision: 0, actions: [{ op: "villager" }] },
    { revision: 2, actions: [{ op: "buy", slot: 99, tile: 30 }] },
    { revision: 2, actions: [{ op: "villager" }] },
    {
      revision: 2,
      actions: [
        { op: "fate", slot: 0 },
        { op: "assign", tile: 37 },
      ],
    },
  ]) {
    const reply = await dispatch(request);
    assert.ok(reply && typeof reply === "object" && "error" in reply);
    assert.deepEqual(
      game.inspect(),
      before,
      "Rejected, stale and rolled-back actions preserve the actual session state",
    );
    assert.deepEqual(heard, ["purchase", "build", "buy-spear-camp"]);
    assert.equal(commits, 2);
  }
  await dispatch({ revision: 2, actions: [{ op: "reroll-shop" }] });
  assert.equal(game.state.revision, 3);
  assert.equal(commits, 3);
  assert.deepEqual(heard, ["purchase", "build", "buy-spear-camp", "reroll"]);
});

test("restart preserves revision ordering and a separate new session can acknowledge revision one", async (t) => {
  const boundary = browserBoundary(t);
  const finished = newGame();
  finished.revision = 9;
  finished.wins = 10;
  finished.phase = { kind: "finished", outcome: "victory" };
  boundary.values.set(runKey("practice"), JSON.stringify(finished));
  const game = await createPlaySession({
    network: false,
    tutorial: false,
    signal: boundary.signal,
  });
  const heard: Parameters<ReturnType<typeof createAudio>["play"]>[0][] = [];
  const audio = {
    play(id: Parameters<ReturnType<typeof createAudio>["play"]>[0]) {
      heard.push(id);
      return true;
    },
  };
  const dispatch = createActionDispatch(game, audio);
  await dispatch({ revision: 9, actions: [{ op: "restart", clan: "raven" }] });
  assert.equal(game.state.revision, 10);
  assert.equal(game.state.clan, "raven");
  await dispatch({ revision: 10, actions: [{ op: "villager" }] });
  assert.equal(game.state.revision, 11);
  assert.deepEqual(heard, ["select", "purchase"]);
  boundary.values.set(runKey("practice"), JSON.stringify(newGame()));
  const fresh = await createPlaySession({
    network: false,
    tutorial: false,
    signal: boundary.signal,
  });
  await createActionDispatch(
    fresh,
    audio,
  )({ revision: 0, actions: [{ op: "villager" }] });
  assert.equal(fresh.state.revision, 1);
  assert.deepEqual(heard, ["select", "purchase", "purchase"]);
});
