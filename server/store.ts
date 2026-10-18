import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  AccountError,
  createAccountTables,
  encodedPassword,
  hashPassword,
  verifyPassword,
  sessionLifetimeMs,
} from "./accounts.ts";
import type {
  AccountSignup,
  Account,
  AccountSession,
  AccountAuthorization,
} from "../src/accounts.ts";
import {
  gameSession,
  inspection,
  newGame,
  parseGame,
  recreateGame,
  transaction,
} from "../src/game.ts";
import type { Game, IncomeRuntime } from "../src/game.ts";
import { guestInput } from "../src/read-model.ts";
import { opponentLayout } from "../src/encounter-layout.ts";
import { battle, fighter, horn, tower } from "../src/combat.ts";
import {
  warband,
  income,
  settlement,
  hornActivations,
  towerActivations,
} from "../src/warband.ts";
import { publicMap } from "../src/map.ts";
import { rulesVersion, sourceEncounterKind } from "../src/rules-version.ts";
import { clanId } from "../src/clans.ts";
import { resumeEntries } from "../src/item-entries.ts";
import { createMatchmakingTables } from "./matchmaking.ts";
import {
  rate,
  sourceOpponentMean,
  startingElo,
  xpAward,
  xpRank,
} from "./ranking.ts";

// SQLite schema identity, independent of the engine identity in rules_metadata.
// Schema 6 adds ranked queues, profiles and run results to the greece-118-v5 schema 5.
// Schema 7 keeps those tables for greece-118-v6 (full shop: offer-v2 draw/attempt stream and new
// fighter fields in stored battles). Any other engine identity, including greece-118-v5 at schema 5
// or 6, is refused read-only and kept as its archive with its ranked tables intact.
// Schema 8 keeps them for greece-118-v7 (full Fate: 94 entries, targeted Charm purchase, Charm
// triggers and kill Insight in stored fighters and outcomes; source unit motion changes every
// stored battle's replay); greece-118-v6 databases are archives.
// Schema 9 adds one-use account recovery without changing game/replay identity.
// Schema 10 freezes Horn controllers alongside each submitted warband.
// Schema 11 additionally freezes source Tower controllers; rules21 data stays archived.
// Schema12 stores the source live opponent list and independent freeplay rating/counter.
// Schema14 freezes matchmaking inputs and records opponent reuse independently of rewards.
export const schemaVersion = 14;
const queue = z.enum(["unranked", "ranked"]);
export const guestRequest = guestInput.extend({ queue: queue.optional() });
export const actionRequest = transaction.extend({
  requestId: z.uuid(),
  guestId: z.uuid().optional(),
});
export const queueRequest = z
  .object({
    requestId: z.uuid(),
    revision: z.number().int().nonnegative(),
    queue,
    clan: clanId,
    guestId: z.uuid().optional(),
  })
  .strict();
export const leaderboardPageSize = 10;
const guestRow = z.object({ id: z.uuid(), name: z.string() });
const gameRow = z.object({
  run: z.uuid(),
  state: z.string(),
  ranked: z.number(),
  source_opponents: z.string(),
});
const sourceOpponents = z.array(z.int32()).max(19);
const profileRow = z.object({
  name: z.string(),
  elo: z.number().int(),
  xp: z.number().int(),
  ranked_games: z.number().int(),
  freeplay_elo: z.number().int(),
  freeplay_games: z.number().int(),
});
const resultRow = z.object({
  ranked: z.number(),
  wins: z.number().int(),
  outcome: z.enum(["victory", "defeat", "round-limit", "abandoned"]),
  xp_award: z.number().int(),
  k: z.number().int().nullable(),
  opponent_elo: z.number().nullable(),
  elo_before: z.number().int().nullable(),
  elo_change: z.number().int().nullable(),
  elo_after: z.number().int().nullable(),
});
const standingRow = z.object({
  guest: z.uuid(),
  name: z.string(),
  elo: z.number().int(),
  xp: z.number().int(),
  ranked_games: z.number().int(),
  rank: z.number().int(),
  position: z.number().int(),
});
// Equal Elo shares a rank; within it, whoever reached the rating first (earlier last ranked
// result) is listed first. last_ranked is unique, so the order is total and pages are stable.
// ponytail: ranks every ranked guest per request; cache or materialise standings at scale.
const standings = `SELECT p.guest,g.name,p.elo,p.xp,p.ranked_games,
  RANK() OVER (ORDER BY p.elo DESC) AS rank,
  ROW_NUMBER() OVER (ORDER BY p.elo DESC, p.last_ranked) AS position
  FROM profiles p JOIN guests g ON g.id=p.guest WHERE p.ranked_games>0`;
const receiptRow = z.object({
  hash: z.string(),
  reply: z.string(),
  status: z.number(),
  pending: z.number(),
});
const submission = z.tuple([
  z.uuid(),
  z.number().int().positive(),
  z.number().int().nonnegative(),
  z.string().regex(/^[a-f0-9]{64}$/),
]);
const storedReply = z
  .object({
    body: z.record(z.string(), z.unknown()),
    submission: submission.nullable(),
  })
  .strict();
function receiptReply(encoded: string) {
  const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(encoded));
  return "body" in raw
    ? storedReply.parse(raw)
    : { body: raw, submission: null };
}
const ghostRow = z.object({
  guest: z.uuid(),
  name: z.string(),
  fighters: z.string(),
  horns: z.string(),
  towers: z.string(),
  layout: z.string(),
  lineup_hash: z.string(),
  elo: z.int32().nonnegative(),
});
const deltaRow = z.object({ revision: z.number(), delta: z.string() });
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const seed = () => randomBytes(4).readUInt32LE();
class Waiting extends Error {}
export type Reply = { status: number; body: object };
type OfferSelector = NonNullable<Parameters<typeof newGame>[3]>;

function checkDatabaseCompatibility(database: DatabaseSync) {
  const marked = database
    .prepare(
      "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='rules_metadata'",
    )
    .get();
  if (marked) {
    const storedRules = z
      .object({ value: z.string() })
      .parse(
        database.prepare("SELECT value FROM rules_metadata WHERE id=1").get(),
      );
    if (storedRules.value !== rulesVersion)
      throw new Error(
        "This database belongs to other game rules. Preserve it and start the current service with a new database path.",
      );
  } else {
    for (const table of ["guests", "games", "ghosts", "deltas", "receipts"]) {
      const exists = database
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?")
        .get(table);
      if (exists && database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
        throw new Error(
          "This database contains previous-rules runs or requests. Preserve it and start the current service with a new database path; archived outcomes are not recomputed.",
        );
    }
  }
  const version = z
    .object({ user_version: z.number() })
    .parse(database.prepare("PRAGMA user_version").get());
  if (version.user_version > schemaVersion)
    throw new Error("Database schema requires a newer service");
  if (
    (marked || version.user_version !== 0) &&
    version.user_version !== schemaVersion
  )
    throw new Error(
      "Database schema requires explicit account migration into a new path; preserve the source unchanged.",
    );
}

export class GameStore {
  private readonly db: DatabaseSync;
  private readonly randomKey: Buffer;
  private readonly now: () => number;
  private readonly runtimes = new Map<string, IncomeRuntime>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  constructor(path: string, options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => performance.now());
    if (existsSync(path)) {
      const archive = new DatabaseSync(path, {
        readOnly: true,
        timeout: 3000,
        allowExtension: false,
      });
      try {
        checkDatabaseCompatibility(archive);
      } finally {
        archive.close();
      }
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path, { timeout: 3000, allowExtension: false });
    try {
      checkDatabaseCompatibility(this.db);
      chmodSync(path, 0o600);
      this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS guests (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_recovery (
        guest TEXT PRIMARY KEY REFERENCES guests(id), secret_hash TEXT NOT NULL UNIQUE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS games (
        guest TEXT PRIMARY KEY REFERENCES guests(id), run TEXT NOT NULL,
        revision INTEGER NOT NULL, state TEXT NOT NULL,
        ranked INTEGER NOT NULL DEFAULT 0,
        source_opponents TEXT NOT NULL DEFAULT '[]'
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ghosts (
        seq INTEGER PRIMARY KEY, guest TEXT NOT NULL REFERENCES guests(id),
        run TEXT NOT NULL, round INTEGER NOT NULL, revision INTEGER NOT NULL,
        fighters TEXT NOT NULL, horns TEXT NOT NULL, towers TEXT NOT NULL,
        layout TEXT NOT NULL, lineup_hash TEXT NOT NULL,
        ranked INTEGER NOT NULL DEFAULT 0,
        UNIQUE(guest,run,round,revision,lineup_hash)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS ghosts_round ON ghosts(round,seq);
      CREATE INDEX IF NOT EXISTS ghosts_guest_round ON ghosts(guest,round,seq);
      CREATE TABLE IF NOT EXISTS deltas (
        guest TEXT NOT NULL REFERENCES guests(id), revision INTEGER NOT NULL,
        delta TEXT NOT NULL, PRIMARY KEY(guest,revision)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS receipts (
        seq INTEGER PRIMARY KEY, guest TEXT NOT NULL REFERENCES guests(id),
        request TEXT NOT NULL, hash TEXT NOT NULL, status INTEGER NOT NULL,
        reply TEXT NOT NULL, pending INTEGER NOT NULL,
        UNIQUE(guest,request)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS private_random (
        id INTEGER PRIMARY KEY CHECK(id=1), key BLOB NOT NULL CHECK(length(key)=32)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rules_metadata (
        id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS profiles (
        guest TEXT PRIMARY KEY REFERENCES guests(id), elo INTEGER NOT NULL,
        xp INTEGER NOT NULL, ranked_games INTEGER NOT NULL, last_ranked INTEGER,
        freeplay_elo INTEGER NOT NULL DEFAULT 0, freeplay_games INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE INDEX IF NOT EXISTS profiles_standing ON profiles(elo DESC,last_ranked)
        WHERE ranked_games>0;
      CREATE TABLE IF NOT EXISTS ranked_battles (
        guest TEXT NOT NULL REFERENCES guests(id), run TEXT NOT NULL,
        round INTEGER NOT NULL, opponent_elo INTEGER NOT NULL,
        PRIMARY KEY(guest,run,round)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS results (
        seq INTEGER PRIMARY KEY, guest TEXT NOT NULL REFERENCES guests(id),
        run TEXT NOT NULL, ranked INTEGER NOT NULL, wins INTEGER NOT NULL,
        outcome TEXT NOT NULL, xp_award INTEGER NOT NULL, k INTEGER,
        opponent_elo REAL, elo_before INTEGER, elo_change INTEGER, elo_after INTEGER,
        UNIQUE(guest,run)
      ) STRICT;
    `);
      createAccountTables(this.db);
      createMatchmakingTables(this.db);
      // Older same-rules schemas gain columns whose defaults describe their rows exactly:
      // version-1 ghosts had no layout, and every pre-ranked run and ghost is unranked.
      for (const [table, column, definition] of [
        ["ghosts", "layout", "TEXT NOT NULL DEFAULT 'null'"],
        ["ghosts", "horns", "TEXT NOT NULL DEFAULT '[]'"],
        ["ghosts", "towers", "TEXT NOT NULL DEFAULT '[]'"],
        ["ghosts", "ranked", "INTEGER NOT NULL DEFAULT 0"],
        ["games", "ranked", "INTEGER NOT NULL DEFAULT 0"],
        ["games", "source_opponents", "TEXT NOT NULL DEFAULT '[]'"],
        ["profiles", "freeplay_elo", "INTEGER NOT NULL DEFAULT 0"],
        ["profiles", "freeplay_games", "INTEGER NOT NULL DEFAULT 0"],
      ] as const) {
        const columns = z
          .array(z.object({ name: z.string() }))
          .parse(this.db.prepare(`PRAGMA table_info(${table})`).all());
        if (!columns.some((existing) => existing.name === column))
          this.db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
          );
      }
      this.db
        .prepare(
          "INSERT OR IGNORE INTO profiles (guest,elo,xp,ranked_games) SELECT id,?,0,0 FROM guests",
        )
        .run(startingElo);
      this.db
        .prepare("INSERT OR IGNORE INTO rules_metadata VALUES (1,?)")
        .run(rulesVersion);
      if (
        !this.db
          .prepare("SELECT 1 FROM rules_metadata WHERE id=1 AND value=?")
          .get(rulesVersion)
      )
        throw new Error(
          "A service with other game rules initialized this database. Use a separate database path.",
        );
      this.db
        .prepare("INSERT OR IGNORE INTO private_random VALUES (1,?)")
        .run(randomBytes(32));
      const storedKey = z
        .object({
          key: z.instanceof(Uint8Array).refine((value) => value.length === 32),
        })
        .parse(
          this.db.prepare("SELECT key FROM private_random WHERE id=1").get(),
        );
      this.randomKey = Buffer.from(storedKey.key);
      this.db.function(
        "match_tie",
        { deterministic: true },
        (owner, run, round, other) =>
          this.randomBytes([
            "matchmaking-v1",
            String(owner),
            String(run),
            Number(round),
            String(other),
          ]).readUInt32BE(),
      );
      // One authoritative runtime reopening maps to source saved-run setup. Browser reads
      // and reconnects do not recreate GameStore or compact its item/report state.
      const restoredRuntimes = new Map<string, IncomeRuntime>();
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const stored of this.db
          .prepare(
            "SELECT guest,run,state,ranked,source_opponents FROM games WHERE source_opponents<>'[]' OR json_array_length(state,'$.itemEntries.free')>0 OR json_extract(state,'$.phase.kind')='income'",
          )
          .iterate()) {
          const row = gameRow.extend({ guest: z.uuid() }).parse(stored);
          const opponents = sourceOpponents.parse(
            JSON.parse(row.source_opponents),
          );
          const game = parseGame(JSON.parse(row.state));
          if (game.phase.kind !== "finished") {
            if (opponents.length) {
              const mean = sourceOpponentMean(opponents);
              this.db
                .prepare("UPDATE games SET source_opponents=? WHERE guest=?")
                .run(JSON.stringify(opponents.map(() => mean)), row.guest);
            }
            const resumed = resumeEntries(recreateGame(game));
            if (resumed.revision !== game.revision)
              this.saveState(row.guest, row.run, game, resumed);
            else if (JSON.stringify(resumed) !== JSON.stringify(game))
              this.db
                .prepare("UPDATE games SET state=? WHERE guest=?")
                .run(JSON.stringify(resumed), row.guest);
            if (resumed.phase.kind === "income") {
              const session = this.session(row.guest, row.run, resumed);
              if (session.pending)
                restoredRuntimes.set(row.guest, session.runtime);
            }
          }
        }
        this.db.exec("COMMIT");
        for (const [id, runtime] of restoredRuntimes)
          this.runtimes.set(id, runtime);
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.db.exec(`PRAGMA user_version=${schemaVersion}`);
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.startTimer();
  }
  close() {
    if (this.closed) return;
    clearInterval(this.timer);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      for (const id of this.runtimes.keys()) {
        const { game, run } = this.load(id);
        this.session(id, run, game).saveAndExit();
      }
      this.db.exec("COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      this.startTimer();
      throw error;
    }
    this.runtimes.clear();
    this.db.close();
    this.closed = true;
  }
  private startTimer() {
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        process.emitWarning(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }, 50);
    this.timer.unref();
  }
  private tick(id?: string) {
    const owners =
      id === undefined
        ? [...this.runtimes.keys()]
        : this.runtimes.has(id)
          ? [id]
          : [];
    if (!owners.length) return;
    try {
      this.db.exec("BEGIN IMMEDIATE");
      const next = new Map<string, IncomeRuntime | null>();
      const now = this.now();
      for (const id of owners) {
        const { game, run } = this.load(id);
        const session = this.session(id, run, game);
        session.update(now);
        next.set(id, session.pending ? session.runtime : null);
      }
      this.db.exec("COMMIT");
      for (const [id, runtime] of next)
        if (runtime) this.runtimes.set(id, runtime);
        else this.runtimes.delete(id);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private saveState(id: string, run: string, before: Game, next: Game) {
    const saved = this.db
      .prepare(
        "UPDATE games SET run=?,revision=?,state=? WHERE guest=? AND revision=?",
      )
      .run(run, next.revision, JSON.stringify(next), id, before.revision);
    if (saved.changes !== 1)
      throw new Error("Concurrent save changed the game");
    const previous = new Map(Object.entries(inspection(before)));
    const delta = Object.fromEntries(
      Object.entries(inspection(next)).filter(
        ([key, value]) =>
          key !== "r" &&
          JSON.stringify(value) !== JSON.stringify(previous.get(key)),
      ),
    );
    this.db
      .prepare("INSERT INTO deltas VALUES (?,?,?)")
      .run(id, next.revision, JSON.stringify(delta));
    this.db
      .prepare("DELETE FROM deltas WHERE guest=? AND revision<=?")
      .run(id, next.revision - 32);
  }
  private session(
    id: string,
    run: string,
    game: Game,
    authority: Parameters<typeof gameSession>[3] = {
      offerIndex: this.offerIndex(id),
      encounter: () => {
        throw new Error("Income updates cannot start a battle");
      },
    },
  ) {
    let current = game;
    const runtime = this.runtimes.get(id);
    return gameSession(
      game,
      (next) => {
        this.saveState(id, run, current, next);
        current = next;
      },
      () => {},
      authority,
      { now: this.now(), ...(runtime ? { runtime } : {}) },
    );
  }
  private randomBytes(context: readonly (string | number)[]) {
    return createHmac("sha256", this.randomKey)
      .update(JSON.stringify(context))
      .digest();
  }
  private offerIndex(id: string): OfferSelector {
    return (context, upperBound) => {
      if (upperBound < 1 || upperBound > 0x100000000)
        throw new RangeError(
          "Offer pool is outside the random stream's bounds",
        );
      // draw/attempt keep the shop's rarity and entry draws on independent streams.
      const coordinates = [
        "offer-v2",
        id,
        context.kind,
        context.seed,
        context.round,
        context.roll,
        context.slot,
        context.draw,
        context.attempt,
      ];
      const ceiling = 0x100000000 - (0x100000000 % upperBound);
      for (let rejection = 0; ; rejection++) {
        const value = this.randomBytes([
          ...coordinates,
          rejection,
        ]).readUInt32BE();
        if (value < ceiling) return value % upperBound;
      }
    };
  }
  private nextRun(id: string, run: string) {
    const bytes = this.randomBytes(["restart-v1", id, run]);
    bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x40, 6);
    bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
    const hex = bytes.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  authenticate(token: string) {
    return guestRow
      .nullable()
      .parse(
        this.db
          .prepare(
            "SELECT id,name FROM guests WHERE token_hash=? AND NOT EXISTS(SELECT 1 FROM accounts WHERE guest=guests.id)",
          )
          .get(hash(token)) ?? null,
      );
  }
  issueRecovery(id: string) {
    if (this.hasAccount(id))
      throw new AccountError(403, "account-password-required");
    const secret = randomBytes(32).toString("hex");
    this.db
      .prepare(
        "INSERT INTO account_recovery (guest,secret_hash) VALUES (?,?) ON CONFLICT(guest) DO UPDATE SET secret_hash=excluded.secret_hash",
      )
      .run(id, hash(secret));
    return { secret };
  }
  recover(secret: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = z
        .object({ guest: z.uuid() })
        .nullable()
        .parse(
          this.db
            .prepare(
              "DELETE FROM account_recovery WHERE secret_hash=? AND NOT EXISTS(SELECT 1 FROM accounts WHERE guest=account_recovery.guest) RETURNING guest",
            )
            .get(hash(secret)) ?? null,
        );
      if (!row) {
        this.db.exec("COMMIT");
        return null;
      }
      const token = randomBytes(32).toString("hex");
      const guest = guestRow.parse(
        this.db
          .prepare(
            "UPDATE guests SET token_hash=? WHERE id=? RETURNING id,name",
          )
          .get(hash(token), row.guest),
      );
      this.db.exec("COMMIT");
      return { guest, token };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private insertGuest(input: z.infer<typeof guestRequest>) {
    const id = randomUUID(),
      token = randomBytes(32).toString("hex");
    const game = newGame(seed(), input.clan, "async", this.offerIndex(id));
    this.db
      .prepare("INSERT INTO guests VALUES (?,?,?)")
      .run(id, hash(token), input.name);
    this.db
      .prepare(
        "INSERT INTO games (guest,run,revision,state,ranked) VALUES (?,?,?,?,?)",
      )
      .run(
        id,
        randomUUID(),
        0,
        JSON.stringify(game),
        input.queue === "ranked" ? 1 : 0,
      );
    this.db
      .prepare(
        "INSERT INTO profiles (guest,elo,xp,ranked_games) VALUES (?,?,0,0)",
      )
      .run(id, startingElo);
    return { guest: { id, name: input.name }, token, state: inspection(game) };
  }
  create(input: z.infer<typeof guestRequest>) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const created = this.insertGuest(input);
      this.db.exec("COMMIT");
      return created;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  hasAccount(id: string) {
    return Boolean(
      this.db.prepare("SELECT 1 FROM accounts WHERE guest=?").get(id),
    );
  }
  private account(id: string): Account {
    const row = z
      .object({ username: z.string(), id: z.uuid(), name: z.string() })
      .parse(
        this.db
          .prepare(
            "SELECT a.username,g.id,g.name FROM accounts a JOIN guests g ON g.id=a.guest WHERE a.guest=?",
          )
          .get(id),
      );
    return { username: row.username, guest: { id: row.id, name: row.name } };
  }
  private addAccountSession(id: string): AccountAuthorization {
    const token = randomBytes(32).toString("hex"),
      expiresAt = Date.now() + sessionLifetimeMs;
    this.db
      .prepare("DELETE FROM account_sessions WHERE expires_at<=?")
      .run(Date.now());
    this.db
      .prepare("INSERT INTO account_sessions VALUES (?,?,?)")
      .run(hash(token), id, expiresAt);
    return { account: this.account(id), session: { token, expiresAt } };
  }
  accountSession(token: string): AccountSession | null {
    const row = z
      .object({ guest: z.uuid(), expires_at: z.number().int().positive() })
      .nullable()
      .parse(
        this.db
          .prepare(
            "SELECT guest,expires_at FROM account_sessions WHERE token_hash=? AND expires_at>?",
          )
          .get(hash(token), Date.now()) ?? null,
      );
    return row
      ? { account: this.account(row.guest), expiresAt: row.expires_at }
      : null;
  }
  logoutAccount(token: string) {
    this.db
      .prepare("DELETE FROM account_sessions WHERE token_hash=?")
      .run(hash(token));
  }
  async signupAccount(
    input: AccountSignup,
    authority: { id: string; token: string } | null,
  ) {
    if ("guestId" in input) {
      if (!authority) throw new AccountError(401, "unauthorized");
      if (authority.id !== input.guestId)
        throw new AccountError(409, "guest-changed");
      if (this.hasAccount(input.guestId))
        throw new AccountError(409, "account-exists");
    } else if (authority) throw new AccountError(409, "guest-claim-required");
    if (
      this.db
        .prepare("SELECT 1 FROM accounts WHERE username=?")
        .get(input.username)
    )
      throw new AccountError(409, "username-unavailable");
    const passwordHash = await hashPassword(input.password);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      let id: string;
      if ("guestId" in input) {
        if (
          !authority ||
          this.authenticate(authority.token)?.id !== input.guestId
        )
          throw new AccountError(401, "unauthorized");
        id = input.guestId;
      } else id = this.insertGuest(input.guest).guest.id;
      if (this.hasAccount(id)) throw new AccountError(409, "account-exists");
      if (
        this.db
          .prepare("SELECT 1 FROM accounts WHERE username=?")
          .get(input.username)
      )
        throw new AccountError(409, "username-unavailable");
      this.db
        .prepare("INSERT INTO accounts VALUES (?,?,?,?)")
        .run(id, input.username, passwordHash, Date.now());
      this.db
        .prepare("UPDATE guests SET token_hash=? WHERE id=?")
        .run(hash(randomBytes(32).toString("hex")), id);
      this.db.prepare("DELETE FROM account_recovery WHERE guest=?").run(id);
      const authorization = this.addAccountSession(id);
      this.db.exec("COMMIT");
      return authorization;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async loginAccount(input: { username: string; password: string }) {
    const row = z
      .object({ guest: z.uuid(), password_hash: encodedPassword })
      .nullable()
      .parse(
        this.db
          .prepare("SELECT guest,password_hash FROM accounts WHERE username=?")
          .get(input.username) ?? null,
      );
    const verified = await verifyPassword(
      input.password,
      row?.password_hash ?? null,
    );
    if (!verified || !row) throw new AccountError(401, "invalid-credentials");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const authorization = this.addAccountSession(row.guest);
      this.db.exec("COMMIT");
      return authorization;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private load(id: string) {
    const row = gameRow.parse(
      this.db
        .prepare(
          "SELECT run,state,ranked,source_opponents FROM games WHERE guest=?",
        )
        .get(id),
    );
    return {
      run: row.run,
      ranked: row.ranked === 1,
      opponents: sourceOpponents.parse(JSON.parse(row.source_opponents)),
      game: parseGame(JSON.parse(row.state)),
    };
  }
  private opponent(id: string, run: string, game: Game, ranked: boolean) {
    const profile = z.object({ elo: z.number(), games: z.number() }).parse(
      this.db
        .prepare(
          `SELECT ${ranked ? "elo" : "freeplay_elo"} AS elo,
        ${ranked ? "ranked_games" : "freeplay_games"} AS games FROM profiles WHERE guest=?`,
        )
        .get(id),
    );
    // Rating bands keep diversity from selecting a much less suitable opponent. The
    // nearest populated band always wins, so sparse pools do not add a new wait.
    const result = this.db
      .prepare(
        `
      WITH candidates AS (
        SELECT g.seq,g.guest,COALESCE(m.elo,p.${ranked ? "elo" : "freeplay_elo"}) AS elo,
          ABS(COALESCE(m.elo,p.${ranked ? "elo" : "freeplay_elo"})-?) AS rating_gap,
          CASE WHEN m.ghost_seq IS NULL THEN 2 ELSE (m.games<5)<>(?<5) END AS placement_gap,
          CASE WHEN m.ghost_seq IS NULL THEN 100 ELSE ABS(m.wins-?)+ABS(m.lives-?) END AS record_gap,
          (SELECT COUNT(*) FROM match_history h WHERE h.guest=? AND h.run=? AND h.opponent=g.guest) AS repeats
        FROM ghosts g
        JOIN profiles p ON p.guest=g.guest
        LEFT JOIN ghost_matchmaking m ON m.ghost_seq=g.seq
        WHERE g.guest<>? AND g.round=? AND g.ranked=?
      ), best_per_account AS (
        SELECT *,ROW_NUMBER() OVER (PARTITION BY guest ORDER BY
          CAST(rating_gap/100 AS INTEGER),placement_gap,record_gap,rating_gap,
          match_tie(?,?,?,seq),seq) AS choice
        FROM candidates
      ), chosen AS (
        SELECT seq,elo FROM best_per_account
        WHERE choice=1
        ORDER BY CAST(rating_gap/100 AS INTEGER),placement_gap,record_gap,repeats,rating_gap,
          match_tie(?,?,?,guest),guest LIMIT 1
      )
      SELECT g.guest,guests.name,g.fighters,g.horns,g.towers,g.layout,g.lineup_hash,c.elo
      FROM chosen c JOIN ghosts g ON g.seq=c.seq JOIN guests ON guests.id=g.guest
    `,
      )
      .get(
        profile.elo,
        profile.games,
        game.wins,
        game.lives,
        id,
        run,
        id,
        game.round,
        ranked ? 1 : 0,
        id,
        run,
        game.round,
        id,
        run,
        game.round,
      );
    return result ? ghostRow.parse(result) : null;
  }
  private lineup(game: Game) {
    return {
      fighters: warband(game, "opponent"),
      horns: hornActivations(game, "opponent"),
      towers: towerActivations(game, "opponent"),
      opponentLayout: settlement(game),
    };
  }
  private publish(id: string, run: string, game: Game, ranked: boolean) {
    if (game.phase.kind !== "prepare")
      throw new Error("Only prepared lineups can be submitted");
    const lineup = this.lineup(game);
    const fighters = JSON.stringify(lineup.fighters);
    const layout = JSON.stringify(lineup.opponentLayout);
    const digest = hash(JSON.stringify(lineup));
    const inserted = this.db
      .prepare(
        "INSERT OR IGNORE INTO ghosts (guest,run,round,revision,fighters,horns,towers,layout,lineup_hash,ranked) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        run,
        game.round,
        game.revision,
        fighters,
        JSON.stringify(lineup.horns),
        JSON.stringify(lineup.towers),
        layout,
        digest,
        ranked ? 1 : 0,
      );
    if (inserted.changes)
      this.db
        .prepare(
          `INSERT INTO ghost_matchmaking
      SELECT g.seq,p.${ranked ? "elo" : "freeplay_elo"},?,?,p.${ranked ? "ranked_games" : "freeplay_games"}
      FROM ghosts g JOIN profiles p ON p.guest=g.guest
      WHERE g.guest=? AND g.run=? AND g.round=? AND g.revision=? AND g.lineup_hash=?`,
        )
        .run(game.wins, game.lives, id, run, game.round, game.revision, digest);
    return submission.parse([run, game.round, game.revision, digest]);
  }
  inspect(
    id: string,
    options: {
      since?: number;
      map?: boolean;
      match?: boolean;
      own?: boolean;
    } = {},
  ) {
    const { game, run, ranked } = this.load(id);
    let result: object = inspection(game);
    if (options.since === game.revision)
      result = { r: game.revision, changes: [] };
    else if (options.since !== undefined && options.since < game.revision) {
      const rows = deltaRow
        .array()
        .parse(
          this.db
            .prepare(
              "SELECT revision,delta FROM deltas WHERE guest=? AND revision>? ORDER BY revision",
            )
            .all(id, options.since),
        );
      if (
        rows.length &&
        rows[0]?.revision === options.since + 1 &&
        rows.at(-1)?.revision === game.revision
      )
        result = {
          r: game.revision,
          changes: rows.map((row) => ({
            r: row.revision,
            delta: JSON.parse(row.delta),
          })),
        };
    }
    return {
      ...result,
      ...(options.own
        ? {
            warband: warband(game, "polis").map((u) => [
              u.name,
              u.health,
              u.armor,
              u.damage,
              u.speed,
              u.crit,
              u.burn,
              u.ward,
              u.regen,
            ]),
            income: income(game),
            queue: ranked ? "ranked" : "unranked",
          }
        : {}),
      ...(options.map
        ? {
            map: publicMap(game.seed, game.owned),
          }
        : {}),
      ...(options.match
        ? {
            matchmaking: {
              round: game.round,
              submitted: Boolean(
                this.db
                  .prepare(
                    "SELECT 1 FROM ghosts WHERE guest=? AND run=? AND round=? AND revision=? AND lineup_hash=?",
                  )
                  .get(
                    id,
                    run,
                    game.round,
                    game.revision,
                    hash(JSON.stringify(this.lineup(game))),
                  ),
              ),
              available:
                game.phase.kind === "prepare" &&
                (sourceEncounterKind(game.round) === "pve" ||
                  Boolean(
                    this.db
                      .prepare(
                        "SELECT 1 FROM ghosts WHERE guest<>? AND round=? AND ranked=? LIMIT 1",
                      )
                      .get(id, game.round, ranked ? 1 : 0),
                  )),
            },
          }
        : {}),
    };
  }
  replay(id: string) {
    const { game } = this.load(id);
    return game.phase.kind === "result"
      ? {
          r: game.revision,
          battleId: game.phase.battleId,
          rulesVersion: game.rulesVersion,
          encounter: game.phase.encounter,
          outcome: game.phase.outcome,
        }
      : null;
  }
  // Finish and paid-abandon transactions share one award; UNIQUE(guest,run) forbids duplicates.
  private award(
    id: string,
    run: string,
    ranked: boolean,
    wins: number,
    opponents: readonly number[],
    outcome: z.infer<typeof resultRow>["outcome"],
  ) {
    const before = profileRow.parse(
      this.db
        .prepare(
          "SELECT g.name,p.elo,p.xp,p.ranked_games,p.freeplay_elo,p.freeplay_games FROM profiles p JOIN guests g ON g.id=p.guest WHERE p.guest=?",
        )
        .get(id),
    );
    const roundLimit = outcome === "round-limit";
    const xp = roundLimit ? 0 : xpAward(wins);
    const player = ranked ? before.elo : before.freeplay_elo;
    const placements = ranked ? before.ranked_games : before.freeplay_games;
    const opponent = sourceOpponentMean(opponents);
    const rated = roundLimit ? null : rate(wins, player, opponent, placements);
    const { lastInsertRowid } = this.db
      .prepare(
        "INSERT INTO results (guest,run,ranked,wins,outcome,xp_award,k,opponent_elo,elo_before,elo_change,elo_after) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        run,
        ranked ? 1 : 0,
        wins,
        outcome,
        xp,
        rated?.k ?? null,
        rated ? opponent : null,
        rated ? player : null,
        rated?.change ?? null,
        rated?.elo ?? null,
      );
    if (rated && ranked)
      this.db
        .prepare(
          // The tie-break marks when the guest reached this rating, so an unchanged rating keeps it.
          "UPDATE profiles SET elo=?,xp=xp+?,ranked_games=ranked_games+1,last_ranked=CASE WHEN last_ranked IS NULL OR elo<>? THEN ? ELSE last_ranked END WHERE guest=?",
        )
        .run(rated.elo, xp, rated.elo, lastInsertRowid, id);
    else if (rated)
      this.db
        .prepare(
          "UPDATE profiles SET freeplay_elo=?,xp=xp+?,freeplay_games=freeplay_games+1 WHERE guest=?",
        )
        .run(rated.elo, xp, id);
  }
  // Starts a fresh run after source paid abandonment; pending searches must be cancelled first.
  enter(id: string, request: z.infer<typeof queueRequest>): Reply {
    this.tick(id);
    const fingerprint = hash(JSON.stringify(request));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = receiptRow
        .nullable()
        .parse(
          this.db
            .prepare(
              "SELECT hash,reply,status,pending FROM receipts WHERE guest=? AND request=?",
            )
            .get(id, request.requestId) ?? null,
        );
      if (receipt) {
        this.db.exec("COMMIT");
        return receipt.hash === fingerprint && !receipt.pending
          ? { status: receipt.status, body: receiptReply(receipt.reply).body }
          : { status: 409, body: { error: "request-conflict" } };
      }
      const { game, run, ranked, opponents } = this.load(id);
      const waiting = z
        .array(z.object({ reply: z.string() }))
        .parse(
          this.db
            .prepare("SELECT reply FROM receipts WHERE guest=? AND pending=1")
            .all(id),
        )
        .some((row) => receiptReply(row.reply).body.r === game.revision);
      let reply: Reply;
      let replaced = false;
      if (request.revision !== game.revision)
        reply = { status: 409, body: { r: game.revision, error: "stale" } };
      else if (waiting)
        reply = { status: 409, body: { r: game.revision, error: "waiting" } };
      else {
        // Source ranked abandonment always settles; freeplay skips rounds1/2.
        // A pending result is not claimed by changing queues.
        if (game.phase.kind !== "finished" && (ranked || game.round >= 3))
          this.award(id, run, ranked, game.wins, opponents, "abandoned");
        const fresh = newGame(
          seed(),
          request.clan,
          "async",
          this.offerIndex(id),
        );
        fresh.revision = game.revision + 1;
        this.db
          .prepare(
            "UPDATE games SET run=?,revision=?,state=?,ranked=?,source_opponents='[]' WHERE guest=?",
          )
          .run(
            randomUUID(),
            fresh.revision,
            JSON.stringify(fresh),
            request.queue === "ranked" ? 1 : 0,
            id,
          );
        // The previous run's deltas cannot be chained onto this one; inspect sends a snapshot.
        this.db.prepare("DELETE FROM deltas WHERE guest=?").run(id);
        replaced = true;
        reply = {
          status: 200,
          body: { r: fresh.revision, queue: request.queue },
        };
      }
      this.db
        .prepare(
          "INSERT INTO receipts (guest,request,hash,status,reply,pending) VALUES (?,?,?,?,?,0)",
        )
        .run(
          id,
          request.requestId,
          fingerprint,
          reply.status,
          JSON.stringify({ body: reply.body, submission: null }),
        );
      this.db.exec("COMMIT");
      if (replaced) this.runtimes.delete(id);
      return reply;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private standing(id: string) {
    const row = this.db
      .prepare(`SELECT * FROM (${standings}) WHERE guest=?`)
      .get(id);
    return row ? standingRow.parse(row) : null;
  }
  profile(id: string) {
    const { game, ranked } = this.load(id);
    const profile = profileRow.parse(
      this.db
        .prepare(
          "SELECT g.name,p.elo,p.xp,p.ranked_games,p.freeplay_elo,p.freeplay_games FROM profiles p JOIN guests g ON g.id=p.guest WHERE p.guest=?",
        )
        .get(id),
    );
    const standing = this.standing(id);
    return {
      name: profile.name,
      elo: profile.elo,
      freeplayElo: profile.freeplay_elo,
      freeplayGames: profile.freeplay_games,
      // Both native league selectors return their first qualifying ascending entry.
      league: { band: 1, tier: 1 },
      xp: profile.xp,
      rank: xpRank(profile.xp),
      rankedGames: profile.ranked_games,
      standing: standing
        ? { rank: standing.rank, position: standing.position }
        : null,
      current: {
        r: game.revision,
        queue: ranked ? "ranked" : "unranked",
        round: game.round,
        phase: game.phase.kind,
        wins: game.wins,
        lives: game.lives,
      },
      history: resultRow
        .array()
        .parse(
          this.db
            .prepare(
              "SELECT ranked,wins,outcome,xp_award,k,opponent_elo,elo_before,elo_change,elo_after FROM results WHERE guest=? ORDER BY seq DESC LIMIT 10",
            )
            .all(id),
        )
        .map((row) => ({
          queue: row.ranked ? "ranked" : "unranked",
          wins: row.wins,
          outcome: row.outcome,
          xp: row.xp_award,
          elo:
            row.elo_before === null ||
            row.elo_change === null ||
            row.elo_after === null ||
            row.k === null ||
            row.opponent_elo === null
              ? null
              : {
                  before: row.elo_before,
                  change: row.elo_change,
                  after: row.elo_after,
                  k: row.k,
                  opponent: row.opponent_elo,
                },
        })),
    };
  }
  // Public standings: names and ranked numbers only, never guest IDs, runs or warbands.
  leaderboard(page: number, viewer: string | null) {
    const { total } = z
      .object({ total: z.number().int() })
      .parse(
        this.db
          .prepare(
            "SELECT COUNT(*) AS total FROM profiles WHERE ranked_games>0",
          )
          .get(),
      );
    const rows = standingRow
      .array()
      .parse(
        this.db
          .prepare(
            `SELECT * FROM (${standings}) WHERE position>? ORDER BY position LIMIT ?`,
          )
          .all((page - 1) * leaderboardPageSize, leaderboardPageSize),
      );
    const own = viewer ? this.standing(viewer) : null;
    return {
      page,
      pageSize: leaderboardPageSize,
      total,
      pages: Math.max(1, Math.ceil(total / leaderboardPageSize)),
      rows: rows.map((row) => ({
        rank: row.rank,
        position: row.position,
        name: row.name,
        elo: row.elo,
        xp: row.xp,
        band: xpRank(row.xp).band,
        games: row.ranked_games,
        you: row.guest === viewer,
      })),
      you: own
        ? {
            rank: own.rank,
            position: own.position,
            page: Math.ceil(own.position / leaderboardPageSize),
          }
        : null,
    };
  }
  cancel(id: string, requestId: string): Reply {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = receiptRow
        .nullable()
        .parse(
          this.db
            .prepare(
              "SELECT hash,reply,status,pending FROM receipts WHERE guest=? AND request=?",
            )
            .get(id, requestId) ?? null,
        );
      if (!receipt) {
        this.db.exec("COMMIT");
        return { status: 404, body: { error: "no-request" } };
      }
      if (!receipt.pending) {
        this.db.exec("COMMIT");
        return receipt.status === 409 &&
          receiptReply(receipt.reply).body.error === "cancelled"
          ? {
              status: 200,
              body: { cancelled: true, r: this.load(id).game.revision },
            }
          : { status: receipt.status, body: receiptReply(receipt.reply).body };
      }
      const { game } = this.load(id);
      const saved = receiptReply(receipt.reply);
      let exact = saved.submission;
      // Earlier services stored flat replies; their first revision snapshot is the rolled-back waiting lineup.
      if (!exact) {
        const revision = z.number().int().nonnegative().parse(saved.body.r);
        const row = this.db
          .prepare(
            "SELECT run,round,revision,lineup_hash FROM ghosts WHERE guest=? AND revision=? ORDER BY seq LIMIT 1",
          )
          .get(id, revision);
        if (row) {
          const old = z
            .object({
              run: z.uuid(),
              round: z.number(),
              revision: z.number(),
              lineup_hash: z.string(),
            })
            .parse(row);
          exact = submission.parse([
            old.run,
            old.round,
            old.revision,
            old.lineup_hash,
          ]);
        }
      }
      if (exact)
        this.db
          .prepare(
            "DELETE FROM ghosts WHERE guest=? AND run=? AND round=? AND revision=? AND lineup_hash=?",
          )
          .run(id, ...exact);
      this.db
        .prepare(
          "UPDATE receipts SET pending=0,status=409,reply=? WHERE guest=? AND request=?",
        )
        .run(
          JSON.stringify({
            body: { r: game.revision, error: "cancelled" },
            submission: null,
          }),
          id,
          requestId,
        );
      this.db.exec("COMMIT");
      return { status: 200, body: { cancelled: true, r: game.revision } };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  act(id: string, request: z.infer<typeof actionRequest>): Reply {
    this.tick(id);
    const fingerprint = hash(JSON.stringify(request));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = receiptRow
        .nullable()
        .parse(
          this.db
            .prepare(
              "SELECT hash,reply,status,pending FROM receipts WHERE guest=? AND request=?",
            )
            .get(id, request.requestId) ?? null,
        );
      if (receipt) {
        if (receipt.hash !== fingerprint) {
          const reply = { status: 409, body: { error: "request-conflict" } };
          this.db.exec("COMMIT");
          return reply;
        }
        if (!receipt.pending) {
          this.db.exec("COMMIT");
          return {
            status: receipt.status,
            body: receiptReply(receipt.reply).body,
          };
        }
      }
      const { game, run, ranked, opponents } = this.load(id);
      const nextRun = request.actions.some((action) => action.op === "restart")
        ? this.nextRun(id, run)
        : run;
      let reply: Reply;
      let pending = false;
      let nextRuntime: IncomeRuntime | null | undefined;
      let published: z.infer<typeof submission> | null = null;
      if (request.revision !== game.revision)
        reply = { status: 409, body: { r: game.revision, error: "stale" } };
      else {
        const session = this.session(id, nextRun, game, {
          offerIndex: this.offerIndex(id),
          encounter: (current) => {
            const other = this.opponent(id, nextRun, current, ranked);
            if (!other)
              throw new Waiting(
                "Waiting for another player's submitted warband on this round",
              );
            this.publish(id, nextRun, current, ranked);
            // Keep the actual ghost audit separate from source reports (PvE has no ghost).
            this.db
              .prepare("INSERT OR REPLACE INTO ranked_battles VALUES (?,?,?,?)")
              .run(id, nextRun, current.round, other.elo);
            this.db
              .prepare("INSERT INTO match_history VALUES (?,?,?,?)")
              .run(id, nextRun, current.round, other.guest);
            return battle.parse({
              seed: this.randomBytes([
                "battle-v1",
                id,
                current.seed,
                current.round,
                other.guest,
                other.lineup_hash,
              ]).readUInt32BE(),
              kind: "pvp",
              opponent: other.name,
              opponentLayout: opponentLayout.parse(JSON.parse(other.layout)),
              horns: [
                ...hornActivations(current, "polis"),
                ...horn.array().max(128).parse(JSON.parse(other.horns)),
              ],
              towers: [
                ...towerActivations(current, "polis"),
                ...tower.array().max(128).parse(JSON.parse(other.towers)),
              ],
              fighters: [
                ...warband(current, "polis"),
                ...fighter.array().parse(JSON.parse(other.fighters)),
              ],
            });
          },
        });
        this.db.exec("SAVEPOINT actions");
        try {
          const applied = session.act({
            revision: request.revision,
            actions: request.actions,
          });
          const change = applied.changes[0];
          if (!change) throw new Error("Missing committed delta");
          const after = session.state;
          let reported = nextRun === run ? opponents : [];
          if (request.actions.at(-1)?.op === "give-up") {
            const waiting = z
              .array(z.object({ reply: z.string() }))
              .parse(
                this.db
                  .prepare(
                    "SELECT reply FROM receipts WHERE guest=? AND pending=1",
                  )
                  .all(id),
              )
              .some((row) => receiptReply(row.reply).body.r === game.revision);
            if (waiting) throw new Error("Cancel waiting before giving up");
            if (ranked || game.round >= 3)
              this.award(id, run, ranked, after.wins, opponents, "abandoned");
            reported = [];
          }
          // Async ready/continue/restart must end their batch. A completed result can
          // therefore only be the initial phase consumed by this request's Continue.
          if (
            game.phase.kind === "result" &&
            request.actions.at(-1)?.op === "continue"
          ) {
            const normalTerminal =
              after.phase.kind === "finished" &&
              after.phase.outcome !== "round-limit";
            if (!normalTerminal) {
              const elo =
                game.phase.encounter.kind === "pve"
                  ? 0
                  : z
                      .object({ opponent_elo: z.int32() })
                      .parse(
                        this.db
                          .prepare(
                            "SELECT opponent_elo FROM ranked_battles WHERE guest=? AND run=? AND round=?",
                          )
                          .get(id, run, game.round),
                      ).opponent_elo;
              reported = sourceOpponents.parse([...reported, elo]);
            }
            if (after.phase.kind === "finished") {
              this.award(
                id,
                nextRun,
                ranked,
                after.wins,
                reported,
                after.phase.outcome,
              );
              reported = [];
            }
          }
          if (nextRun !== run || reported !== opponents)
            this.db
              .prepare("UPDATE games SET source_opponents=? WHERE guest=?")
              .run(JSON.stringify(reported), id);
          this.db.exec("RELEASE actions");
          nextRuntime = session.pending ? session.runtime : null;
          reply = { status: 200, body: applied };
        } catch (error) {
          this.db.exec("ROLLBACK TO actions; RELEASE actions");
          if (
            error instanceof z.ZodError ||
            (error instanceof Error && "code" in error)
          )
            throw error;
          if (error instanceof Waiting) {
            if (game.phase.kind === "prepare")
              published = this.publish(id, run, game, ranked);
            pending = true;
            reply = {
              status: 202,
              body: {
                r: game.revision,
                error: "waiting",
                message: error.message,
              },
            };
          } else
            reply = {
              status: 422,
              body: {
                r: game.revision,
                error: "rejected",
                message:
                  error instanceof Error ? error.message : "Action rejected",
              },
            };
        }
      }
      this.db
        .prepare(
          `INSERT INTO receipts (guest,request,hash,status,reply,pending) VALUES (?,?,?,?,?,?)
        ON CONFLICT(guest,request) DO UPDATE SET status=excluded.status,reply=excluded.reply,pending=excluded.pending`,
        )
        .run(
          id,
          request.requestId,
          fingerprint,
          reply.status,
          JSON.stringify({ body: reply.body, submission: published }),
          pending ? 1 : 0,
        );
      this.db.exec("COMMIT");
      if (nextRuntime) this.runtimes.set(id, nextRuntime);
      else if (nextRuntime === null) this.runtimes.delete(id);
      return reply;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
