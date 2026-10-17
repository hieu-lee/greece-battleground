import { z } from "zod";
import { guestInput } from "./read-model.ts";

export const accountUsername = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_]+$/)
  .toLowerCase();
export const accountPassword = z.string().min(15).max(128);
const credentials = { username: accountUsername, password: accountPassword };
export const accountSignup = z.union([
  z.object({ ...credentials, guestId: z.uuid() }).strict(),
  z
    .object({
      ...credentials,
      guest: guestInput
        .extend({ queue: z.enum(["unranked", "ranked"]).optional() })
        .strict(),
    })
    .strict(),
]);
export const accountLogin = z.object(credentials).strict();
export const accountLogout = z.object({}).strict();
export const publicAccount = z
  .object({
    username: accountUsername,
    guest: z.object({ id: z.uuid(), name: z.string() }).strict(),
  })
  .strict();
const expiry = z.number().int().positive();
export const accountSession = z
  .object({ account: publicAccount, expiresAt: expiry })
  .strict();
export const accountAuthorization = z
  .object({
    account: publicAccount,
    session: z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: expiry })
      .strict(),
  })
  .strict();
export const accountLoggedOut = z
  .object({ loggedOut: z.literal(true) })
  .strict();
export type AccountSignup = z.infer<typeof accountSignup>;
export type Account = z.infer<typeof publicAccount>;
export type AccountSession = z.infer<typeof accountSession>;
export type AccountAuthorization = z.infer<typeof accountAuthorization>;
