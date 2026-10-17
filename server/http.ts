import { createServer } from "node:http";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { staticFiles } from "./static.ts";
import { AccountError, sessionLifetimeMs } from "./accounts.ts";
import { accountSignup, accountLogin, accountLogout } from "../src/accounts.ts";
import {
  GameStore,
  actionRequest,
  guestRequest,
  queueRequest,
} from "./store.ts";

class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const querySchema = z
  .object({
    since: z.coerce.number().int().nonnegative().optional(),
    map: z.literal("1").optional(),
    match: z.literal("1").optional(),
    own: z.literal("1").optional(),
    guestId: z.uuid().optional(),
  })
  .strict();
async function readBody(request: IncomingMessage): Promise<unknown> {
  if (
    request.headers["content-type"]?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new RequestError(415, "content-type");
  let size = 0;
  const chunks: Buffer[] = [];
  if (Number(request.headers["content-length"]) > 16_384)
    throw new RequestError(413, "too-large");
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 16_384) {
      request.resume();
      throw new RequestError(413, "too-large");
    }
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError(400, "invalid");
  }
}
function credential(
  request: IncomingMessage,
): { kind: "session" | "guest"; token: string } | null {
  const authorization = request.headers.authorization;
  if (authorization !== undefined) {
    const matched = /^Bearer ([a-f0-9]{64})$/i.exec(authorization);
    return matched?.[1] ? { kind: "session", token: matched[1] } : null;
  }
  const cookies =
    request.headers.cookie?.split(";").map((value) => value.trim()) ?? [];
  for (const [name, kind] of [
    ["greece_session=", "session"],
    ["greece_guest=", "guest"],
  ] as const) {
    const found = cookies.find((value) => value.startsWith(name));
    if (!found) continue;
    const token = found.slice(name.length);
    return /^[a-f0-9]{64}$/.test(token) ? { kind, token } : null;
  }
  return null;
}

export function gameServer(options: {
  database: string;
  assets?: string;
  allowedOrigin?: string | readonly string[];
  trustLoopbackProxy?: boolean;
  secureCookie?: boolean;
}) {
  const serveAssets = options.assets ? staticFiles(options.assets) : null;
  const store = new GameStore(options.database);
  const allowedOrigins = new Set(
    typeof options.allowedOrigin === "string"
      ? [options.allowedOrigin]
      : options.allowedOrigin,
  );
  function requestPeer(request: IncomingMessage) {
    const peer = request.socket.remoteAddress ?? "unknown";
    const forwarded = request.headers["x-greece-client-ip"];
    return options.trustLoopbackProxy &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) &&
      typeof forwarded === "string" &&
      isIP(forwarded)
      ? forwarded
      : peer;
  }
  const attempts = new Map<string, { count: number; until: number }>();
  function allowAttempt(kind: "recover" | "register" | "auth", peer: string) {
    const now = Date.now();
    for (const [key, entry] of attempts)
      if (entry.until <= now) attempts.delete(key);
    const key = kind + ":" + peer;
    const entry = attempts.get(key);
    const limit = kind === "recover" ? 10 : kind === "auth" ? 20 : 120;
    if (entry) {
      if (entry.count >= limit) return false;
      entry.count++;
    } else {
      if (attempts.size >= 1024) return false;
      attempts.set(key, {
        count: 1,
        until: now + (kind === "register" ? 60_000 : 900_000),
      });
    }
    return true;
  }
  const cookie = (token: string) =>
    `greece_guest=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=31536000${options.secureCookie ? "; Secure" : ""}`;
  const sessionCookie = (token: string) =>
    `greece_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${token ? sessionLifetimeMs / 1000 : 0}${options.secureCookie ? "; Secure" : ""}`;
  const clearGuestCookie = `greece_guest=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${options.secureCookie ? "; Secure" : ""}`;
  const server = createServer(
    { maxHeaderSize: 16_384, requestTimeout: 5_000, headersTimeout: 5_000 },
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      let status = 200,
        result: object;
      try {
        const origin = request.headers.origin;
        const address = server.address();
        const ownOrigins =
          address &&
          typeof address !== "string" &&
          ["127.0.0.1", "::1"].includes(address.address)
            ? [
                `http://127.0.0.1:${address.port}`,
                `http://localhost:${address.port}`,
                `http://[::1]:${address.port}`,
              ]
            : [];
        if (
          origin &&
          !allowedOrigins.has(origin) &&
          !ownOrigins.includes(origin)
        )
          throw new RequestError(403, "origin");
        if (!origin && request.headers["sec-fetch-site"] === "cross-site")
          throw new RequestError(403, "origin");
        if (origin) {
          response.setHeader("Access-Control-Allow-Origin", origin);
          response.setHeader("Access-Control-Allow-Credentials", "true");
          response.setHeader("Vary", "Origin");
        }
        if (request.method === "OPTIONS") {
          response.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,OPTIONS",
          );
          response.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization",
          );
          response.writeHead(204);
          response.end();
          return;
        }
        const url = new URL(request.url ?? "/", "http://service.invalid");
        if (
          serveAssets &&
          url.pathname !== "/api" &&
          !url.pathname.startsWith("/api/")
        ) {
          await serveAssets(request, response, url);
          return;
        }
        if (url.pathname === "/api/health" && request.method === "GET")
          result = { ok: true, mode: "async", ranked: true };
        else {
          const auth = credential(request);
          const token = auth?.token;
          const session =
            auth?.kind === "session" ? store.accountSession(auth.token) : null;
          const guest =
            session?.account.guest ??
            (auth?.kind === "guest" ? store.authenticate(auth.token) : null);
          function requireCurrentGuest() {
            const current =
              auth?.kind === "session"
                ? store.accountSession(auth.token)?.account.guest
                : auth?.kind === "guest"
                  ? store.authenticate(auth.token)
                  : null;
            if (!current || current.id !== guest?.id)
              throw new RequestError(401, "unauthorized");
            return current;
          }
          if (
            (url.pathname === "/api/account/signup" ||
              url.pathname === "/api/account/login") &&
            request.method === "POST"
          ) {
            if (url.search) throw new RequestError(400, "invalid");
            if (!allowAttempt("auth", requestPeer(request))) {
              response.setHeader("Retry-After", "900");
              throw new RequestError(429, "rate-limited");
            }
            const body = await readBody(request);
            let authorization;
            if (url.pathname === "/api/account/signup") {
              const parsed = accountSignup.safeParse(body);
              if (!parsed.success) throw new RequestError(400, "invalid");
              authorization = await store.signupAccount(
                parsed.data,
                guest && token ? { id: requireCurrentGuest().id, token } : null,
              );
            } else {
              const parsed = accountLogin.safeParse(body);
              if (!parsed.success) throw new RequestError(400, "invalid");
              authorization = await store.loginAccount(parsed.data);
            }
            response.setHeader("Set-Cookie", [
              sessionCookie(authorization.session.token),
              clearGuestCookie,
            ]);
            result = authorization;
          } else if (
            url.pathname === "/api/account/session" &&
            request.method === "GET"
          ) {
            if (url.search) throw new RequestError(400, "invalid");
            if (!session) throw new RequestError(401, "unauthorized");
            result = session;
          } else if (
            url.pathname === "/api/account/logout" &&
            request.method === "POST"
          ) {
            if (
              url.search ||
              !accountLogout.safeParse(await readBody(request)).success
            )
              throw new RequestError(400, "invalid");
            if (auth?.kind === "session") store.logoutAccount(auth.token);
            response.setHeader("Set-Cookie", sessionCookie(""));
            result = { loggedOut: true };
          } else if (
            url.pathname === "/api/account/recover" &&
            request.method === "POST"
          ) {
            if (url.search) throw new RequestError(400, "invalid");
            if (!allowAttempt("recover", requestPeer(request))) {
              response.setHeader("Retry-After", "900");
              throw new RequestError(429, "rate-limited");
            }
            const parsed = z
              .object({ secret: z.string().regex(/^[a-f0-9]{64}$/) })
              .strict()
              .safeParse(await readBody(request));
            if (!parsed.success) throw new RequestError(400, "invalid");
            const recovered = store.recover(parsed.data.secret);
            if (!recovered) throw new RequestError(401, "invalid-recovery");
            response.setHeader("Set-Cookie", cookie(recovered.token));
            result = { guest: recovered.guest };
          } else if (
            url.pathname === "/api/account/recovery" &&
            request.method === "POST"
          ) {
            if (!guest || !token) throw new RequestError(401, "unauthorized");
            if (url.search) throw new RequestError(400, "invalid");
            const parsed = z
              .object({ guestId: z.uuid() })
              .strict()
              .safeParse(await readBody(request));
            if (!parsed.success) throw new RequestError(400, "invalid");
            if (parsed.data.guestId !== guest.id)
              throw new RequestError(409, "guest-changed");
            requireCurrentGuest();
            result = store.issueRecovery(guest.id);
          } else if (
            url.pathname === "/api/leaderboard" &&
            request.method === "GET"
          ) {
            // Public; a valid guest cookie only marks that guest's own row.
            const parsed = z
              .object({
                page: z.coerce.number().int().min(1).max(100_000).default(1),
              })
              .strict()
              .safeParse(Object.fromEntries(url.searchParams));
            if (!parsed.success) throw new RequestError(400, "invalid");
            result = store.leaderboard(parsed.data.page, guest?.id ?? null);
          } else if (
            url.pathname === "/api/profile" &&
            request.method === "GET"
          ) {
            // A browser without a guest gets an empty profile, not an error.
            if (url.search) throw new RequestError(400, "invalid");
            result = { profile: guest ? store.profile(guest.id) : null };
          } else if (
            url.pathname === "/api/guest" &&
            request.method === "POST"
          ) {
            if (!guest && !allowAttempt("register", requestPeer(request))) {
              response.setHeader("Retry-After", "60");
              throw new RequestError(429, "rate-limited");
            }
            const parsed = guestRequest.safeParse(await readBody(request));
            if (!parsed.success) throw new RequestError(400, "invalid");
            if (guest) {
              requireCurrentGuest();
              result = { guest, state: store.inspect(guest.id) };
            } else {
              const created = store.create(parsed.data);
              response.setHeader("Set-Cookie", cookie(created.token));
              result = { guest: created.guest, state: created.state };
            }
          } else {
            if (!guest) throw new RequestError(401, "unauthorized");
            if (url.pathname === "/api/guest" && request.method === "GET")
              result = { guest };
            else if (
              url.pathname === "/api/game/queue" &&
              request.method === "POST"
            ) {
              const parsed = queueRequest.safeParse(await readBody(request));
              if (!parsed.success) throw new RequestError(400, "invalid");
              requireCurrentGuest();
              if (parsed.data.guestId && parsed.data.guestId !== guest.id)
                throw new RequestError(409, "guest-changed");
              const reply = store.enter(guest.id, parsed.data);
              status = reply.status;
              result = reply.body;
            } else if (
              url.pathname === "/api/game" &&
              request.method === "GET"
            ) {
              const parsed = querySchema.safeParse(
                Object.fromEntries(url.searchParams),
              );
              if (!parsed.success) throw new RequestError(400, "invalid");
              if (parsed.data.guestId && parsed.data.guestId !== guest.id)
                throw new RequestError(409, "guest-changed");
              result = store.inspect(guest.id, {
                ...(parsed.data.since === undefined
                  ? {}
                  : { since: parsed.data.since }),
                map: parsed.data.map === "1",
                match: parsed.data.match === "1",
                own: parsed.data.own === "1",
              });
            } else if (
              url.pathname === "/api/game/replay" &&
              request.method === "GET"
            ) {
              const query = z
                .object({ guestId: z.uuid().optional() })
                .strict()
                .safeParse(Object.fromEntries(url.searchParams));
              if (!query.success) throw new RequestError(400, "invalid");
              if (query.data.guestId && query.data.guestId !== guest.id)
                throw new RequestError(409, "guest-changed");
              const replay = store.replay(guest.id);
              if (!replay) throw new RequestError(404, "no-result");
              result = replay;
            } else if (
              url.pathname === "/api/game/cancel" &&
              request.method === "POST"
            ) {
              const parsed = z
                .object({ requestId: z.uuid(), guestId: z.uuid().optional() })
                .strict()
                .safeParse(await readBody(request));
              if (!parsed.success) throw new RequestError(400, "invalid");
              requireCurrentGuest();
              if (parsed.data.guestId && parsed.data.guestId !== guest.id)
                throw new RequestError(409, "guest-changed");
              const reply = store.cancel(guest.id, parsed.data.requestId);
              status = reply.status;
              result = reply.body;
            } else if (
              url.pathname === "/api/game/act" &&
              request.method === "POST"
            ) {
              const parsed = actionRequest.safeParse(await readBody(request));
              if (!parsed.success) throw new RequestError(400, "invalid");
              requireCurrentGuest();
              if (parsed.data.guestId && parsed.data.guestId !== guest.id)
                throw new RequestError(409, "guest-changed");
              const reply = store.act(guest.id, parsed.data);
              status = reply.status;
              result = reply.body;
            } else throw new RequestError(404, "not-found");
          }
        }
      } catch (error) {
        if (error instanceof AccountError) {
          status = error.status;
          result = { error: error.code };
          if (status === 503) response.setHeader("Retry-After", "1");
        } else if (error instanceof RequestError) {
          status = error.status;
          result = { error: error.message };
        } else {
          status = 500;
          result = { error: "internal" };
        }
      }
      if (!response.destroyed) {
        if (status === 413) response.setHeader("Connection", "close");
        response.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(result));
      }
    },
  );
  server.on("close", () => store.close());
  return server;
}
