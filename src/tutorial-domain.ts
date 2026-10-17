import { z } from "zod";
import { fateId } from "./rules.ts";

export const tutorialChapterId = z.enum([
  "welcome",
  "structures",
  "fate",
  "preparation",
  "workers",
  "pvp",
  "post-battle",
  "synergies",
  "affinity",
  "upgrades",
  "seasons",
  "second-pve",
  "selling",
  "ending",
]);
export type TutorialChapterId = z.infer<typeof tutorialChapterId>;
export const publicTutorial = z
  .object({
    stage: z.enum(["welcome", "shop", "fate", "prepare"]),
    chapter: z
      .object({
        id: tutorialChapterId,
        origin: z.enum(["automatic", "manual"]),
      })
      .strict()
      .nullable(),
    postBattleShown: z.boolean(),
    ending: z.enum(["none", "continued"]),
  })
  .strict();
export const tutorialState = publicTutorial
  .extend({
    previousFate: z.array(fateId).max(3),
    shopCursors: z.tuple([
      z.number().int().min(0).max(3),
      z.number().int().min(0).max(3),
    ]),
  })
  .strict();
export type TutorialGuide = z.infer<typeof publicTutorial>;

// Original phase selectors and delays, evidence/tutorial-contract-2026-10-16.
export const tutorialChapters = [
  {
    id: "welcome",
    title: "Welcome to your polis",
    round: 1,
    stage: "welcome",
    delay: 0,
    blocking: true,
  },
  {
    id: "structures",
    title: "Build your warband",
    round: 1,
    stage: "shop",
    delay: Math.fround(0.1),
    blocking: false,
  },
  {
    id: "fate",
    title: "Meet the Moirai",
    round: 1,
    stage: "fate",
    delay: 1.5,
    blocking: false,
  },
  {
    id: "preparation",
    title: "Prepare for battle",
    round: 1,
    stage: "prepare",
    delay: 2,
    blocking: false,
  },
  {
    id: "workers",
    title: "Villagers and deployment",
    round: 2,
    stage: "shop",
    delay: 0,
    blocking: true,
  },
  {
    id: "pvp",
    title: "Face another warband",
    round: 2,
    stage: "prepare",
    delay: 2,
    blocking: false,
  },
  {
    id: "post-battle",
    title: "After the battle",
    round: 2,
    stage: "result",
    delay: 0,
    blocking: true,
  },
  {
    id: "synergies",
    title: "Build synergies",
    round: 3,
    stage: "shop",
    delay: 0,
    blocking: true,
  },
  {
    id: "affinity",
    title: "Divine affinity",
    round: 3,
    stage: "prepare",
    delay: 0,
    blocking: true,
  },
  {
    id: "upgrades",
    title: "Improve structures",
    round: 4,
    stage: "shop",
    delay: 0,
    blocking: true,
  },
  {
    id: "seasons",
    title: "A new season",
    round: 5,
    stage: "welcome",
    delay: 0,
    blocking: true,
  },
  {
    id: "second-pve",
    title: "A stronger wilderness",
    round: 5,
    stage: "prepare",
    delay: 2,
    blocking: false,
  },
  {
    id: "selling",
    title: "Reshape your polis",
    round: 6,
    stage: "shop",
    delay: 0,
    blocking: true,
  },
  {
    id: "ending",
    title: "Continue your campaign",
    round: 7,
    stage: "shop",
    delay: 0,
    blocking: true,
  },
] as const satisfies readonly {
  id: TutorialChapterId;
  title: string;
  round: number;
  stage: TutorialGuide["stage"] | "result";
  delay: number;
  blocking: boolean;
}[];

export function tutorialChapter(
  round: number,
  stage: TutorialGuide["stage"] | "result",
) {
  const chapter = tutorialChapters.find(
    (entry) => entry.round === round && entry.stage === stage,
  );
  return chapter ? { id: chapter.id, origin: "automatic" as const } : null;
}
export function tutorialBlocked(guide: TutorialGuide | null) {
  return Boolean(
    guide?.chapter &&
    (guide.chapter.origin === "manual" ||
      tutorialChapters.find((entry) => entry.id === guide.chapter?.id)
        ?.blocking),
  );
}
