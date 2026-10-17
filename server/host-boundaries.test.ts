import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { gameServer } from "./http.ts";

async function host(t: TestContext, trusted: boolean) {
  const base = join(homedir(), ".cache/task-tmp");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "greece-host-boundary-"));
  const server = gameServer({
    database: join(directory, "game.sqlite"),
    allowedOrigin: [
      "https://hieu-lee.github.io",
      "https://greece.example:18443",
    ],
    trustLoopbackProxy: trusted,
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("Pages and machine origins are both exact allowed clients; arbitrary origins stay rejected", async (t) => {
  const url = await host(t, true);
  for (const origin of [
    "https://hieu-lee.github.io",
    "https://greece.example:18443",
  ]) {
    const response = await fetch(url + "/api/health", {
      headers: { Origin: origin },
    });
    assert.equal(response.status, 200, origin);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
  const forbidden = await fetch(url + "/api/health", {
    headers: { Origin: "https://greece.example.evil:18443" },
  });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("access-control-allow-origin"), null);
});

test("opt-in loopback proxy uses its dedicated client IP while direct clients cannot spoof throttles", async (t) => {
  for (const trusted of [true, false]) {
    const url = await host(t, trusted);
    const attempt = (peer: string, forwarded = "") =>
      fetch(url + "/api/account/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Greece-Client-IP": peer,
          "X-Forwarded-For": forwarded,
        },
        body: "{}",
      });
    for (let i = 0; i < 20; i++) {
      const response = await attempt("192.0.2.1");
      assert.equal(response.status, 400);
      await response.arrayBuffer();
    }
    const blocked = await attempt("192.0.2.1");
    assert.equal(blocked.status, 429);
    await blocked.arrayBuffer();
    const other = await attempt("192.0.2.2");
    assert.equal(
      other.status,
      trusted ? 400 : 429,
      "only an explicitly trusted proxy can separate actual remote peers",
    );
    await other.arrayBuffer();
    const spoofed = await attempt(
      trusted ? "192.0.2.1" : "192.0.2.99",
      "198.51.100.1",
    );
    assert.equal(
      spoofed.status,
      429,
      "forwarded headers cannot escape the actual peer bucket",
    );
    await spoofed.arrayBuffer();
  }
});
