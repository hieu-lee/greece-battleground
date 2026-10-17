import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { request as httpRequest } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { gameServer } from "./http.ts";
import { accountAuthorization } from "../src/accounts.ts";

async function fixture(t: TestContext) {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-revocation-"));
  const path = join(directory, "game.sqlite");
  const server = gameServer({ database: path });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  async function post(
    route: string,
    body: object,
    headers: Record<string, string> = {},
  ) {
    return fetch(origin + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }
  function protectedRows() {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      return Object.fromEntries(
        ["games", "profiles", "ghosts", "receipts", "deltas"].map((table) => [
          table,
          database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
    } finally {
      database.close();
    }
  }
  async function partial(
    route: string,
    body: object,
    headers: Record<string, string>,
  ) {
    const encoded = JSON.stringify(body);
    let dispatched!: () => void;
    const boundary = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    // Registered after the real handler: it reaches its asynchronous body wait first.
    server.once("request", dispatched);
    let complete!: (value: { status: number; body: unknown }) => void;
    let fail!: (reason: Error) => void;
    const result = new Promise<{ status: number; body: unknown }>(
      (resolve, reject) => {
        complete = resolve;
        fail = reject;
      },
    );
    const request = httpRequest(
      origin + route,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(encoded),
          ...headers,
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () =>
          complete({ status: response.statusCode ?? 0, body: JSON.parse(raw) }),
        );
      },
    );
    request.on("error", fail);
    t.after(() => request.destroy());
    request.write(encoded.slice(0, 1));
    await boundary;
    return {
      finish() {
        request.end(encoded.slice(1));
        return result;
      },
    };
  }
  return { post, partial, protectedRows };
}

for (const revoke of ["claim", "logout"] as const) {
  for (const route of [
    "/api/game/act",
    "/api/game/queue",
    "/api/game/cancel",
    "/api/guest",
  ]) {
    test(`${route} rechecks ${revoke === "claim" ? "claimed anonymous token" : "logged-out session"} after a delayed request body`, async (t) => {
      const f = await fixture(t);
      const username = "race_" + randomUUID().replaceAll("-", "").slice(0, 20);
      const password = randomBytes(24).toString("base64url");
      const guest = await f.post("/api/guest", {
        name: "Private revocation fixture",
        clan: "stag",
      });
      assert.equal(guest.status, 200);
      const created = await guest.json();
      const anonymous = guest.headers
        .getSetCookie()
        .find((value) => value.startsWith("greece_guest="))
        ?.split(";")[0];
      assert.ok(anonymous);
      const guestId: string = created.guest.id;
      let headers: Record<string, string> = { Cookie: anonymous };
      if (revoke === "logout") {
        const signup = await f.post(
          "/api/account/signup",
          { username, password, guestId },
          headers,
        );
        assert.equal(signup.status, 200);
        const account = accountAuthorization.parse(await signup.json());
        headers = { Authorization: "Bearer " + account.session.token };
      }
      const requestId = randomUUID();
      const body =
        route === "/api/game/act"
          ? { requestId, guestId, revision: 0, actions: [{ op: "villager" }] }
          : route === "/api/game/queue"
            ? {
                requestId,
                guestId,
                revision: 0,
                queue: "ranked",
                clan: "raven",
              }
            : route === "/api/game/cancel"
              ? { requestId, guestId }
              : { name: "Stale owner", clan: "raven" };
      const pending = await f.partial(route, body, headers);
      if (revoke === "claim") {
        const signup = await f.post(
          "/api/account/signup",
          { username, password, guestId },
          headers,
        );
        assert.equal(signup.status, 200);
        accountAuthorization.parse(await signup.json());
      } else {
        const logout = await f.post("/api/account/logout", {}, headers);
        assert.equal(logout.status, 200);
        assert.deepEqual(await logout.json(), { loggedOut: true });
      }
      const before = f.protectedRows();
      const result = await pending.finish();
      assert.equal(
        result.status,
        401,
        "revoked authority cannot finish a previously opened protected POST",
      );
      assert.deepEqual(result.body, { error: "unauthorized" });
      assert.deepEqual(
        f.protectedRows(),
        before,
        "no game/profile/ghost/receipt/delta writes after revocation",
      );
    });
  }
}
