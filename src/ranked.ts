import { apiFetch } from "./api.ts";
import { appUrl } from "./urls.ts";
// Ranked profile, standings and queue entry. The server owns every rating and XP value;
// this module only reads them and asks the server to start a run in a queue.
import { z } from "zod";
import { clanId } from "./clans.ts";
import { guestRun } from "./play-session.ts";

export const queueId = z.enum(["unranked", "ranked"]);
export type Queue = z.infer<typeof queueId>;
const count = z.number().int().nonnegative();
const rank = z
  .object({ band: count.min(1).max(8), floor: count, next: count })
  .strict();
const profileSchema = z
  .object({
    name: z.string(),
    elo: count,
    freeplayElo: count,
    freeplayGames: count,
    league: z.object({ band: count.min(1), tier: count.min(1) }).strict(),
    xp: count,
    rank,
    rankedGames: count,
    standing: z.object({ rank: count, position: count }).strict().nullable(),
    current: z
      .object({
        r: count,
        queue: queueId,
        round: count,
        phase: z.enum(["prepare", "result", "season", "finished"]),
        wins: count,
        lives: count,
      })
      .strict(),
    history: z.array(
      z
        .object({
          queue: queueId,
          wins: count,
          outcome: z.string(),
          xp: count,
          elo: z
            .object({
              before: count,
              change: z.number().int(),
              after: count,
              k: count,
              opponent: z.number(),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const leaderboardSchema = z
  .object({
    page: count.min(1),
    pageSize: count.min(1),
    total: count,
    pages: count.min(1),
    rows: z.array(
      z
        .object({
          rank: count,
          position: count,
          name: z.string(),
          elo: count,
          xp: count,
          band: count.min(1).max(8),
          games: count,
          you: z.boolean(),
        })
        .strict(),
    ),
    you: z
      .object({ rank: count, position: count, page: count.min(1) })
      .strict()
      .nullable(),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
export type Leaderboard = z.infer<typeof leaderboardSchema>;
const unavailable = "The ranked service is unavailable. Try again.";

async function read(path: string): Promise<unknown> {
  const reply = await apiFetch(path, { credentials: "same-origin" }).catch(
    () => null,
  );
  if (!reply?.ok) throw new Error(unavailable);
  return reply.json();
}
/** The browser guest's profile, or null when this browser has no guest yet. */
export async function loadProfile() {
  return z
    .object({ profile: profileSchema.nullable() })
    .strict()
    .parse(await read("/api/profile")).profile;
}
export async function loadLeaderboard(page = 1) {
  return leaderboardSchema.parse(await read("/api/leaderboard?page=" + page));
}

/** A run counts as started once it has fought, or is fighting, its first battle. */
export const started = (current: Profile["current"]) =>
  current.phase !== "finished" &&
  (current.round > 1 || current.phase !== "prepare");

/**
 * Creates the guest in `queue`, resumes a run already in it, or starts a fresh run there.
 * Returns null when the player declines to settle an unfinished run.
 */
export async function enterQueue(
  queue: Queue,
  clan: z.infer<typeof clanId>,
  name: string,
  confirmAbandon: (current: Profile["current"]) => Promise<boolean>,
) {
  const path = appUrl("/play.html?mode=async");
  // The queue change names this guest, so a guest switched in another tab is refused.
  const guest = await guestRun(clan, name, queue);
  const profile = await loadProfile();
  if (!profile) throw new Error(unavailable);
  const { current } = profile;
  if (current.queue === queue) return path;
  if (
    ((current.queue === "ranked" && current.phase !== "finished") ||
      started(current)) &&
    !(await confirmAbandon(current))
  )
    return null;
  const reply = await apiFetch("/api/game/queue", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      revision: current.r,
      queue,
      clan,
      guestId: guest.id,
    }),
  }).catch(() => null);
  if (reply?.ok) return path;
  const error = reply
    ? z
        .object({ error: z.string() })
        .catch({ error: "" })
        .parse(await reply.json().catch(() => ({}))).error
    : "";
  throw new Error(
    error === "waiting"
      ? "Your polis is waiting for an opponent. Open it and cancel the search first."
      : error === "stale"
        ? "Your polis changed in another tab. Try again."
        : error === "guest-changed"
          ? "Your browser guest changed in another tab. Reload and try again."
          : unavailable,
  );
}

// Source rank names are unresolved localisation keys, so bands are numbered.
export const roman = (band: number) =>
  ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][band - 1] ?? String(band);
export function rankProgress({ xp, rank }: Pick<Profile, "xp" | "rank">) {
  const terminal = rank.next === rank.floor;
  return {
    fill: terminal ? 1 : (xp - rank.floor) / (rank.next - rank.floor),
    text: terminal
      ? `Rank ${roman(rank.band)}, ${xp} XP, highest rank`
      : `Rank ${roman(rank.band)}, ${xp - rank.floor} of ${rank.next - rank.floor} XP to the next rank`,
    short: terminal
      ? `${xp} XP`
      : `${xp - rank.floor}/${rank.next - rank.floor} XP`,
  };
}

// A laurel wreath around the rank shield: two mirrored branches of leaves on an arc.
// ponytail: one wreath for every band; source rank icons are unresolved sprite references.
const leaves = Array.from({ length: 14 }, (_, i) => {
  const theta = ((258 - Math.floor(i / 2) * 18) * Math.PI) / 180;
  const side = i % 2 ? 1 : -1; // alternate outside and inside the stem
  const r = 38 + side * 4;
  const x = 50 + r * Math.cos(theta),
    y = 50 - r * Math.sin(theta);
  // Screen-space heading of the stem as it climbs, turned outward or inward.
  const heading =
    (Math.atan2(Math.cos(theta), Math.sin(theta)) * 180) / Math.PI;
  return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="6.5" ry="2.6" transform="rotate(${(heading - side * 28).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
}).join("");
const branch = `<path d="M45 88 A38 38 0 0 1 25 22" fill="none" stroke-width="1.6"/>${leaves}`;
export const laurel = `<svg class="laurel" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g>${branch}</g><g transform="matrix(-1 0 0 1 100 0)">${branch}</g></svg>`;
export function rankEmblem(label: string) {
  const emblem = node("span", "rank-emblem");
  emblem.setAttribute("aria-hidden", "true");
  emblem.innerHTML = laurel;
  emblem.append(node("span", "rank-badge", label));
  return emblem;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** A standings table; names are player-chosen, so they only ever enter text nodes. */
export function standingsList(board: Leaderboard, label: string) {
  const table = node("table", "standings");
  table.append(node("caption", "sr-only", label));
  const head = node("tr");
  for (const [text, title] of [
    ["#", "Leaderboard position"],
    ["Player", ""],
    ["Rank", "Rank from XP"],
    ["Elo", "Ranked rating"],
  ] as const) {
    const cell = node("th", "", text);
    cell.scope = "col";
    if (title) cell.title = title;
    head.append(cell);
  }
  table.append(node("thead"), node("tbody"));
  table.tHead?.append(head);
  for (const row of board.rows) {
    const item = node("tr", row.you ? "standing you" : "standing");
    if (row.you) item.setAttribute("aria-current", "true");
    const name = node("td", "standing-name", row.name);
    if (row.you) name.append(node("em", "", "You"));
    const band = node("td", "standing-band", roman(row.band));
    band.title = `${row.xp} XP`;
    const elo = node("td", "standing-elo", String(row.elo));
    elo.title = `${row.games} ranked ${row.games === 1 ? "game" : "games"}`;
    const rank = node("td", "standing-rank");
    const medal = node("span", "", String(row.rank));
    if (row.rank <= 3) medal.dataset.medal = String(row.rank);
    rank.append(medal);
    item.append(rank, name, band, elo);
    table.tBodies[0]?.append(item);
  }
  return table;
}

const outcomes: Record<string, string> = {
  victory: "Victory",
  defeat: "Defeat",
  abandoned: "Run abandoned",
  "round-limit": "Campaign complete",
};
export function profileView(profile: Profile) {
  const view = node("div", "profile-view");
  const progress = rankProgress(profile);
  const header = node("div", "profile-head");
  const badge = rankEmblem(roman(profile.rank.band));
  const who = node("div");
  who.append(node("strong", "", profile.name), node("span", "", progress.text));
  header.append(badge, who);
  const bar = node("div", "xp-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", progress.text);
  bar.style.setProperty("--fill", String(progress.fill));
  const stats = node("dl", "profile-stats");
  for (const [term, value] of [
    ["Ranked Elo", String(profile.elo)],
    ["Unranked Elo", String(profile.freeplayElo)],
    ["Ranked games", String(profile.rankedGames)],
    ["Unranked games", String(profile.freeplayGames)],
    ["League", String(profile.league.band)],
    ["Tier", String(profile.league.tier)],
    ["Standing", profile.standing ? `#${profile.standing.rank}` : "Unplaced"],
    ["XP", String(profile.xp)],
  ]) {
    const group = node("div");
    group.append(node("dt", "", term), node("dd", "", value));
    stats.append(group);
  }
  const { current } = profile;
  const run = node(
    "p",
    "profile-run",
    current.phase === "finished"
      ? `Your ${current.queue} run has ended with ${current.wins} wins.`
      : `Your ${current.queue} run: round ${current.round}, ${current.wins} wins, ${current.lives} lives.`,
  );
  const history = node("ol", "profile-history");
  history.setAttribute("aria-label", "Recent results");
  for (const entry of profile.history) {
    const item = node("li");
    const change = node(
      "span",
      "history-change",
      (entry.elo
        ? `${entry.queue === "ranked" ? "Ranked" : "Unranked"} Elo ${entry.elo.before} to ${entry.elo.after} (${entry.elo.change > 0 ? "+" : ""}${entry.elo.change}${entry.elo.after === entry.elo.before + entry.elo.change ? "" : ", floor 0"}), `
        : "") + `XP +${entry.xp}`,
    );
    if ((entry.elo?.after ?? 0) > (entry.elo?.before ?? 0) || entry.xp > 0)
      change.dataset.trend = "up";
    item.append(
      node(
        "span",
        "",
        `${entry.queue === "ranked" ? "Ranked" : "Unranked"}: ${entry.wins} wins, ${outcomes[entry.outcome] ?? entry.outcome}`,
      ),
      change,
    );
    history.append(item);
  }
  view.append(header, bar, stats, run, node("h3", "", "Recent results"));
  view.append(
    profile.history.length
      ? history
      : node(
          "p",
          "",
          "No settled async runs yet. Ranked and unranked runs have separate Elo ratings.",
        ),
  );
  return view;
}
