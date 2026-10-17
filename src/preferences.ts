import { z } from "zod";

export const audioSettings = z.object({
  master: z.number().min(0).max(1).default(0.65),
  effects: z.number().min(0).max(1).default(0.8),
  music: z.number().min(0).max(1).default(0.3),
  muted: z.boolean().default(false),
});
export const worldSettings = z.object({
  resolution: z.enum(["auto", "lower"]).default("auto"),
  panSpeed: z.number().min(0.5).max(2).default(1),
  reverseWheel: z.boolean().default(false),
});
export type WorldSettings = z.infer<typeof worldSettings>;

const schema = z
  .object({
    name: z.string().trim().min(1).max(24),
    motion: z.enum(["system", "reduce"]),
  })
  .extend(audioSettings.shape)
  .extend(worldSettings.shape)
  .strict();
const key = "greece-battleground.preferences.v1";
export function preferences() {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return schema.parse({ name: "Guest", motion: "system" });
  }
}
export function savePreferences(input: unknown) {
  const parsed = schema.parse(input);
  localStorage.setItem(key, JSON.stringify(parsed));
  dispatchEvent(new Event("preferenceschange"));
  return parsed;
}
