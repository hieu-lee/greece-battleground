import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gameServer } from "../server/http.ts";
import { createPlaySession } from "./play-session.ts";
import { publicGame } from "./read-model.ts";

const realTimeout = setTimeout;
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => realTimeout(resolve, milliseconds));

test("visible async polling displays real Income completion within one poll, stays serial, and stops in background/after abort", async () => {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "async-income-refresh-"));
  const server = gameServer({ database: join(directory, "game.sqlite") });
  const lifetime = new AbortController();
  const nativeFetch = fetch;
  const globals = [
    "fetch",
    "navigator",
    "document",
    "localStorage",
    "addEventListener",
  ];
  const originals = globals.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  let release: (() => void) | undefined;
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const registration = await nativeFetch(origin + "/api/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        name: "Async refresh private guest",
        clan: "raven",
      }),
    });
    assert.equal(registration.status, 200);
    const cookie = registration.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const storage = new Map<string, string>();
    const locks = new Map<string, Promise<unknown>>();
    const visibility = { hidden: false };
    const events = new EventTarget();
    let reads = 0;
    let activeReads = 0;
    let maxActiveReads = 0;
    let hold = false;
    const boundary = {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), origin);
        const reading = url.pathname === "/api/game";
        if (reading) {
          reads++;
          activeReads++;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
        }
        try {
          const response = await nativeFetch(url, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              Cookie: cookie,
            },
          });
          if (reading && hold)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return response;
        } finally {
          if (reading) activeReads--;
        }
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
      document: visibility,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
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
    assert.deepEqual(
      [session.state.phase.kind, session.state.balance],
      ["prepare", [11, 4]],
    );
    await session.act({
      revision: session.state.revision,
      actions: [{ op: "ready" }],
    });
    assert.equal(session.state.battle?.kind, "pve");
    await session.act({
      revision: session.state.revision,
      actions: [{ op: "continue" }],
    });
    assert.deepEqual(
      [session.state.phase.kind, session.state.balance],
      ["income", [22, 4]],
    );
    // Real authoritative timers complete both ordinary waits independently of the client refresh.
    const deadline = performance.now() + 3000;
    let authoritative = publicGame.parse(
      await (
        await nativeFetch(origin + "/api/game", { headers: { Cookie: cookie } })
      ).json(),
    );
    while (authoritative.phase === "income" && performance.now() < deadline) {
      await delay(40);
      authoritative = publicGame.parse(
        await (
          await nativeFetch(origin + "/api/game", {
            headers: { Cookie: cookie },
          })
        ).json(),
      );
    }
    assert.deepEqual(
      [authoritative.phase, authoritative.balance],
      ["prepare", [22, 8]],
    );
    const before = reads;
    const refreshed = performance.now() + 1500;
    while (
      session.state.phase.kind === "income" &&
      performance.now() < refreshed
    )
      await delay(5);
    assert.deepEqual(
      [session.state.phase.kind, session.state.balance],
      ["prepare", [22, 8]],
      "visible polling must display completed Income within 1.5s of authoritative completion",
    );
    assert.ok(
      reads <= before + 1,
      "at most one additional refresh displays the completed state",
    );
    while (session.connection?.busy) await delay(5);
    hold = true;
    const holdDeadline = performance.now() + 2000;
    while (!release && performance.now() < holdDeadline) await delay(5);
    assert.ok(release, "the visible Shop continues polling after Income");
    const heldReads = reads;
    await delay(1200);
    assert.equal(
      reads,
      heldReads,
      "an unfinished poll never creates another poll",
    );
    visibility.hidden = true;
    hold = false;
    release();
    while (session.connection?.busy) await delay(5);
    await delay(1200);
    assert.equal(reads, heldReads, "hidden pages make no refresh requests");
    visibility.hidden = false;
    const foregroundDeadline = performance.now() + 4500;
    while (
      (reads === heldReads || session.connection?.busy) &&
      performance.now() < foregroundDeadline
    )
      await delay(5);
    assert.equal(
      reads,
      heldReads + 1,
      "the retained background timer resumes refresh on its four-second cadence",
    );
    assert.equal(maxActiveReads, 1, "all transport refreshes remain serial");
    assert.equal(storage.size, 0, "completed actions leave no pending outbox");
    lifetime.abort();
    const stopped = reads;
    await delay(1200);
    assert.equal(reads, stopped, "abort retires the sole polling timer");
  } finally {
    release?.();
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
