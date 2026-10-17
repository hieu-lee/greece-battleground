import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
export class AccountError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export const encodedPassword = z
  .string()
  .regex(/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
const dummySalt = randomBytes(16);
let passwordWork = 0;

async function derive(password: string, salt: Buffer) {
  if (passwordWork >= 2) throw new AccountError(503, "auth-busy");
  passwordWork++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  } finally {
    passwordWork--;
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16),
    key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string | null) {
  const pieces =
    encoded === null ? null : encodedPassword.parse(encoded).split("$");
  const salt = pieces ? Buffer.from(pieces[4] ?? "", "hex") : dummySalt;
  const expected = pieces
    ? Buffer.from(pieces[5] ?? "", "hex")
    : Buffer.alloc(64);
  const actual = await derive(password, salt);
  const matches = timingSafeEqual(actual, expected);
  return encoded !== null && matches;
}
export function createAccountTables(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      guest TEXT PRIMARY KEY REFERENCES guests(id), username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY, guest TEXT NOT NULL REFERENCES accounts(guest) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions(expires_at);
  `);
}
