import { appUrl } from "./urls.ts";
import "./tutorial.css";
import type { Command } from "./game.ts";
import type { PlayState } from "./read-model.ts";
import {
  tutorialChapterId,
  tutorialChapters,
  tutorialBlocked,
} from "./tutorial-domain.ts";
import type { TutorialChapterId } from "./tutorial-domain.ts";

// Newly authored Greek copy; the original chapter selectors and delays live in tutorial-domain.
const chapters = {
  welcome: {
    text: "Welcome to Greece. Grow a polis, gather a warband and face the wilderness and rival armies. This campaign introduces the controls as you play. Continue to receive your first round’s income and visit the Agora.",
    icon: "ward",
  },
  structures: {
    text: "Choose an offer in the Agora, then an owned tile to place it. Camps deploy warriors; economic structures support your polis. Inspect a structure to see its costs, troops and effects. Continue when you are ready to visit the Moirai.",
    icon: "damage",
  },
  fate: {
    text: "The Moirai offer a choice each round. Gifts act immediately, Blessings stay with your polis, and Charms attach to an eligible item. Each purchase costs Insight. You may choose one offer, or continue to preparation without buying.",
    icon: "insight",
  },
  preparation: {
    text: "Arrange your structures, assign Villagers and inspect your warband before choosing Ready. Combat then runs automatically. Your first encounter is against the wilderness. Watch the battle or skip its presentation; either choice keeps the same result.",
    icon: "action-speed",
  },
  workers: {
    text: "Villagers turn camps into larger armies. Buy a Villager, select a camp and assign them to deploy more troops. You can also spend an unassigned Villager to claim a bordering tile. Inspect each structure for its deployment limit and worker effects.",
    icon: "villager",
  },
  pvp: {
    text: "This round you face another warband. Your structures and assigned workers determine which troops join your chief. Inspect their strengths and arrange your polis before choosing Ready.",
    icon: "damage",
  },
  "post-battle": {
    text: "The battle result is settled. Ordinary victories add a win; defeats cost a life. Wilderness encounters have their own rewards. Close this chapter, then Continue from the result to move to the next round and receive the next income.",
    icon: "drachma",
  },
  synergies: {
    text: "Structures can strengthen their neighbours or troops that share a role. Inspect an item’s actual effects and the tiles around it, then place your structures to make those connections count.",
    icon: "ward",
  },
  affinity: {
    text: "Your polis builds Favour with Athena, Zeus and Apollo. The Favour display shows your current values and the next unlocks. New Fate collections become available as your affinity grows.",
    icon: "insight",
  },
  upgrades: {
    text: "Place another copy of a structure on its existing tile to improve it when an upgrade is available. The selected structure shows its level, stats and worker capacity. Check the price before committing your Drachmas.",
    icon: "damage",
  },
  seasons: {
    text: "A new season brings a choice of improvement for your polis. Close this chapter to review the available upgrades. The wilderness returns at seasonal encounters, and winter changes the challenges ahead.",
    icon: "ward",
  },
  "second-pve": {
    text: "The wilderness has grown stronger. Review your troop counts and defensive effects before choosing Ready to start the actual battle with your current warband.",
    icon: "damage",
  },
  selling: {
    text: "Sell an owned structure to reshape your polis. Select it and review the return before selling. Its Charm leaves with it, while the territory remains yours. Your Polis Hall stays with your settlement.",
    icon: "drachma",
  },
  ending: {
    text: "You have reached the last introductory chapter. Continue this same campaign to face the remaining encounters, or leave for the menu. Leaving ends and clears this tutorial run; your other saved runs and archives stay available.",
    icon: "ward",
  },
} satisfies Record<TutorialChapterId, { text: string; icon: string }>;

export function createTutorial(
  mount: HTMLElement,
  handlers: {
    act(command: Command): Promise<boolean>;
    leave(): Promise<void>;
  },
) {
  const section = document.createElement("section");
  section.className = "tutorial-panel";
  section.setAttribute("aria-label", "Tutorial campaign");
  section.innerHTML = `<div class="tutorial-stage"><span id="tutorial-stage"></span><button id="tutorial-advance" type="button">Continue</button></div><label class="tutorial-browse">Chapters<select id="tutorial-chapter"><option value="">Browse chapters…</option>${tutorialChapters.map((chapter) => `<option value="${chapter.id}">${chapter.title}</option>`).join("")}</select></label>`;
  mount.append(section);
  const dialog = document.createElement("dialog");
  dialog.id = "tutorial-dialog";
  dialog.className = "tutorial-dialog";
  dialog.setAttribute("aria-labelledby", "tutorial-title");
  dialog.setAttribute("aria-describedby", "tutorial-description");
  dialog.innerHTML = `<div class="tutorial-chapter-heading"><img id="tutorial-icon" alt=""><div><p class="tutorial-eyebrow">Tutorial campaign</p><h2 id="tutorial-title"></h2></div></div><p id="tutorial-description"></p><p id="tutorial-status" role="status" aria-live="polite"></p><div class="tutorial-dialog-actions"><button id="tutorial-close" type="button">Close chapter</button><button id="tutorial-leave" type="button">Leave for menu</button></div>`;
  document.body.append(dialog);
  const advance =
    section.querySelector<HTMLButtonElement>("#tutorial-advance")!;
  const stage = section.querySelector<HTMLElement>("#tutorial-stage")!;
  const select = section.querySelector<HTMLSelectElement>("#tutorial-chapter")!;
  const heading = dialog.querySelector<HTMLElement>("#tutorial-title")!;
  const description = dialog.querySelector<HTMLElement>(
    "#tutorial-description",
  )!;
  const icon = dialog.querySelector<HTMLImageElement>("#tutorial-icon")!;
  const status = dialog.querySelector<HTMLElement>("#tutorial-status")!;
  const close = dialog.querySelector<HTMLButtonElement>("#tutorial-close")!;
  const leave = dialog.querySelector<HTMLButtonElement>("#tutorial-leave")!;
  const actions = dialog.querySelector<HTMLElement>(
    ".tutorial-dialog-actions",
  )!;
  const stageActions = section.querySelector<HTMLElement>(".tutorial-stage")!;
  let current: PlayState | null = null;
  let replayComplete = false;
  let chapterKey = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let opener: HTMLElement | null = null;
  function specialChoice() {
    const chapter = current?.tutorial?.chapter;
    return (
      chapter?.origin === "automatic" &&
      (chapter.id === "welcome" || chapter.id === "ending")
    );
  }
  async function order(command: Command) {
    if (busy) return;
    busy = true;
    advance.disabled = close.disabled = select.disabled = leave.disabled = true;
    try {
      const ok = await handlers.act(command);
      if (!ok)
        status.textContent =
          "That action could not be saved. Reload to recover your campaign.";
    } finally {
      busy = false;
      if (current) refresh(current, replayComplete);
    }
  }
  advance.addEventListener("click", () => void order({ op: "continue" }));
  close.addEventListener("click", () => void order({ op: "tutorial-close" }));
  select.addEventListener("change", () => {
    const id = tutorialChapterId.safeParse(select.value);
    if (id.success) void order({ op: "tutorial-chapter", chapter: id.data });
    select.value = "";
  });
  leave.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    leave.disabled = advance.disabled = true;
    void handlers.leave().catch((error: unknown) => {
      status.textContent =
        error instanceof Error
          ? error.message
          : "Unable to leave. Your saved campaign is preserved.";
      busy = false;
      leave.disabled = advance.disabled = false;
    });
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!specialChoice()) void order({ op: "tutorial-close" });
  });
  // Native dialog owns focus; underlying custom screen traps and Escape handlers must not also run.
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Tab" || event.key === "Escape") event.stopPropagation();
  });
  function hide() {
    if (!dialog.open) return;
    dialog.close();
    if (opener?.isConnected && opener.getClientRects().length) opener.focus();
    opener = null;
  }
  function refresh(game: PlayState, replayDone: boolean) {
    current = game;
    replayComplete = replayDone;
    const guide = game.tutorial;
    const chapter = guide?.chapter;
    const meta = tutorialChapters.find((entry) => entry.id === chapter?.id);
    const canShow = Boolean(
      chapter && (game.phase.kind !== "result" || replayDone),
    );
    const key = canShow
      ? `${game.round}:${guide?.stage}:${chapter?.origin}:${chapter?.id}`
      : "";
    const choice = specialChoice();
    const fateFooter =
      guide?.stage === "fate"
        ? document.querySelector<HTMLElement>(
            ".fate-screen:not([hidden]) footer",
          )
        : null;
    const destination = choice ? actions : (fateFooter ?? stageActions);
    if (advance.parentElement !== destination) destination.append(advance);
    section.hidden = !guide || game.phase.kind !== "prepare";
    stage.textContent = guide
      ? `Round ${game.round} · ${guide.stage === "shop" ? "Agora" : guide.stage === "fate" ? "Fate" : guide.stage === "prepare" ? "Preparation" : "Welcome"}`
      : "";
    advance.hidden =
      !guide ||
      (!choice && (guide.stage === "prepare" || game.phase.kind !== "prepare"));
    advance.disabled = busy || (tutorialBlocked(guide) && !choice);
    close.disabled = leave.disabled = select.disabled = busy;
    close.hidden = Boolean(choice);
    leave.hidden = chapter?.origin !== "automatic" || chapter.id !== "ending";
    advance.textContent =
      chapter?.id === "ending" && choice ? "Continue campaign" : "Continue";
    if (key !== chapterKey) {
      chapterKey = key;
      clearTimeout(timer);
      hide();
      status.textContent = "";
      if (canShow && meta && chapter) {
        heading.textContent = meta.title;
        description.textContent = chapters[chapter.id].text;
        icon.src = appUrl(`/art/icon-${chapters[chapter.id].icon}.webp`);
        const show = () => {
          if (chapterKey !== key) return;
          opener =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          dialog.showModal();
          (choice ? advance : close).focus();
        };
        if (chapter.origin === "automatic" && meta.delay > 0)
          timer = setTimeout(show, meta.delay * 1000);
        else show();
      }
    }
  }
  return {
    refresh,
    destroy() {
      clearTimeout(timer);
      hide();
      dialog.remove();
      section.remove();
    },
  };
}
