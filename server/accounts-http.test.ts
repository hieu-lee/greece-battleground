import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  chmodSync,
  statSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gameServer } from "./http.ts";
import { GameStore, actionRequest, schemaVersion } from "./store.ts";
import { rulesVersion } from "../src/rules-version.ts";

const password = () => randomBytes(24).toString("base64url");
const pagesOrigin = "https://private-fixture.github.io";
function directory() {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, "greece-account-http-"));
}
async function fixture() {
  const folder = directory(),
    path = join(folder, "game.sqlite");
  let server = gameServer({ database: path, allowedOrigin: pagesOrigin });
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
  async function request(
    route: string,
    body?: object,
    options: {
      cookie?: string;
      bearer?: string;
      origin?: string;
      method?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    const response = await fetch(origin + route, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.bearer
          ? { Authorization: "Bearer " + options.bearer }
          : {}),
        ...(options.origin ? { Origin: options.origin } : {}),
        ...options.headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.status === 204 ? null : await response.json(),
    };
  }
  return {
    path,
    request,
    async restart() {
      await stop();
      server = gameServer({ database: path, allowedOrigin: pagesOrigin });
      await start();
    },
    async close() {
      await stop();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
function rows(path: string, table: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all();
  } finally {
    db.close();
  }
}
function cookie(headers: Headers, name: string) {
  return (
    headers
      .getSetCookie()
      .find((value) => value.startsWith(name + "="))
      ?.split(";")[0] ?? ""
  );
}

test("signup claims the authenticated guest without changing progress/profile/UUID bytes and revokes old anonymous bypasses", async () => {
  const f = await fixture();
  try {
    const created = await f.request("/api/guest", {
      name: "Private claim fixture",
      clan: "raven",
    });
    assert.equal(created.status, 200);
    const guestId: string = created.body.guest.id,
      anonymous = cookie(created.headers, "greece_guest");
    const intent = {
      requestId: randomUUID(),
      guestId,
      revision: 0,
      actions: [{ op: "villager" }],
    };
    const committed = await f.request("/api/game/act", intent, {
      cookie: anonymous,
    });
    assert.equal(committed.status, 200);
    const recovery = await f.request(
      "/api/account/recovery",
      { guestId },
      { cookie: anonymous },
    );
    assert.equal(recovery.status, 200);
    const before = Object.fromEntries(
      ["games", "profiles", "receipts", "ghosts"].map((table) => [
        table,
        JSON.stringify(rows(f.path, table)),
      ]),
    );
    const secret = password();
    const signup = await f.request(
      "/api/account/signup",
      { username: "ClaimFixture", password: secret, guestId },
      { cookie: anonymous },
    );
    assert.equal(
      signup.status,
      200,
      "the real authenticated missing-route baseline is404",
    );
    assert.equal(signup.body.account.username, "claimfixture");
    assert.equal(signup.body.account.guest.id, guestId);
    assert.ok(
      typeof signup.body.session.token === "string" &&
        /^[a-f0-9]{64}$/.test(signup.body.session.token),
    );
    const token: string = signup.body.session.token,
      sessionCookie = cookie(signup.headers, "greece_session");
    assert.ok(
      sessionCookie.length > 0 &&
        signup.headers
          .getSetCookie()
          .some(
            (value) =>
              value.startsWith("greece_session=") &&
              /HttpOnly/.test(value) &&
              /SameSite=Strict/.test(value),
          ),
    );
    for (const [table, encoded] of Object.entries(before))
      assert.ok(
        JSON.stringify(rows(f.path, table)) === encoded,
        table + " bytes are preserved by claim",
      );
    assert.equal(
      (await f.request("/api/guest", undefined, { cookie: anonymous })).status,
      401,
    );
    assert.equal(
      (
        await f.request("/api/account/recover", {
          secret: recovery.body.secret,
        })
      ).status,
      401,
    );
    assert.equal(
      (await f.request("/api/account/recovery", { guestId }, { bearer: token }))
        .status,
      403,
    );
    const session = await f.request("/api/account/session", undefined, {
      bearer: token,
    });
    assert.equal(session.status, 200);
    assert.equal(session.body.account.guest.id, guestId);
    assert.equal(Object.hasOwn(session.body, "token"), false);
    assert.equal(
      (await f.request("/api/guest", undefined, { cookie: sessionCookie })).body
        .guest.id,
      guestId,
    );
    const retry = await f.request("/api/game/act", intent, { bearer: token });
    assert.equal(retry.status, 200);
    assert.ok(
      JSON.stringify(retry.body) === JSON.stringify(committed.body),
      "claim keeps the exact old command receipt",
    );
    const publicState = await f.request("/api/game?own=1&map=1", undefined, {
      bearer: token,
    });
    assert.equal(publicState.status, 200);
    assert.ok(
      !JSON.stringify(publicState.body).includes(secret) &&
        !JSON.stringify(publicState.body).includes(token),
    );
    assert.equal(Object.hasOwn(publicState.body, "account"), false);
    await f.restart();
    assert.equal(
      (await f.request("/api/account/session", undefined, { bearer: token }))
        .status,
      200,
    );
    const persistedRetry = await f.request("/api/game/act", intent, {
      bearer: token,
    });
    assert.ok(
      JSON.stringify(persistedRetry.body) === JSON.stringify(committed.body),
      "UUID receipt survives account service restart",
    );
    assert.equal(
      (await f.request("/api/account/logout", {}, { bearer: token })).status,
      200,
    );
    assert.equal(
      (await f.request("/api/game", undefined, { bearer: token })).status,
      401,
    );
    const relogin = await f.request("/api/account/login", {
      username: "CLAIMFIXTURE",
      password: secret,
    });
    assert.equal(relogin.status, 200);
    assert.equal(relogin.body.account.guest.id, guestId);
    assert.ok(relogin.body.session.token !== token);
  } finally {
    await f.close();
  }
});

test("new accounts enforce canonical username uniqueness, generic login failures, strict small schemas and authenticated claim authority", async () => {
  const f = await fixture();
  try {
    const secret = password();
    const signup = await f.request("/api/account/signup", {
      username: "Canonical_User",
      password: secret,
      guest: { name: "Canonical fixture", clan: "raven" },
    });
    assert.equal(signup.status, 200);
    const count = rows(f.path, "guests").length;
    const duplicate = await f.request("/api/account/signup", {
      username: "canonical_user",
      password: password(),
      guest: { name: "Duplicate fixture", clan: "stag" },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(
      rows(f.path, "guests").length,
      count,
      "a duplicate does not orphan a new guest",
    );
    const bad = await f.request("/api/account/login", {
      username: "CANONICAL_USER",
      password: password(),
    });
    const absent = await f.request("/api/account/login", {
      username: "absent_user",
      password: password(),
    });
    assert.equal(bad.status, 401);
    assert.equal(absent.status, 401);
    assert.ok(
      JSON.stringify(bad.body) === JSON.stringify(absent.body),
      "unknown and wrong-password replies are generic",
    );
    assert.equal(
      (
        await f.request("/api/account/login", {
          username: "canonical_user",
          password: "x".repeat(129),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/api/account/login", {
          username: "canonical_user",
          password: secret,
          guestId: randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request("/api/account/signup", {
          username: "bad:name",
          password: secret,
          guest: { name: "Invalid fixture", clan: "raven" },
        })
      ).status,
      400,
    );
    const anonymous = await f.request("/api/guest", {
      name: "Authority fixture",
      clan: "raven",
    });
    const guestCookie = cookie(anonymous.headers, "greece_guest");
    assert.equal(
      (
        await f.request(
          "/api/account/signup",
          {
            username: "stolen_guest",
            password: secret,
            guestId: signup.body.account.guest.id,
          },
          { cookie: guestCookie },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request("/api/account/signup", {
          username: "no_authority",
          password: secret,
          guestId: anonymous.body.guest.id,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.request(
          "/api/account/signup",
          {
            username: "new_wrong_polis",
            password: secret,
            guest: { name: "Wrong new fixture", clan: "raven" },
          },
          { cookie: guestCookie },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request(
          "/api/account/signup",
          {
            username: "second_binding",
            password: secret,
            guestId: signup.body.account.guest.id,
          },
          { bearer: signup.body.session.token },
        )
      ).status,
      409,
    );
    const login = await f.request("/api/account/login", {
      username: "CANONICAL_USER",
      password: secret,
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.account.username, "canonical_user");
  } finally {
    await f.close();
  }
});

test("independent opaque device sessions persist, logout revokes only its session and expired bearers cannot fall back to cookies", async () => {
  const f = await fixture();
  try {
    const secret = password();
    const a = await f.request("/api/account/signup", {
      username: "devices_user",
      password: secret,
      guest: { name: "Devices fixture", clan: "stag" },
    });
    assert.equal(a.status, 200);
    const b = await f.request("/api/account/login", {
      username: "devices_user",
      password: secret,
    });
    assert.equal(b.status, 200);
    assert.ok(a.body.session.token !== b.body.session.token);
    const sessions = rows(f.path, "account_sessions");
    assert.equal(sessions.length, 2);
    assert.ok(
      !JSON.stringify(sessions).includes(a.body.session.token) &&
        !JSON.stringify(sessions).includes(b.body.session.token),
      "only session hashes are stored",
    );
    const accounts = rows(f.path, "accounts");
    assert.ok(
      !JSON.stringify(accounts).includes(secret),
      "the password itself is never stored",
    );
    assert.equal(
      (
        await f.request(
          "/api/account/logout",
          {},
          { bearer: a.body.session.token },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          "/api/account/logout",
          {},
          { bearer: a.body.session.token },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request("/api/account/session", undefined, {
          bearer: a.body.session.token,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.request("/api/account/session", undefined, {
          bearer: b.body.session.token,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request("/api/game", undefined, {
          bearer: randomBytes(32).toString("hex"),
          cookie: cookie(b.headers, "greece_session"),
        })
      ).status,
      401,
    );
    await f.restart();
    assert.equal(
      (
        await f.request("/api/account/session", undefined, {
          bearer: b.body.session.token,
        })
      ).status,
      200,
    );
    const db = new DatabaseSync(f.path);
    db.prepare("UPDATE account_sessions SET expires_at=?").run(Date.now() - 1);
    db.close();
    assert.equal(
      (
        await f.request("/api/account/session", undefined, {
          bearer: b.body.session.token,
        })
      ).status,
      401,
    );
  } finally {
    await f.close();
  }
});

test("allowed Pages origins use Authorization preflight while disallowed origins and guest mismatches remain blocked", async () => {
  const f = await fixture();
  try {
    const allowed = await f.request("/api/account/signup", undefined, {
      method: "OPTIONS",
      origin: pagesOrigin,
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("Access-Control-Allow-Origin"),
      pagesOrigin,
    );
    assert.ok(
      allowed.headers
        .get("Access-Control-Allow-Headers")
        ?.toLowerCase()
        .includes("authorization"),
    );
    const forbidden = await f.request("/api/account/login", undefined, {
      method: "OPTIONS",
      origin: "https://disallowed.invalid",
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.has("Access-Control-Allow-Origin"), false);
    const signup = await f.request(
      "/api/account/signup",
      {
        username: "pages_user",
        password: password(),
        guest: { name: "Pages fixture", clan: "raven" },
      },
      { origin: pagesOrigin },
    );
    assert.equal(signup.status, 200);
    const options = { bearer: signup.body.session.token, origin: pagesOrigin };
    assert.equal(
      (await f.request("/api/game", undefined, options)).status,
      200,
    );
    assert.equal(
      (await f.request("/api/game?guestId=" + randomUUID(), undefined, options))
        .status,
      409,
    );
    assert.equal(
      (
        await f.request("/api/game", undefined, {
          ...options,
          origin: "https://disallowed.invalid",
        })
      ).status,
      403,
    );
  } finally {
    await f.close();
  }
});

test("authentication attempts and simultaneous memory-hard password work are bounded without a work queue", async () => {
  const limited = await fixture();
  try {
    for (let n = 0; n < 20; n++)
      assert.equal(
        (await limited.request("/api/account/login", {})).status,
        400,
      );
    const blocked = await limited.request("/api/account/login", {});
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
  } finally {
    await limited.close();
  }
  const busy = await fixture();
  try {
    const replies = await Promise.all(
      [0, 1, 2].map((n) =>
        busy.request("/api/account/signup", {
          username: "parallel_user_" + n,
          password: password(),
          guest: { name: "Parallel fixture " + n, clan: "raven" },
        }),
      ),
    );
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 200, 503]);
    assert.equal(rows(busy.path, "accounts").length, 2);
    assert.equal((await busy.request("/api/health")).status, 200);
  } finally {
    await busy.close();
  }
});

test("source12 needs explicit non-overwriting same-rules migration to14 with exact original bytes and old rows preserved", () => {
  const folder = directory(),
    source = join(folder, "source12.sqlite"),
    destination = join(folder, "destination14.sqlite");
  try {
    let owner = new GameStore(source);
    const created = owner.create({ name: "Migration fixture", clan: "raven" });
    const request = actionRequest.parse({
      requestId: randomUUID(),
      revision: 0,
      actions: [{ op: "villager" }],
    });
    owner.act(created.guest.id, request);
    owner.close();
    const producer = new DatabaseSync(source);
    producer.exec(
      "DROP TABLE IF EXISTS ghost_matchmaking; DROP TABLE IF EXISTS match_history; DROP TABLE IF EXISTS account_sessions; DROP TABLE IF EXISTS accounts; PRAGMA user_version=12",
    );
    producer
      .prepare("UPDATE profiles SET xp=123 WHERE guest=?")
      .run(created.guest.id);
    producer.close();
    const before = readFileSync(source);
    const tables = [
      "guests",
      "games",
      "profiles",
      "receipts",
      "ghosts",
      "deltas",
      "account_recovery",
      "rules_metadata",
    ];
    const oldRows = Object.fromEntries(
      tables.map((table) => [table, JSON.stringify(rows(source, table))]),
    );
    const unexpected: { store?: GameStore } = {};
    try {
      assert.throws(() => {
        unexpected.store = new GameStore(source);
      }, /migration/i);
    } finally {
      unexpected.store?.close();
    }
    assert.ok(
      readFileSync(source).equals(before),
      "ordinary startup never silently upgrades source12",
    );
    chmodSync(source, 0o400);
    const migration = fileURLToPath(
      new URL("./migrate-accounts.ts", import.meta.url),
    );
    const execute = (from: string, to: string) =>
      spawnSync(
        process.execPath,
        [migration, "--source", from, "--destination", to],
        { encoding: "utf8" },
      );
    assert.equal(
      execute(source, destination).status,
      0,
      "explicit CLI copies source12 into a new schema14 destination",
    );
    assert.ok(readFileSync(source).equals(before));
    assert.equal(statSync(source).mode & 0o777, 0o400);
    for (const [table, encoded] of Object.entries(oldRows))
      assert.ok(
        JSON.stringify(rows(destination, table)) === encoded,
        table + " rows remain exact",
      );
    const copied = new DatabaseSync(destination, { readOnly: true });
    assert.equal(copied.prepare("PRAGMA user_version").get()?.user_version, 14);
    assert.equal(
      copied.prepare("SELECT value FROM rules_metadata WHERE id=1").get()
        ?.value,
      rulesVersion,
    );
    copied.close();
    const targetBytes = readFileSync(destination);
    assert.notEqual(execute(source, destination).status, 0);
    assert.ok(
      readFileSync(destination).equals(targetBytes),
      "a repeated migration cannot overwrite an existing destination",
    );
    owner = new GameStore(destination);
    assert.ok(owner.authenticate(created.token)?.id === created.guest.id);
    owner.close();
    const wrong = join(folder, "wrong-rules.sqlite"),
      wrongDb = new DatabaseSync(wrong);
    wrongDb.exec(
      "CREATE TABLE rules_metadata(id INTEGER PRIMARY KEY,value TEXT); PRAGMA user_version=12",
    );
    wrongDb
      .prepare("INSERT INTO rules_metadata VALUES(1,?)")
      .run("different-rules");
    wrongDb.close();
    const refused = join(folder, "refused.sqlite");
    assert.notEqual(execute(wrong, refused).status, 0);
    assert.equal(existsSync(refused), false);
    assert.equal(schemaVersion, 14);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
