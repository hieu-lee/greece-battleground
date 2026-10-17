import { z } from "zod";

export const clanId = z.enum(["stag", "raven"]);
type Stat = "drachma" | "insight" | "health" | "ward" | "damage" | "reroll";
type Progression = {
  stat: Stat;
  values: readonly [number, number, number];
  percent?: true;
};
type Skill = {
  id: string;
  name: string;
  icon: string;
  parts: readonly (string | Progression)[];
};
type Clan = {
  name: string;
  chief: string;
  portrait: string;
  crest: string;
  motto: string;
  affinity: string;
  structures: readonly [string, string];
  skills: readonly [Skill, Skill, Skill];
};
export const statNames: Record<Stat, string> = {
  drachma: "Drachmas",
  insight: "Insight",
  health: "Health",
  ward: "Ward",
  damage: "Damage",
  reroll: "free shop rerolls",
};

export const clans = {
  stag: {
    name: "Athens",
    chief: "Aegeus",
    portrait: "aegeus",
    crest: "athens",
    motto: "A polis built to endure.",
    affinity: "Apollo",
    structures: ["Hall of Rhapsodes", "Throne of Zeus"],
    skills: [
      {
        id: "inspiring-architecture",
        name: "Civic Splendour",
        icon: "civic-splendour",
        parts: [
          "Each round, gain ",
          { stat: "drachma", values: [1, 1, 2] },
          " and ",
          { stat: "insight", values: [0, 1, 1] },
          " for each level 3 structure you own.",
        ],
      },
      {
        id: "extra-supplies",
        name: "Agora Supplies",
        icon: "agora-supplies",
        parts: ["Gain ", { stat: "reroll", values: [1, 2, 3] }, " per round."],
      },
      {
        id: "valorous-leader",
        name: "King’s Resolve",
        icon: "kings-resolve",
        parts: [
          "Aegeus gains ",
          { stat: "health", values: [6, 12, 18], percent: true },
          " and ",
          { stat: "ward", values: [0, 0, 1] },
          " for each level 3 structure you own.",
        ],
      },
    ],
  },
  raven: {
    name: "Arcadia",
    chief: "Atalanta",
    portrait: "atalanta",
    crest: "arcadia",
    motto: "Follow the trail. Strike with purpose.",
    affinity: "Athena",
    structures: ["Mercenary Camp", "Charon’s Barge"],
    skills: [
      {
        id: "rangers",
        name: "Trailblazers",
        icon: "trailblazers",
        parts: [
          "When you colonize a tile, gain ",
          { stat: "drachma", values: [1, 3, 6] },
          " and ",
          { stat: "insight", values: [1, 3, 6] },
          ".",
        ],
      },
      {
        id: "duelists-cunning",
        name: "Hunter’s Cunning",
        icon: "hunters-cunning",
        parts: [
          "Each time Atalanta critically hits in combat, she gains ",
          { stat: "damage", values: [2, 3, 4] },
          " for each Economy structure.",
        ],
      },
      {
        id: "refined-weaponry",
        name: "Tempered Arms",
        icon: "tempered-arms",
        parts: [
          "Each Unit gains ",
          { stat: "damage", values: [3, 6, 9] },
          " for each adjacent Economy structure.",
        ],
      },
    ],
  },
} satisfies Record<z.infer<typeof clanId>, Clan>;

export function skillText(skill: Skill) {
  return skill.parts
    .map((part) =>
      typeof part === "string"
        ? part
        : `${part.values.map((n) => n + (part.percent ? "%" : "")).join("/")} ${statNames[part.stat]}`,
    )
    .join("");
}

export function skillUpgradeText(skill: Skill, level: 1 | 2 | 3) {
  const current = level === 1 ? 0 : level === 2 ? 1 : 2;
  const next = level === 1 ? 1 : 2;
  return skill.parts
    .map((part) => {
      if (typeof part === "string") return part;
      const suffix = part.percent ? "%" : "";
      const value = `${part.values[current]}${suffix}`;
      return `${level === 3 ? value : `${value} → ${part.values[next]}${suffix}`} ${statNames[part.stat]}`;
    })
    .join("");
}

const key = "greece-battleground.clan.v1";
export function selectedClan() {
  try {
    return clanId.parse(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return "stag";
  }
}
export function saveClan(input: unknown) {
  const id = clanId.parse(input);
  localStorage.setItem(key, JSON.stringify(id));
  return id;
}
