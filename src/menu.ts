import { accountScreen } from "./account-screen.ts";
import { onAccountChange, accountToken } from "./api.ts";
import { appUrl, crossOriginApi } from "./urls.ts";
import "./fonts.css";
import "./menu.css";
import { z } from "zod";
import { catalogue } from "./scene.ts";
import { createAudio } from "./audio.ts";
import { preferences, savePreferences } from "./preferences.ts";
import type { Tool } from "./webmcp.ts";
import { readRun } from "./run-storage.ts";
import { appendRunArchives } from "./run-archive.ts";
import { rulesVersion, saveVersion } from "./rules-version.ts";
import {
  laurel,
  loadLeaderboard,
  loadProfile,
  profileView,
  rankProgress,
  roman,
  standingsList,
  started,
} from "./ranked.ts";
import type { Profile } from "./ranked.ts";
import { accountRecovery } from "./account-recovery.ts";

const audio = createAudio();
const root = document.getElementById("app");
if (!root) throw new Error("Missing menu root");
root.innerHTML = `<img class="menu-background" alt="" src="${appUrl("/art/main-menu.webp")}" fetchpriority="high">
<main class="main-menu"><section class="menu-left" aria-label="Main menu">
<h1><span>Greece</span>Battleground</h1>
<nav class="menu-buttons" aria-label="Game modes and options">
<button data-panel="ranked">Ranked Play</button>
<button data-panel="freeplay">Freeplay</button><button data-panel="async">Async PvP · Unranked</button>
<button class="menu-gap" id="tutorial">Tutorial</button>
<button data-panel="account" id="menu-account">Account</button><button data-panel="settings">Settings</button><button data-panel="recovery">Account recovery</button><button data-panel="report">Report a Bug</button><button data-panel="exit">Exit</button>
</nav><p class="development-note">Freeplay, guided practice, and ranked and unranked async PvP against real players are available.</p>
<div class="development-links"><a href="/clans.html">Clan selection</a><a href="/play.html">Preparation playtest</a><a href="/workshop.html">Settlement workshop</a><a href="/art-review.html">Art gallery</a><a href="/effects.html">Effects atelier</a></div>
</section><aside class="menu-right" aria-label="Player and rankings">
<button class="profile panel" data-panel="profile" aria-label="Open your profile"><span class="rank-emblem" aria-hidden="true">${laurel}<span class="rank-badge" id="profile-badge">Ω</span></span><span class="profile-details"><strong id="player-name"></strong><span class="rank-track" id="profile-track"><span id="profile-rank">Unranked</span></span><small id="profile-summary">Loading your profile…</small></span></button>
<section class="leaderboard panel" aria-labelledby="board-title"><h2 id="board-title">Leaderboard</h2><div id="board-preview" aria-live="polite"></div><button class="board-more" data-panel="leaderboard">View all standings</button></section>
<section class="panel announcement"><span class="small-title">From the Aegean to Olympus</span><p>Build a polis. Gather a warband.<br>Earn the favour of the gods.</p></section></aside></main>
<footer class="menu-footer"><span title="A community link has not been published">Community · Coming soon</span><button data-panel="report">Feedback</button><small>Greece Battleground · In development</small></footer>
<dialog id="menu-dialog" aria-labelledby="dialog-title"><div class="dialog-heading"><h2 id="dialog-title" tabindex="-1"></h2><button id="close-dialog" aria-label="Close dialog">×</button></div><div id="dialog-body"></div></dialog>`;
const required = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error("Missing menu control: " + id);
  return found;
};
const dialog = required("menu-dialog"),
  body = required("dialog-body"),
  title = required("dialog-title"),
  name = required("player-name"),
  badge = required("profile-badge"),
  track = required("profile-track"),
  rankLabel = required("profile-rank"),
  summary = required("profile-summary"),
  preview = required("board-preview");
if (!(dialog instanceof HTMLDialogElement))
  throw new Error("Missing menu dialog");
const panels = z.enum([
  "ranked",
  "profile",
  "recovery",
  "account",
  "leaderboard",
  "freeplay",
  "async",
  "settings",
  "report",
  "exit",
]);
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const retry = (label: string, again: () => void) => {
  const button = element("button", label, "retry");
  button.type = "button";
  button.addEventListener("click", again);
  return button;
};
// The profile card shows the server's guest; without one, the local name and an invitation.
let profile: Profile | null = null;
function renderCard() {
  const progress = profile ? rankProgress(profile) : null;
  name.textContent = profile?.name ?? preferences().name;
  badge.textContent = profile ? roman(profile.rank.band) : "Ω";
  track.style.setProperty("--fill", String(progress?.fill ?? 0));
  rankLabel.textContent = profile
    ? `Rank ${roman(profile.rank.band)}, ${progress?.short}`
    : "Unranked";
  summary.textContent = !profile
    ? "Enter Ranked Play to earn a rating"
    : profile.rankedGames
      ? `Elo ${profile.elo}, ${profile.rankedGames} ranked ${profile.rankedGames === 1 ? "game" : "games"}${profile.standing ? `, #${profile.standing.rank}` : ""}`
      : "No ranked games played";
}
// Every profile load may write the shared card, but only the newest one does.
let cardRequest = 0;
async function loadCard() {
  const token = ++cardRequest;
  try {
    const loaded = await loadProfile();
    if (token === cardRequest) {
      profile = loaded;
      renderCard();
    }
    return loaded;
  } catch (error) {
    if (token === cardRequest) {
      profile = null;
      renderCard();
      summary.textContent = "Profile unavailable. Open it to retry.";
    }
    throw error;
  }
}
let boardRequest = 0;
async function refreshBoard() {
  const token = ++boardRequest;
  preview.setAttribute("aria-busy", "true");
  preview.replaceChildren(element("p", "Loading standings…", "empty-board"));
  try {
    const board = await loadLeaderboard(1);
    if (token !== boardRequest) return;
    preview.replaceChildren(
      board.rows.length
        ? standingsList(board, "Top ranked players")
        : element(
            "p",
            "No ranked results yet. Finish a ranked run to carve the first name here.",
            "empty-board",
          ),
    );
    if (board.you && board.you.page > 1)
      preview.append(
        element(
          "p",
          `Your standing: #${board.you.rank} of ${board.total}`,
          "own-standing",
        ),
      );
  } catch {
    if (token !== boardRequest) return;
    preview.replaceChildren(
      element("p", "Standings are unavailable.", "empty-board"),
      retry("Retry standings", () => void refreshBoard()),
    );
  } finally {
    if (token === boardRequest) preview.removeAttribute("aria-busy");
  }
}
renderCard();
loadCard().catch(() => {});
void refreshBoard();
addEventListener("pageshow", (event) => {
  renderCard();
  if (event.persisted) {
    loadCard().catch(() => {});
    void refreshBoard();
  }
});
const close = () => {
  audio.silence();
  dialog.close();
};
// Each opening (and each leaderboard page) gets a token; a reply for an older one is dropped.
let opening = 0;
const open = (panel: z.infer<typeof panels>) => {
  const token = ++opening;
  // A request from the previous panel no longer owns the busy state.
  body.removeAttribute("aria-busy");
  audio.silence();
  audio.restore();
  audio.play("select");
  dialog.dataset.panel = panel;
  title.textContent = {
    ranked: "Ranked Play",
    profile: "Your profile",
    recovery: "Guest recovery",
    account: "Your account",
    leaderboard: "Leaderboard",
    settings: "Settings",
    report: "Report a Bug",
    exit: "Exit",
    freeplay: "Freeplay",
    async: "Async PvP · Unranked",
  }[panel];
  if (panel === "account") {
    body.replaceChildren(
      accountScreen(() => {
        loadCard().catch(() => {});
        void refreshBoard();
      }),
    );
  } else if (
    (panel === "ranked" || panel === "async") &&
    crossOriginApi &&
    !accountToken()
  ) {
    body.replaceChildren(
      element("p", "Sign in to keep your online polis across devices."),
      retry("Sign in or create account", () => open("account")),
    );
  } else if (panel === "ranked") {
    body.innerHTML = `<p>Face real players’ submitted warbands. When a ranked run ends, the server sets your new Elo from your wins and your opponents’ ratings, and every finished async run can earn XP.</p><p id="ranked-status" role="status">Checking for your guest polis…</p><div class="mode-links" id="ranked-links"></div><div class="panel-switch"><button type="button" data-open="profile">Your profile</button><button type="button" data-open="leaderboard">Leaderboard</button></div>`;
    const status = document.getElementById("ranked-status"),
      links = document.getElementById("ranked-links");
    const link = (text: string, href: string) => {
      const a = element("a", text, "menu-link");
      a.href = appUrl(href);
      return a;
    };
    loadCard()
      .then((loaded) => {
        if (!status?.isConnected || !links) return;
        const enter = link(
          "Choose a clan and enter ranked play",
          "/clans.html?mode=ranked",
        );
        enter.id = "enter-ranked";
        const current = loaded?.current;
        if (!current) {
          status.textContent =
            "Choose a clan to create your guest polis in the ranked queue.";
          links.replaceChildren(enter);
        } else if (current.queue === "ranked") {
          status.textContent =
            current.phase === "finished"
              ? `Your ranked run ended with ${current.wins} wins. Resume it to found a new ranked polis.`
              : `Your ranked polis: round ${current.round}, ${current.wins} wins, ${current.lives} lives.`;
          const resume = link(
            "Resume your ranked polis",
            "/play.html?mode=async",
          );
          resume.id = "resume-ranked";
          links.replaceChildren(resume);
        } else {
          status.textContent = started(current)
            ? `Entering ranked play ends your unranked polis on round ${current.round}.`
            : "Your next run will be ranked.";
          links.replaceChildren(enter);
        }
      })
      .catch((error: unknown) => {
        if (!status?.isConnected || !links) return;
        status.textContent =
          error instanceof Error ? error.message : "Service unavailable.";
        links.replaceChildren(retry("Retry", () => open("ranked")));
      });
    for (const button of body.querySelectorAll<HTMLButtonElement>(
      "[data-open]",
    ))
      button.addEventListener("click", () =>
        open(panels.parse(button.dataset.open)),
      );
  } else if (panel === "recovery") {
    body.replaceChildren(
      accountRecovery(() => {
        loadCard().catch(() => {});
        void refreshBoard();
      }),
    );
  } else if (panel === "profile") {
    body.replaceChildren(element("p", "Loading your profile…", "loading-note"));
    loadCard()
      .then((loaded) => {
        if (token !== opening) return;
        if (loaded) {
          const manage = retry("Protect or restore your guest", () =>
            open(accountToken() ? "account" : "recovery"),
          );
          manage.id = "manage-recovery";
          body.replaceChildren(profileView(loaded), manage);
        } else {
          const enter = element(
            "a",
            "Choose a clan and enter ranked play",
            "menu-link",
          );
          enter.href = appUrl("/clans.html?mode=ranked");
          body.replaceChildren(
            element(
              "p",
              "This browser has no guest polis yet. Enter ranked play to earn XP and an Elo rating.",
            ),
            enter,
          );
        }
      })
      .catch(() => {
        if (token !== opening) return;
        body.replaceChildren(
          element("p", "Your profile could not be loaded.", "loading-note"),
          retry("Retry", () => open("profile")),
        );
      });
  } else if (panel === "leaderboard") {
    const show = (page: number) => {
      const token = ++opening;
      body.setAttribute("aria-busy", "true");
      const status = element("p", "Loading standings…", "loading-note");
      status.setAttribute("role", "status");
      if (body.contains(document.activeElement)) title.focus();
      body.replaceChildren(status);
      loadLeaderboard(page)
        .then((board) => {
          if (token !== opening) return;
          const pager = element("nav", "", "pager");
          pager.setAttribute("aria-label", "Leaderboard pages");
          const step = (text: string, target: number, enabled: boolean) => {
            const button = element("button", text);
            button.type = "button";
            button.disabled = !enabled;
            button.addEventListener("click", () => show(target));
            return button;
          };
          pager.append(
            step("Previous", board.page - 1, board.page > 1),
            element("span", `Page ${board.page} of ${board.pages}`),
            step("Next", board.page + 1, board.page < board.pages),
          );
          const own = board.you;
          body.replaceChildren(
            board.rows.length
              ? standingsList(board, `Standings, page ${board.page}`)
              : element(
                  "p",
                  board.total
                    ? "This page is past the last standing."
                    : "No ranked results yet. Finish a ranked run to carve the first name here.",
                  "empty-board",
                ),
            pager,
          );
          if (own && own.page !== board.page) {
            const find = step(
              `Show my standing (#${own.rank})`,
              own.page,
              true,
            );
            find.className = "find-me";
            body.append(find);
          }
          body.append(
            element(
              "p",
              "Equal Elo shares a rank; whoever reached it first is listed first.",
              "tie-note",
            ),
          );
        })
        .catch(() => {
          if (token !== opening) return;
          body.replaceChildren(
            element("p", "Standings are unavailable.", "loading-note"),
            retry("Retry", () => show(page)),
          );
        })
        .finally(() => {
          if (token === opening) body.removeAttribute("aria-busy");
        });
    };
    show(1);
  } else if (panel === "async") {
    body.innerHTML = `<p>Face real submitted player warbands. Matchmaking waits for another guest’s warband on the same round. This mode is unranked.</p><p id="async-menu-status" role="status">Checking for your guest polis…</p><div class="mode-links"><a class="menu-link" href="/play.html?mode=async" id="resume-async" hidden>Resume your guest polis</a><a class="menu-link" href="/clans.html?mode=async">Choose a clan / enter async PvP</a></div><p>Your guest identity is saved by this browser. Freeplay and tutorial saves remain separate.</p>`;
    const status = document.getElementById("async-menu-status"),
      resume = document.getElementById("resume-async");
    loadProfile()
      .then((loaded) => {
        if (!status?.isConnected) return;
        status.textContent = loaded
          ? `Welcome back, ${loaded.name}.`
          : "Choose a clan to create your guest polis.";
        if (resume && loaded) {
          resume.hidden = false;
          if (loaded.current.queue === "ranked")
            resume.textContent = "Resume your ranked polis";
        }
      })
      .catch((error: unknown) => {
        if (status?.isConnected)
          status.textContent =
            error instanceof Error ? error.message : "Service unavailable.";
      });
  } else if (panel === "freeplay") {
    body.innerHTML = `<p>Build a polis and play a full practice run against simulated warbands.</p><p id="saved-run"></p><div class="mode-links"><a id="resume-run" class="menu-link" href="/play.html" hidden>Resume your polis</a><a class="menu-link" href="/clans.html?mode=practice">Choose a clan for a new polis</a></div>`;
    const saved = document.getElementById("saved-run"),
      resume = document.getElementById("resume-run");
    try {
      const current = readRun("practice");
      if (current.game) {
        if (saved)
          saved.textContent = `Your saved polis: round ${current.game.round}, ${current.game.wins} wins, ${current.game.lives} lives.`;
        if (resume) resume.hidden = false;
      } else if (saved)
        saved.textContent =
          current.issue ??
          (current.archives.length
            ? "Your previous-rules polis is preserved. Download its archive or choose a clan to begin under the current rules."
            : "Choose Athens or Arcadia to begin.");
      appendRunArchives(body, "practice");
    } catch {
      if (saved)
        saved.textContent = "Allow browser storage to save your polis.";
    }
  } else if (panel === "settings") {
    body.innerHTML = `<form id="settings-form"><label>Local player name<input name="name" required maxlength="24" autocomplete="off"></label><label>Animation<select name="motion"><option value="system">Follow device preference</option><option value="reduce">Reduce motion</option></select></label><fieldset><legend>Sound</legend><label>Master volume <output id="master-value"></output><input type="range" name="master" min="0" max="100" step="1"></label><label>Effects volume <output id="effects-value"></output><input type="range" name="effects" min="0" max="100" step="1"></label><label>Music volume <output id="music-value"></output><input type="range" name="music" min="0" max="100" step="1"></label><label class="check"><input type="checkbox" name="muted">Mute all sound</label><button type="button" id="sound-preview">Preview sound</button><p id="audio-status" role="status"></p></fieldset><fieldset><legend>Video</legend><label>Render resolution<select name="resolution"><option value="auto">Auto</option><option value="lower">Lower (1×)</option></select></label></fieldset><fieldset><legend>Input</legend><label>Camera pan speed <output id="pan-speed-value"></output><input type="range" name="panSpeed" min="0.5" max="2" step="0.1"></label><label class="check"><input type="checkbox" name="reverseWheel">Reverse mouse-wheel zoom</label><p>Pan speed changes drag and keyboard movement. Touch pinch keeps its natural direction.</p></fieldset><p>Your name and settings are saved in this browser.</p><button type="submit">Save settings</button><p id="form-status" role="status"></p></form>`;
    const form = document.getElementById("settings-form");
    if (!(form instanceof HTMLFormElement))
      throw new Error("Missing settings form");
    const input = form.elements.namedItem("name"),
      motion = form.elements.namedItem("motion");
    if (
      !(input instanceof HTMLInputElement) ||
      !(motion instanceof HTMLSelectElement)
    )
      throw new Error("Missing settings field");
    const current = preferences();
    input.value = current.name;
    motion.value = current.motion;
    const resolution = form.elements.namedItem("resolution"),
      panSpeed = form.elements.namedItem("panSpeed"),
      reverseWheel = form.elements.namedItem("reverseWheel");
    if (
      !(resolution instanceof HTMLSelectElement) ||
      !(panSpeed instanceof HTMLInputElement) ||
      !(reverseWheel instanceof HTMLInputElement)
    )
      throw new Error("Missing video/input control");
    resolution.value = current.resolution;
    panSpeed.value = String(current.panSpeed);
    const panValue = form.querySelector("#pan-speed-value")!;
    const showPanSpeed = () => {
      panValue.textContent = Number(panSpeed.value).toFixed(1) + "×";
    };
    showPanSpeed();
    panSpeed.addEventListener("input", showPanSpeed);
    reverseWheel.checked = current.reverseWheel;
    const levels = new Map<string, HTMLInputElement>();
    for (const id of ["master", "effects", "music"] satisfies (
      "master" | "effects" | "music"
    )[]) {
      const slider = form.elements.namedItem(id);
      const label = document.getElementById(id + "-value");
      if (!(slider instanceof HTMLInputElement) || !label)
        throw new Error("Missing audio control");
      slider.value = String(Math.round(current[id] * 100));
      label.textContent = slider.value + "%";
      slider.addEventListener("input", () => {
        label.textContent = slider.value + "%";
      });
      levels.set(id, slider);
    }
    const mute = form.elements.namedItem("muted");
    if (!(mute instanceof HTMLInputElement))
      throw new Error("Missing mute control");
    mute.checked = current.muted;
    const soundValues = () => ({
      master: Number(levels.get("master")?.value) / 100,
      effects: Number(levels.get("effects")?.value) / 100,
      music: Number(levels.get("music")?.value) / 100,
      muted: mute.checked,
    });
    for (const slider of levels.values())
      slider.addEventListener("input", () => audio.setLevels(soundValues()));
    mute.addEventListener("change", () => audio.setLevels(soundValues()));
    document.getElementById("sound-preview")?.addEventListener("click", () => {
      if (!dialog.open || !form.isConnected || document.hidden) return;
      audio.setLevels(soundValues());
      audio.play("fate");
      const status = document.getElementById("audio-status");
      if (status)
        status.textContent =
          audio.status.failure ??
          (audio.status.muted
            ? "Sound is muted. Clear Mute all sound to preview."
            : "Preview uses these volume settings. Save to keep your changes.");
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        savePreferences({
          ...preferences(),
          name: input.value,
          motion: motion.value,
          resolution: resolution.value,
          panSpeed: Number(panSpeed.value),
          reverseWheel: reverseWheel.checked,
          ...soundValues(),
        });
        renderCard();
        close();
      } catch {
        const status = document.getElementById("form-status");
        if (status)
          status.textContent =
            "Settings could not be saved. Use a name of 1–24 characters and allow browser storage.";
      }
    });
  } else if (panel === "report") {
    body.innerHTML = `<form id="report-form"><label>What happened?<textarea name="description" required maxlength="2000" rows="6" placeholder="What you were doing, what went wrong, and what you expected."></textarea></label><p>Prepare a report to review before sharing. It includes your description, loaded client bundle, rules/save versions, browser, viewport and browser motion preference. It does not include your profile, saved game, cookies or account details.</p><button type="submit">Prepare report</button><p id="form-status" role="status"></p></form>
<section id="report-preview" hidden aria-label="Report preview"><h3>Review your report</h3><pre tabindex="0" aria-label="Report contents"></pre><p id="report-handoff"></p><p>Submit the draft on GitHub to publish an issue. This private repository requires a GitHub account with repository access. Without access, download the JSON and share it with the developer through your existing contact.</p><a class="menu-link" id="report-github" target="_blank" rel="noopener noreferrer">Review on GitHub</a><button type="button" id="download-report">Download JSON</button></section>`;
    const form = document.getElementById("report-form");
    if (!(form instanceof HTMLFormElement))
      throw new Error("Missing report form");
    const preview = required("report-preview");
    const contents = preview.querySelector("pre")!;
    const github = required("report-github");
    if (!(github instanceof HTMLAnchorElement))
      throw new Error("Missing report destination");
    form.addEventListener("input", () => {
      preview.hidden = true;
      contents.textContent = "";
      github.removeAttribute("href");
      required("form-status").textContent = "";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const description = new FormData(form).get("description");
      const parsed = z.string().trim().min(1).max(2000).safeParse(description);
      const status = document.getElementById("form-status");
      if (!parsed.success) {
        preview.hidden = true;
        github.removeAttribute("href");
        if (status)
          status.textContent = "Describe the issue in 1–2000 characters.";
        return;
      }
      const report = {
        game: "Greece Battleground",
        description: parsed.data,
        diagnostics: {
          entry: new URL(import.meta.url).pathname,
          rules: rulesVersion,
          save: saveVersion,
          browser: navigator.userAgent,
          viewport: { width: innerWidth, height: innerHeight },
          pixelRatio: devicePixelRatio,
          motion: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "reduce"
            : "full",
        },
      };
      contents.textContent = JSON.stringify(report, null, 2);
      const destination = new URL(
        "https://github.com/hieu-lee/greece-battleground/issues/new",
      );
      destination.searchParams.set("title", "Bug report: Greece Battleground");
      destination.searchParams.set(
        "body",
        "```json\n" + contents.textContent + "\n```",
      );
      const handoff = required("report-handoff");
      if (destination.href.length > 7000) {
        destination.searchParams.set(
          "body",
          "Paste the complete contents of your reviewed greece-battleground-report.json file here before submitting this issue.",
        );
        handoff.textContent =
          "This report is too long for a draft URL. Download JSON, open the GitHub draft, then paste the complete JSON contents into it. The draft link does not include your report.";
      } else {
        handoff.textContent =
          "Opening the draft sends the description and diagnostics shown here to GitHub. Nothing is sent until you choose that link.";
      }
      github.href = destination.href;
      preview.hidden = false;
      if (status)
        status.textContent = "Report prepared. Review it before sharing.";
      contents.focus();
    });
    required("download-report").addEventListener("click", () => {
      if (preview.hidden) return;
      const url = URL.createObjectURL(
        new Blob([contents.textContent ?? ""], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "greece-battleground-report.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      required("form-status").textContent =
        "Report downloaded. Nothing was sent. Share it through your existing developer contact.";
    });
  } else {
    body.innerHTML = `<p>You can close this browser tab. Your settlement workshop is saved locally.</p><button id="return-menu">Return to menu</button>`;
    document.getElementById("return-menu")?.addEventListener("click", close);
  }
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'))
    link.href = appUrl(link.getAttribute("href")!);
  if (!dialog.open) dialog.showModal();
  else title.focus();
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-panel]",
)) {
  button.addEventListener("click", () =>
    open(panels.parse(button.dataset.panel)),
  );
}
document.getElementById("close-dialog")?.addEventListener("click", close);
document.getElementById("tutorial")?.addEventListener("click", () => {
  location.assign(appUrl("/clans.html?mode=tutorial"));
});
dialog.addEventListener("close", () => {
  opening++;
  if (dialog.dataset.panel === "recovery" || dialog.dataset.panel === "account")
    body.replaceChildren();
  body.removeAttribute("aria-busy");
  audio.restore();
  delete dialog.dataset.panel;
});
dialog.addEventListener("cancel", () => audio.silence());
const controller = new AbortController();
addEventListener("pagehide", (event) => {
  if (
    dialog.dataset.panel === "recovery" ||
    dialog.dataset.panel === "account"
  ) {
    body.replaceChildren();
    dialog.close();
  }
  if (!event.persisted) controller.abort();
});
const inspect = z.object({}).strict();
const action = z.object({ panel: panels }).strict();
const tools: Tool[] = [
  {
    name: "inspect_menu",
    description:
      "Main menu, local settings and available modes. Freeplay uses simulated practice opponents. Tutorial uses authored source armies and wilderness encounters. Ranked and unranked async PvP use submitted player warbands, and the server scores completed runs.",
    inputSchema: z.toJSONSchema(inspect),
    annotations: { readOnlyHint: true },
    execute: (input) => {
      inspect.parse(input);
      return {
        mode: "main-menu",
        panel: dialog.open ? title.textContent : null,
        paths: {
          clans: appUrl("/clans.html"),
          playtest: appUrl("/play.html"),
          workshop: appUrl("/workshop.html"),
          art: appUrl("/art-review.html"),
          freeplay: appUrl("/clans.html?mode=practice"),
          tutorial: appUrl("/clans.html?mode=tutorial"),
          async: appUrl("/clans.html?mode=async"),
          ranked: appUrl("/clans.html?mode=ranked"),
        },
        panels: panels.options,
        name: name.textContent,
        sound: audio.status,
        unavailable: [],
        profile: profile
          ? {
              elo: profile.elo,
              freeplayElo: profile.freeplayElo,
              freeplayGames: profile.freeplayGames,
              league: profile.league,
              xp: profile.xp,
              rank: profile.rank.band,
              rankedGames: profile.rankedGames,
            }
          : null,
      };
    },
  },
  {
    name: "open_menu",
    description:
      "Open Ranked Play, the profile, the leaderboard, Freeplay, settings, reviewed GitHub bug-report draft and JSON export, or browser exit guidance. Uses the human menu owner.",
    inputSchema: z.toJSONSchema(action),
    annotations: { readOnlyHint: false },
    execute: (input) => {
      const { panel } = action.parse(input);
      open(panel);
      return { panel };
    },
  },
];
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
try {
  const background = (await catalogue()).find(
    (entry) => entry.kind === "background" && entry.id === "main-menu",
  );
  const image = document.querySelector(".menu-background");
  if (!background || !(image instanceof HTMLImageElement))
    throw new Error("Missing background");
  await image.decode();
  if (
    image.naturalWidth !== background.width ||
    image.naturalHeight !== background.height
  )
    throw new Error("Invalid background dimensions");
} catch {
  root.classList.add("background-unavailable");
}

onAccountChange((external) => {
  cardRequest++;
  boardRequest++;
  if (external && dialog.open) open("account");
  profile = null;
  renderCard();
  loadCard().catch(() => {});
  void refreshBoard();
});
for (const link of document.querySelectorAll<HTMLAnchorElement>(
  '.development-links a[href^="/"]',
))
  link.href = appUrl(link.getAttribute("href")!);
