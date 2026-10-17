import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gameServer } from "../server/http.ts";
import { GameStore } from "../server/store.ts";
import { inspection, newGame, parseGame } from "./game.ts";
import { publicMap } from "./map.ts";
import { createPlaySession } from "./play-session.ts";

for (const changed of ["map", "queue"] as const)
  test(`new Ready stays stale when preflight replaces its ${changed} despite identical PublicGame`, async () => {
    const base = join(homedir(), ".cache/task-tmp");
    mkdirSync(base, { recursive: true });
    const directory = mkdtempSync(join(base, "async-context-intent-"));
    const path = join(directory, "game.sqlite");
    const store = new GameStore(path);
    const owner = store.create({
      name: "Context intent private owner",
      clan: "raven",
    });
    store.close();
    const initial = newGame(42, "raven", "async", () => 0);
    const replacement = newGame(
      changed === "map" ? 77 : 42,
      "raven",
      "async",
      () => 0,
    );
    assert.deepEqual(inspection(replacement), inspection(initial));
    if (changed === "map")
      assert.notDeepEqual(
        publicMap(replacement.seed, replacement.owned),
        publicMap(initial.seed, initial.owned),
      );
    replacement.revision = 1;
    const author = (game: typeof initial, ranked: number) => {
      const database = new DatabaseSync(path);
      try {
        database
          .prepare(
            "UPDATE games SET run=?, revision=?, state=?, ranked=? WHERE guest=?",
          )
          .run(
            randomUUID(),
            game.revision,
            JSON.stringify(parseGame(game)),
            ranked,
            owner.guest.id,
          );
        database
          .prepare("DELETE FROM deltas WHERE guest=?")
          .run(owner.guest.id);
      } finally {
        database.close();
      }
    };
    author(initial, 0);
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
      const storage = new Map<string, string>();
      const locks = new Map<string, Promise<unknown>>();
      const events = new EventTarget();
      let replace = false;
      let posted = 0;
      const boundary = {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), origin);
          if (url.pathname === "/api/game" && replace) {
            replace = false;
            // Authored persisted replacement; the real HTTP owner supplies the view and action receipts.
            author(replacement, changed === "queue" ? 1 : 0);
          }
          if (url.pathname === "/api/game/act") posted++;
          return nativeFetch(url, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              Cookie: cookie,
            },
          });
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
      const map = session.map;
      assert.equal(session.connection?.queue, "unranked");
      replace = true;
      const reply = await session.act({
        revision: session.state.revision,
        actions: [{ op: "ready" }],
      });
      assert.equal(
        posted,
        0,
        `${changed} replacement must reject the old intent before any Ready POST`,
      );
      assert.deepEqual(reply, { r: 1, error: "stale" });
      assert.equal(session.state.phase.kind, "prepare");
      assert.equal(
        session.connection?.queue,
        changed === "queue" ? "ranked" : "unranked",
      );
      if (changed === "map") assert.notDeepEqual(session.map, map);
      else assert.deepEqual(session.map, map);
      assert.equal(storage.size, 0);
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
