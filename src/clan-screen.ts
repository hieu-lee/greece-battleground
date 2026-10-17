import { appUrl } from "./urls.ts";
import "./fonts.css";
import "./clans.css";
import { z } from "zod";
import {
  clanId,
  clans,
  selectedClan,
  saveClan,
  skillText,
  statNames,
} from "./clans.ts";
import type { Tool } from "./webmcp.ts";
import { readRun, startRun, runTag } from "./run-storage.ts";
import type { RunMode } from "./run-storage.ts";
import { appendRunArchives } from "./run-archive.ts";
import { enterQueue } from "./ranked.ts";
import type { Profile } from "./ranked.ts";
import { preferences } from "./preferences.ts";
import { guestInput } from "./read-model.ts";

const requestedMode = new URL(location.href).searchParams.get("mode");
const mode: RunMode | "async" | "ranked" | null =
  requestedMode === "practice" ||
  requestedMode === "tutorial" ||
  requestedMode === "async" ||
  requestedMode === "ranked"
    ? requestedMode
    : null;
const queue =
  mode === "async" ? "unranked" : mode === "ranked" ? "ranked" : null;
const local = mode === "practice" || mode === "tutorial" ? mode : null;

const rootElement = document.getElementById("app");
if (!rootElement) throw new Error("Missing clan selection root");
const root = rootElement;
root.innerHTML = `<main class="clan-selection"><header class="clan-banner"><img id="crest" alt=""><div><span class="eyebrow">Choose your clan</span><h1 id="clan-name"></h1></div><a class="back" href="${appUrl("/")}">Back to menu</a></header>
<section class="clan-details" aria-labelledby="skills-heading"><h2 id="skills-heading">Clan Skills</h2><p class="tier-note">Values show skill tiers I / II / III.</p><div id="skills"></div><div class="clan-extras"><div><h2>Unique Structures</h2><ul id="structures"></ul></div><div><h2>Starting Affinity</h2><p id="affinity"></p></div></div><button class="play" ${mode ? "" : 'disabled title="Choose Freeplay or Tutorial from the menu"'}>${mode === "tutorial" ? "Begin the lesson" : mode === "async" ? "Enter async PvP" : mode === "ranked" ? "Enter ranked play" : mode ? "Begin Freeplay" : "Play"}</button><p class="development">${mode === "async" ? "Real submitted player warbands · Unranked. Enter resumes your guest polis if one exists in this browser." : mode === "ranked" ? "Real submitted player warbands · Ranked. Your Elo changes when the run ends. Enter resumes a ranked polis in this browser." : mode === "tutorial" ? "Authored campaign opponents and wilderness encounters. Some source rules remain under verification." : mode ? "Practice opponents are simulated. Some source rules remain under verification." : "Clan preview · Choose a mode from the menu to play."}</p></section>
<section class="chief-scene" aria-label="Your chief"><img id="portrait" alt=""><p class="portrait-fallback" hidden>Chief portrait unavailable</p><div class="chief-caption"><span class="eyebrow">Your chief</span><h2 id="chief-name"></h2><p id="motto"></p></div></section>
<nav class="clan-picker" aria-label="Clans">${clanId.options.map((id) => `<button data-clan="${id}" aria-pressed="false"><img src="${appUrl(`/art/icon-${clans[id].crest}.webp`)}" alt="">${clans[id].name}</button>`).join("")}</nav><div class="selection-status"><div id="run-archives"></div><p id="selection-status" role="status" tabindex="-1"></p></div></main><dialog id="replace-run" aria-labelledby="replace-title"><h2 id="replace-title">A new polis</h2><p id="replace-text">Starting a new polis replaces the saved run for this mode. Your other mode stays saved.</p><div><button id="confirm-run">Start a new polis</button><button id="cancel-run">Keep the saved polis</button></div><p id="replace-status" role="status"></p></dialog>`;
function element(id: string) {
  const value = document.getElementById(id);
  if (!value) throw new Error("Missing clan control: " + id);
  return value;
}
const portraitElement = element("portrait");
if (!(portraitElement instanceof HTMLImageElement))
  throw new Error("Missing portrait image");
const portrait = portraitElement;
const fallbackElement = root.querySelector(".portrait-fallback");
if (!(fallbackElement instanceof HTMLElement))
  throw new Error("Missing portrait fallback");
const fallback = fallbackElement;
portrait.addEventListener("error", () => {
  fallback.hidden = false;
  portrait.hidden = true;
});
portrait.addEventListener("load", () => {
  fallback.hidden = true;
  portrait.hidden = false;
});
const buttons = root.querySelectorAll<HTMLButtonElement>("[data-clan]");
function render() {
  const id = selectedClan(),
    clan = clans[id];
  root.setAttribute("data-clan", id);
  element("selection-status").textContent = "";
  element("clan-name").textContent = clan.name;
  element("chief-name").textContent = clan.chief;
  element("motto").textContent = clan.motto;
  element("affinity").textContent = clan.affinity;
  element("crest").setAttribute("src", appUrl(`/art/icon-${clan.crest}.webp`));
  const src = appUrl(`/art/${clan.portrait}.webp`);
  if (portrait.getAttribute("src") !== src) {
    fallback.hidden = true;
    portrait.hidden = false;
    portrait.src = src;
  }
  portrait.alt = `${clan.chief}, chief of ${clan.name}`;
  element("structures").replaceChildren(
    ...clan.structures.map((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      return li;
    }),
  );
  element("skills").replaceChildren(
    ...clan.skills.map((skill) => {
      const card = document.createElement("article"),
        icon = document.createElement("img"),
        content = document.createElement("div"),
        title = document.createElement("h3"),
        description = document.createElement("p");
      card.className = "skill";
      icon.src = appUrl(`/art/icon-${skill.icon}.webp`);
      icon.alt = "";
      title.textContent = skill.name;
      for (const part of skill.parts) {
        if (typeof part === "string") description.append(part);
        else {
          const stat = document.createElement("span"),
            image = document.createElement("img");
          stat.className = `stat ${part.stat}`;
          image.src = appUrl(
            `/art/icon-${part.stat === "reroll" ? "agora-supplies" : part.stat}.webp`,
          );
          image.alt = "";
          stat.append(
            part.values
              .map((n) => n + ("percent" in part && part.percent ? "%" : ""))
              .join("/"),
            image,
            ` ${statNames[part.stat]}`,
          );
          description.append(stat);
        }
      }
      content.append(title, description);
      card.append(icon, content);
      return card;
    }),
  );
  for (const button of buttons)
    button.setAttribute("aria-pressed", String(button.dataset.clan === id));
}
function select(input: unknown) {
  const id = saveClan(input);
  render();
  element("selection-status").textContent = `${clans[id].name} selected.`;
  return { selected: id };
}
for (const button of buttons)
  button.addEventListener("click", () => {
    try {
      select(button.dataset.clan);
    } catch {
      element("selection-status").textContent =
        "Selection could not be saved. Allow browser storage and try again.";
    }
  });
const replaceDialog = element("replace-run");
if (!(replaceDialog instanceof HTMLDialogElement))
  throw new Error("Missing run confirmation");
let replacement: {
  clan: z.infer<typeof clanId>;
  encoded: string | null;
} | null = null;
let decide: ((abandon: boolean) => void) | null = null;
const confirmAbandon = (current: Profile["current"]) =>
  new Promise<boolean>((resolve) => {
    const next = queue === "ranked" ? "ranked" : "unranked";
    const rating = current.queue === "ranked" ? "Ranked" : "Unranked";
    const settlement =
      current.queue === "ranked" || current.round >= 3
        ? `Your committed wins settle your ${rating} Elo and XP. This adds one ${current.queue} game to your profile.`
        : "Leaving before round 3 grants no Unranked Elo or XP.";
    element("replace-title").textContent = `Leave your ${current.queue} polis?`;
    element("replace-text").textContent =
      `Entering ${next} play ends your ${current.queue} polis on round ${current.round}. ${settlement} A pending battle result is not claimed.`;
    element("confirm-run").textContent = `Enter ${next} play`;
    element("cancel-run").textContent = `Keep my ${current.queue} polis`;
    element("replace-status").textContent = "";
    decide = resolve;
    replaceDialog.showModal();
  });
const launch = async (
  clan: z.infer<typeof clanId>,
  expected: string | null,
) => {
  if (!local) throw new Error("Choose a game mode first");
  return startRun(clan, local, expected);
};
if (local) {
  try {
    appendRunArchives(element("run-archives"), local);
  } catch {
    element("run-archives").textContent =
      "Allow browser storage to access your saved archives.";
  }
}
const play = root.querySelector(".play");
if (!(play instanceof HTMLButtonElement))
  throw new Error("Missing clan play control");
play.addEventListener("click", async () => {
  if (!mode || play.disabled) return;
  try {
    if (queue) {
      const status = element("selection-status");
      play.disabled = true;
      status.textContent = "Connecting to your polis…";
      status.focus();
      try {
        const path = await enterQueue(
          queue,
          selectedClan(),
          preferences().name,
          confirmAbandon,
        );
        if (path) location.assign(path);
        else status.textContent = "";
      } finally {
        play.disabled = false;
        if (document.activeElement === status) play.focus();
      }
      return;
    }
    if (!local) return;
    const saved = readRun(local);
    if (saved.encoded !== null) {
      replacement = { clan: selectedClan(), encoded: saved.encoded };
      element("replace-status").textContent = "";
      replaceDialog.showModal();
    } else location.assign((await launch(selectedClan(), saved.encoded)).path);
  } catch (error) {
    element("selection-status").textContent =
      error instanceof Error ? error.message : "Your polis could not be saved.";
  }
});
element("confirm-run").addEventListener("click", async () => {
  if (decide) {
    const accept = decide;
    decide = null;
    replaceDialog.close();
    accept(true);
    return;
  }
  if (!replacement) return;
  try {
    location.assign((await launch(replacement.clan, replacement.encoded)).path);
  } catch (error) {
    element("replace-status").textContent =
      error instanceof Error ? error.message : "Your polis could not be saved.";
  }
});
element("cancel-run").addEventListener("click", () => replaceDialog.close());
replaceDialog.addEventListener("close", () => {
  replacement = null;
  decide?.(false);
  decide = null;
});
render();
addEventListener("pageshow", render);
addEventListener("storage", render);
const inspect = z.object({ details: z.boolean().optional() }).strict();
const action = z.object({ id: clanId }).strict();
const tools: Tool[] = [
  {
    name: "inspect_clans",
    description:
      "Selected clan, mode and available IDs. details=true adds recorded skill tiers. Practice and tutorial modes can start a run; default page is a clan preview.",
    inputSchema: z.toJSONSchema(inspect),
    annotations: { readOnlyHint: true },
    execute: (input) => {
      const { details } = inspect.parse(input),
        selected = selectedClan(),
        clan = clans[selected];
      return {
        selected,
        clans: clanId.options.map((id) => [id, clans[id].name]),
        playable: mode !== null,
        mode,
        ...(details
          ? {
              chief: clan.chief,
              affinity: clan.affinity,
              structures: clan.structures,
              skills: clan.skills.map((skill) => [
                skill.id,
                skill.name,
                skillText(skill),
              ]),
            }
          : {}),
      };
    },
  },
  {
    name: "select_clan",
    description:
      "Save stag (Athens) or raven (Arcadia) locally. Shares the human selection action. Returns only selected ID; does not start a run.",
    inputSchema: z.toJSONSchema(action),
    annotations: { readOnlyHint: false },
    execute: (input) => select(action.parse(input).id),
  },
];
const start = z
  .object({
    replace: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();
if (local)
  tools.push(
    {
      name: "start_run",
      description:
        "Start selected clan using the human save owner; returns play path. An existing save is preserved unless replace matches its exact save tag from inspect_run. Tutorial and practice saves are separate.",
      inputSchema: z.toJSONSchema(start),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        const { replace } = start.parse(input);
        const saved = readRun(local);
        if (saved.encoded !== null && replace !== (await runTag(saved.encoded)))
          return { error: "replacement-required" };
        return launch(selectedClan(), saved.encoded);
      },
    },
    {
      name: "inspect_run",
      description:
        "Saved-run tag, summary and mode for deliberate replacement; no game seed or future offers. Tag includes the whole save, so a different run with the same revision is still protected.",
      inputSchema: z.toJSONSchema(z.object({}).strict()),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        z.object({}).strict().parse(input);
        const saved = readRun(local);
        return {
          mode: local,
          save: await runTag(saved.encoded),
          archives: saved.archives.map((archive) => archive.key),
          issue: saved.issue,
          summary: saved.game
            ? {
                r: saved.game.revision,
                clan: saved.game.clan,
                round: saved.game.round,
                phase: saved.game.phase.kind,
                wins: saved.game.wins,
                lives: saved.game.lives,
              }
            : null,
          path: appUrl(
            local === "tutorial" ? "/play.html?tutorial=1" : "/play.html",
          ),
        };
      },
    },
  );
const enter = z
  .object({
    name: guestInput.shape.name.optional(),
    abandon: z.boolean().optional(),
  })
  .strict();
if (queue)
  tools.push({
    name: "start_run",
    description: `Create a guest polis with the selected clan in the ${queue} queue, or resume the browser guest's ${queue} run. Real asynchronous opponents; the server owns ratings and XP. Switching an unfinished ranked run or a started unranked run needs abandon=true. Ranked runs settle committed wins on abandonment; unranked runs settle from round3. A pending battle result is not claimed. Returns the shared play path.`,
    inputSchema: z.toJSONSchema(enter),
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      const args = enter.parse(input);
      const path = await enterQueue(
        queue,
        selectedClan(),
        args.name ?? preferences().name,
        async () => args.abandon === true,
      );
      return path ? { path } : { error: "abandon-required" };
    },
  });
const controller = new AbortController();
addEventListener("pagehide", (event) => {
  if (!event.persisted) controller.abort();
});
if (document.modelContext) {
  try {
    for (const tool of tools)
      await document.modelContext.registerTool(tool, {
        signal: controller.signal,
      });
  } catch {
    controller.abort();
  }
}
