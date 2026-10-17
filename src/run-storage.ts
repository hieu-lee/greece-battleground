import { appUrl } from "./urls.ts";
import { newGame, parseGame } from "./game.ts";
import { clanId } from "./clans.ts";
import { saveVersion } from "./rules-version.ts";

export type RunMode = "practice" | "tutorial";
export function runKey(mode: RunMode) {
  return mode === "tutorial"
    ? `greece-battleground.tutorial.v${saveVersion}`
    : `greece-battleground.preparation.v${saveVersion}`;
}
function priorRuns(mode: RunMode) {
  const prefix =
    mode === "tutorial"
      ? "greece-battleground.tutorial"
      : "greece-battleground.preparation";
  const archives: { key: string; encoded: string }[] = [];
  for (let version = saveVersion - 1; version >= 1; version--) {
    const key = `${prefix}.v${version}`;
    const encoded = localStorage.getItem(key);
    if (encoded !== null) archives.push({ key, encoded });
  }
  return archives;
}
export function readRun(mode: RunMode) {
  const archives = priorRuns(mode);
  const encoded = localStorage.getItem(runKey(mode));
  if (encoded === null) return { encoded, game: null, archives, issue: null };
  try {
    const game = parseGame(JSON.parse(encoded));
    if (game.mode !== mode)
      throw new Error("Save mode does not match its slot");
    return {
      encoded,
      game,
      archives,
      issue: null,
    };
  } catch {
    return {
      encoded,
      game: null,
      archives,
      issue:
        "Your saved polis uses incompatible or invalid data. Its bytes are preserved; export it before starting a new run.",
    };
  }
}
export function exportRunArchive(mode: RunMode, key: string) {
  const saved = readRun(mode);
  const archive =
    key === runKey(mode) && saved.issue && saved.encoded !== null
      ? { key, encoded: saved.encoded }
      : saved.archives.find((entry) => entry.key === key);
  return archive
    ? {
        filename: `${archive.key}.json`,
        type: "application/json",
        content: archive.encoded,
      }
    : null;
}
export async function runTag(encoded: string | null) {
  if (encoded === null) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encoded),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function freshRun(input: unknown, mode: RunMode) {
  const clan = clanId.parse(input);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return newGame(seed, clan, mode);
}
export function startRun(
  input: unknown,
  mode: RunMode,
  expected: string | null,
) {
  const game = freshRun(input, mode);
  const key = runKey(mode);
  if (localStorage.getItem(key) !== expected)
    throw new Error(
      "Your saved polis changed. Reload before starting a new one.",
    );
  localStorage.setItem(key, JSON.stringify(game));
  return {
    path: appUrl(mode === "tutorial" ? "/play.html?tutorial=1" : "/play.html"),
    r: game.revision,
  };
}

export function leaveRun(mode: RunMode, expected: string | null) {
  const key = runKey(mode);
  if (localStorage.getItem(key) !== expected)
    throw new Error("Your saved polis changed. Reload before leaving it.");
  localStorage.removeItem(key);
}
