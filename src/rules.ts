import { z } from "zod";
import type { Feature, Terrain } from "./map.ts";
import { sourceItems } from "./source-numbers.ts";
import { fateSource } from "./fate-source.ts";

// Polis Hall, then the 39 shared shop items in serialized AllShopItemData order, then the clan
// uniques (Stag: Hall of Rhapsodes, Throne of Zeus; Raven: Misthophoros Camp, Charon's Barge).
// Ids are Greek model families; native names and GUIDs live in sourceItems (docs/SHOP-CATALOGUE.md).
export const buildingId = z.enum([
  "polis-hall",
  "altar-of-kings",
  "forge",
  "javelin-camp",
  "apollo-fountain",
  "iris-bridge",
  "brewery",
  "sacred-fire",
  "defense-tower",
  "tombs-of-erebus",
  "farm",
  "gate-of-hades",
  "gate-of-etna",
  "healers-hut",
  "tritons-conch",
  "altar-of-olympus",
  "house",
  "hunters-lodge",
  "gigantes-camp",
  "dactyl-camp",
  "agora",
  "menders-hut",
  "spring-of-mnemosyne",
  "silver-mine",
  "thunderbolt-of-zeus",
  "pit-of-tartarus",
  "offering-well",
  "scout-camp",
  "sentry-camp",
  "sheepfold",
  "shield-camp",
  "skull-of-typhon",
  "archer-camp",
  "hephaestus-forge",
  "spear-camp",
  "watchtower",
  "wolf-den",
  "woodcutter",
  "drakon-nest",
  "hesperides-tree",
  "hall-of-rhapsodes",
  "throne-of-zeus",
  "misthophoros-camp",
  "charons-barge",
]);
export type BuildingId = z.infer<typeof buildingId>;
export type ShopBuildingId = Exclude<BuildingId, "polis-hall">;
export const tag = z.enum([
  "civilian",
  "economy",
  "knowledge",
  "divine",
  "melee",
  "ranged",
  "warband",
  "unit",
  "healer",
  "warchief",
  "banner-hall",
  "mercenary",
  "support",
  "tower",
  "mythical",
  "sacrificial",
  "nature",
  "beast",
  "terrain",
]);
export type Tag = z.infer<typeof tag>;
// Map items are real source ItemInstances with these tags (installed catalogue.json).
export const featureTags = {
  mountain: ["nature", "terrain"],
  forest: ["nature", "support", "terrain"],
  "circle-of-stone": ["knowledge", "divine"],
} as const satisfies Record<Feature, readonly Tag[]>;
export const rarity = z.enum([
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
]);
export type Rarity = z.infer<typeof rarity>;
export const levelCaps = { building: 3, hall: 4, skill: 3 } as const;
export const level = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(levelCaps.building),
]);
export const troopId = z.enum([
  "hoplite",
  "tracker",
  "peltast",
  "hypaspist",
  "peripolos",
  "misthophoros",
  "spartoi",
  "erinys",
  "fire-titan",
  "rhapsode",
  "asclepiad",
  "elysian-champion",
  "shade",
  "cyclops",
  "dactyl",
  "battle-physician",
  "boreal-giant",
  "drakon-colossus",
  "arcadian-wolf",
  "drakon",
]);
export type TroopId = z.infer<typeof troopId>;
export const troopNames = {
  hoplite: "Hoplite",
  tracker: "Tracker",
  peltast: "Peltast",
  hypaspist: "Hypaspist",
  peripolos: "Peripolos",
  misthophoros: "Misthophoros",
  spartoi: "Spartoi",
  erinys: "Erinys",
  "fire-titan": "Fire Titan",
  rhapsode: "Rhapsode",
  asclepiad: "Asclepiad",
  "elysian-champion": "Elysian Champion",
  shade: "Shade",
  cyclops: "Cyclops",
  dactyl: "Dactyl",
  "battle-physician": "Battle Physician",
  "boreal-giant": "Boreal Giant",
  "drakon-colossus": "Drakon Colossus",
  "arcadian-wolf": "Arcadian Wolf",
  drakon: "Drakon",
} satisfies Record<TroopId, string>;
// 0.77.111d controller windups (handoff 20261013-full-roster-successor-plan-next,
// addressables-actor-resolution-next vectors.json); 118d controller equivalence is UNKNOWN.
export const sourceWindupPercent = {
  hoplite: 50,
  tracker: 50,
  aegeus: 15,
  atalanta: 15,
  peltast: 30,
  hypaspist: 32,
  peripolos: 50,
  misthophoros: 20,
  spartoi: 50,
  erinys: 30,
  "fire-titan": 18,
  rhapsode: 20,
  asclepiad: 30,
  "elysian-champion": 32,
  shade: 50,
  cyclops: 18,
  dactyl: 50,
  "battle-physician": 50,
  "boreal-giant": 18,
  "drakon-colossus": 15,
  "arcadian-wolf": 50,
  drakon: 50,
} as const satisfies Record<TroopId | "aegeus" | "atalanta", number>;
export const god = z.enum(["athena", "zeus", "apollo"]);
type SourceFate = (typeof fateSource)[number];
export type FateId = SourceFate["id"];
type IdOf<K extends SourceFate["kind"]> = Extract<
  SourceFate,
  { kind: K }
>["id"];
const idsOf = <K extends SourceFate["kind"]>(kind: K) =>
  fateSource.flatMap((f) => (f.kind === kind ? [f.id as IdOf<K>] : []));
// The 94 active entries in source table order (src/fate-source.ts, generated). Engine kind "rune"
// is the source CharmCardType.
export const fateId = z.enum(
  fateSource.map((f) => f.id) as [FateId, ...FateId[]],
);
export const runeId = z.enum(
  idsOf("rune") as [IdOf<"rune">, ...IdOf<"rune">[]],
);
export const blessingId = z.enum(
  idsOf("blessing") as [IdOf<"blessing">, ...IdOf<"blessing">[]],
);

// One table-driven effect vocabulary for structures (and later Fate/PvE boards). Every value is a
// level triple evaluated at the SOURCE structure's level; `per` multiplies it by a board count,
// `when` gates it once (count > 0), `op:"multiply"` joins the Multiply list (binary32 fold from 1,
// applied once after the Add list)
// (handoffs stat-operator-composition-closure-next, target-multiplier-closure-next).
export type Stat =
  | "damage"
  | "crit"
  | "armor"
  | "health"
  | "regen"
  | "healing"
  | "burn"
  | "poison"
  | "frost"
  | "cleave"
  | "thorn"
  | "speed"
  | "ward"
  | "range"
  | "revive"
  | "count";
export type Currency = "drachmas" | "insight" | "villagers";
// Items (structures and map items) carrying ALL tags; adjacent excludes the source tile,
// colonized includes every owned tile, including a matching source item (current118 static admission).
export type ItemSelector = {
  scope: "adjacent" | "colonized";
} & (
  { tags: readonly Tag[]; any?: never } | { any: readonly Tag[]; tags?: never }
);
export function hasSelectorTags(tags: readonly Tag[], selector: ItemSelector) {
  return selector.tags
    ? selector.tags.every((tag) => tags.includes(tag))
    : selector.any.some((tag) => tags.includes(tag));
}
export type Counter =
  | ItemSelector
  | { scope: "adjacent"; feature: Feature }
  | { scope: "adjacent" | "colonized"; empty: true }
  | { scope: "adjacent"; empty: "playable" }
  | { workers: true }
  | { drachmas: true };
type Triple = readonly [number, number, number];
type StatAmount =
  | { value: Triple; per?: Counter; base?: never }
  | { value: Triple; per: Counter; base: number };
export type Effect =
  | (StatAmount & {
      stat: Stat;
      op?: "multiply" | "subtract";
      to?: ItemSelector; // omitted: the structure's own troops
      when?: { tile: Terrain } | { scope: "adjacent"; feature: Feature };
    })
  | {
      stat: Currency;
      value: Triple;
      per?: Counter;
      when?: { tile: Terrain } | { scope: "adjacent"; feature: Feature };
    };
// Deployment: "workers" = assigned Villagers; "fixed" = serialized spawn amount (sourceSpawn);
// V5 Sentry/Mercenary rules; Skull's one per adjacent Circle of Stone. Bifrost-style `count`
// effects add on top; the total clamps to the source spawn cap.
export type Count =
  | "workers"
  | "fixed"
  | "civilian-structures"
  | "stored-drachmas"
  | "adjacent-circle-of-stone";
// Admission (docs/SHOP-CATALOGUE.md): exact = closed source semantics; partial = playable with
// every unknown piece listed in `unknown` and not applied; hold = identity effect UNKNOWN, never
// offered (still consumes shop draw attempts).
type Definition = {
  name: string;
  sprite: string; // model family: /models/<sprite>-l<level>.glb
  troop: { id: TroopId; count: Count } | null;
  initialWorkers: number;
  minimumWorkers: number;
  workerSlots: number;
  clan: "stag" | "raven" | null;
  status: "exact" | "partial" | "hold";
  effects: readonly Effect[];
  unknown: readonly string[];
  description: string;
};
const adjacent = (...tags: Tag[]): ItemSelector => ({
  scope: "adjacent",
  tags,
});
const colonized = (...tags: Tag[]): ItemSelector => ({
  scope: "colonized",
  tags,
});
const workers = { workers: true } as const;
const camp = { initialWorkers: 1, minimumWorkers: 0, workerSlots: 3 } as const;
const noWorkers = {
  initialWorkers: 0,
  minimumWorkers: 0,
  workerSlots: 0,
} as const;
const shared = { clan: null } as const;

const shop = {
  "altar-of-kings": {
    name: "Altar of Heroes",
    sprite: "altar-of-kings",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "damage",
        value: [3, 6, 9],
        to: adjacent("unit"),
        per: colonized("melee"),
      },
      {
        stat: "crit",
        value: [3, 6, 9],
        to: adjacent("unit"),
        per: colonized("ranged"),
      },
      {
        stat: "regen",
        value: [5, 10, 15],
        to: adjacent("unit"),
        per: colonized("healer"),
      },
      { stat: "drachmas", value: [1, 2, 3], per: colonized("economy") },
      { stat: "insight", value: [1, 2, 3], per: colonized("knowledge") },
    ],
    unknown: [],
    description:
      "Honours every hero of the polis: adjacent Units grow with your Melee, Ranged and Healer structures.",
  },
  forge: {
    name: "Arsenal",
    sprite: "forge",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "armor",
        value: [15, 30, 45],
        to: adjacent("unit"),
        per: colonized("melee"),
      },
      {
        stat: "armor",
        value: [10, 20, 30],
        to: adjacent("unit"),
        per: colonized("melee"),
        when: { tile: "rocky" },
      },
    ],
    unknown: [],
    description:
      "Arms adjacent Units with Armor for every Melee structure you hold.",
  },
  "javelin-camp": {
    name: "Javelin Camp",
    sprite: "javelin-camp",
    troop: { id: "peltast", count: "workers" },
    ...camp,
    ...shared,
    status: "exact",
    effects: [{ stat: "damage", value: [2, 4, 6], to: adjacent("ranged") }],
    unknown: [],
    description: "Each Villager deploys a Peltast.",
  },
  "apollo-fountain": {
    name: "Fountain of Apollo",
    sprite: "apollo-fountain",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "insight",
        value: [1, 2, 3],
        per: { scope: "adjacent", feature: "mountain" },
      },
      { stat: "healing", value: [5, 10, 15], to: adjacent("healer") },
    ],
    unknown: [],
    description:
      "A sacred spring: Insight beside the Mountain and stronger adjacent Healers.",
  },
  "iris-bridge": {
    name: "Iris Bridge",
    sprite: "iris-bridge",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [{ stat: "count", value: [1, 2, 3], to: adjacent("warband") }],
    unknown: [
      "A camp with 0 Villagers still deploys the extra troops (DERIVED from count = 0 + workers + modifiers; not yet proved natively).",
    ],
    description: "Every adjacent Warband camp deploys extra troops.",
  },
  brewery: {
    name: "Symposium",
    sprite: "brewery",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "regen", value: [1, 2, 3], to: adjacent("unit") },
      { stat: "insight", value: [1, 2, 3], per: adjacent("warband") },
    ],
    unknown: [],
    description:
      "Feasts that restore adjacent Units and inspire nearby Warbands.",
  },
  "sacred-fire": {
    name: "Hearth of Hestia",
    sprite: "sacred-fire",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "burn", value: [1, 2, 3], to: adjacent("unit") },
      {
        stat: "burn",
        value: [2, 4, 6],
        to: adjacent("unit"),
        when: { tile: "wildland" },
      },
    ],
    unknown: [],
    description: "A ceremonial fire that lends adjacent Units burning blows.",
  },
  "defense-tower": {
    name: "Defensive Tower",
    sprite: "defense-tower",
    troop: null,
    initialWorkers: 0,
    minimumWorkers: 0,
    workerSlots: 3,
    ...shared,
    status: "exact",
    effects: [{ stat: "damage", value: [4, 8, 12], per: adjacent("civilian") }],
    unknown: [],
    description:
      "Fires one arrow plus one per Villager in each volley, gaining damage beside Civilian structures.",
  },
  "tombs-of-erebus": {
    name: "Tombs of Erebus",
    sprite: "tombs-of-erebus",
    troop: { id: "spartoi", count: "fixed" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "armor", value: [200, 400, 600], when: { tile: "rocky" } },
      {
        stat: "poison",
        value: [3, 6, 9],
        per: colonized("mythical"),
        when: { tile: "fertile" },
      },
    ],
    unknown: [],
    description: "Raises two Spartoi whose strikes poison their foes.",
  },
  farm: {
    name: "Wheat Field",
    sprite: "farm",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "health", value: [25, 50, 75], to: adjacent("unit") },
      { stat: "drachmas", value: [1, 2, 3] },
    ],
    unknown: [],
    description:
      "Feeds adjacent Units and earns Drachmas. On its own Fertile ground, each round adds 5/10/15 Health to its retained aura. Moving or upgrading keeps this growth; selling removes it.",
  },
  "gate-of-hades": {
    name: "Gate of Hades",
    sprite: "gate-of-hades",
    troop: { id: "erinys", count: "fixed" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [{ stat: "damage", value: [8, 16, 24], per: adjacent("divine") }],
    unknown: [],
    description: "Two Erinyes answer the gate, deadlier beside Divine places.",
  },
  "gate-of-etna": {
    name: "Gate of Etna",
    sprite: "gate-of-etna",
    troop: { id: "fire-titan", count: "fixed" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "burn", value: [5, 10, 15], per: colonized("mythical") },
      {
        stat: "burn",
        value: [3, 6, 9],
        to: adjacent("mythical", "unit"),
        when: { tile: "rocky" },
      },
    ],
    unknown: [],
    description: "A Fire Titan strides out of the volcano with burning blows.",
  },
  "healers-hut": {
    name: "Asclepian Sanctuary",
    sprite: "healers-hut",
    troop: { id: "asclepiad", count: "workers" },
    ...camp,
    ...shared,
    status: "partial",
    effects: [
      {
        stat: "healing",
        value: [2, 4, 6],
        per: { scope: "adjacent", empty: "playable" },
      },
    ],
    unknown: ["Heal path allocation and distance ties are UNKNOWN."],
    description: "Each Villager deploys an Asclepiad who heals wounded allies.",
  },
  "tritons-conch": {
    name: "Triton's Conch",
    sprite: "tritons-conch",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "speed",
        op: "multiply",
        value: [0.1, 0.2, 0.3],
        per: { scope: "adjacent", tags: ["divine"] },
      },
    ],
    unknown: [],
    description:
      "Rallies all your Units with Haste for 1/2/3 seconds. Adjacent Divine structures quicken its calls.",
  },
  "altar-of-olympus": {
    name: "Altar of Olympus",
    sprite: "altar-of-olympus",
    troop: { id: "shade", count: "fixed" },
    initialWorkers: 0,
    minimumWorkers: 0,
    workerSlots: 3,
    ...shared,
    status: "exact",
    effects: [{ stat: "insight", value: [1, 2, 3], per: workers }],
    unknown: [],
    description:
      "Always sends four Shades; each Villager produces Insight instead.",
  },
  house: {
    name: "Oikos",
    sprite: "house",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "health", value: [30, 60, 90], to: adjacent("unit") },
      { stat: "regen", value: [3, 6, 9], to: adjacent("unit") },
      { stat: "villagers", value: [1, 1, 1], when: { tile: "fertile" } },
    ],
    unknown: [],
    description:
      "Homes that strengthen adjacent Units; on Fertile ground a Villager joins each round.",
  },
  "hunters-lodge": {
    name: "Hunting Lodge",
    sprite: "hunters-lodge",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "damage", value: [6, 12, 18], to: adjacent("unit") },
      { stat: "drachmas", value: [1, 2, 3] },
      { stat: "drachmas", value: [1, 2, 3], when: { tile: "wildland" } },
    ],
    unknown: [],
    description: "Hunters sharpen adjacent Units and sell their game.",
  },
  "gigantes-camp": {
    name: "Gigantes Camp",
    sprite: "gigantes-camp",
    troop: { id: "cyclops", count: "fixed" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "health", value: [40, 80, 120], per: adjacent("warband") },
    ],
    unknown: [],
    description:
      "A Cyclops mercenary whose hits stun for 0.4 seconds; tougher beside each Warband camp.",
  },
  "dactyl-camp": {
    name: "Dactyl Camp",
    sprite: "dactyl-camp",
    troop: { id: "dactyl", count: "fixed" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "speed",
        base: Math.fround(0.1),
        value: [Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)],
        per: colonized("economy"),
      },
    ],
    unknown: [],
    description: "Three quick Dactyl smiths join the fight.",
  },
  agora: {
    name: "Agora",
    sprite: "agora",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "drachmas", value: [2, 4, 6] },
      { stat: "drachmas", value: [1, 2, 3], per: adjacent("economy") },
    ],
    unknown: [],
    description:
      "A marketplace that earns Drachmas, more beside other Economy structures.",
  },
  "menders-hut": {
    name: "Battle Physicians",
    sprite: "menders-hut",
    troop: { id: "battle-physician", count: "workers" },
    initialWorkers: 1,
    minimumWorkers: 1,
    workerSlots: 3,
    ...shared,
    status: "partial",
    effects: [
      { stat: "regen", value: [10, 20, 30], to: adjacent("unit") },
      { stat: "crit", value: [15, 30, 45], when: { tile: "fertile" } },
    ],
    unknown: [
      "Heal path allocation and distance ties are UNKNOWN.",
    ],
    description:
      "Each Villager (at least one) deploys a Battle Physician whose heals can be critical.",
  },
  "spring-of-mnemosyne": {
    name: "Spring of Mnemosyne",
    sprite: "spring-of-mnemosyne",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "speed",
        op: "multiply",
        value: [0.1, 0.2, 0.3],
        to: adjacent("healer"),
      },
      { stat: "insight", value: [1, 2, 3], per: colonized("knowledge") },
    ],
    unknown: [],
    description:
      "Memory waters: faster adjacent Healers and Insight from Knowledge.",
  },
  "silver-mine": {
    name: "Silver Mine",
    sprite: "silver-mine",
    troop: null,
    initialWorkers: 0,
    minimumWorkers: 0,
    workerSlots: 3,
    ...shared,
    status: "exact",
    effects: [
      { stat: "drachmas", value: [2, 4, 6], when: { tile: "rocky" } },
      { stat: "drachmas", value: [1, 1, 1], per: workers },
    ],
    unknown: [],
    description: "Drachmas from Rocky ground and from every Villager.",
  },
  "thunderbolt-of-zeus": {
    name: "Thunderbolt of Zeus",
    sprite: "thunderbolt-of-zeus",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [{ stat: "count", value: [1, 2, 3], per: adjacent("warband") }],
    unknown: [],
    description:
      "Calls volleys of lightning at random enemies, with more bolts beside Warband structures.",
  },
  "pit-of-tartarus": {
    name: "Pit of Tartarus",
    sprite: "pit-of-tartarus",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "thorn",
        value: [5, 10, 15],
        to: adjacent("melee"),
        per: colonized("terrain"),
      },
      {
        stat: "health",
        op: "multiply",
        value: [0.2, 0.4, 0.6],
        to: adjacent("unit"),
        when: { tile: "fertile" },
      },
    ],
    unknown: [],
    description:
      "A chasm that arms adjacent Melee with Thorn per colonized Terrain and hardens adjacent Units on Fertile ground.",
  },
  "offering-well": {
    name: "Offering Well",
    sprite: "offering-well",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "drachmas", value: [-1, -2, -3] },
      { stat: "health", value: [30, 60, 90], to: adjacent("mythical", "unit") },
      { stat: "damage", value: [5, 5, 5], to: adjacent("mythical", "unit") },
    ],
    unknown: [],
    description:
      "Costs Drachmas to empower adjacent Mythical Units. Each round adds 15 Health and 3 Damage to its retained aura. After the first grant, each level above one adds a further 15 Health and 3 Damage once, not per past round. Moving or upgrading keeps this growth; selling removes it.",
  },
  "scout-camp": {
    name: "Scout Camp",
    sprite: "scout-camp",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "speed",
        op: "multiply",
        value: [0.05, 0.1, 0.15],
        to: adjacent("unit"),
        per: colonized("terrain"),
      },
      {
        stat: "drachmas",
        value: [2, 4, 6],
        per: { scope: "colonized", empty: true },
      },
    ],
    unknown: [],
    description: "Scouts profit from empty land and quicken adjacent Units.",
  },
  "sentry-camp": {
    name: "Peripolos Camp",
    sprite: "sentry-camp",
    troop: { id: "peripolos", count: "civilian-structures" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [],
    unknown: [],
    description:
      "Deploys one Peripolos per Civilian structure on colonized territory, up to six.",
  },
  sheepfold: {
    name: "Sheepfold",
    sprite: "sheepfold",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "drachmas",
        value: [2, 4, 6],
        per: { scope: "colonized", empty: true },
      },
      {
        stat: "insight",
        value: [1, 2, 3],
        per: { scope: "colonized", empty: true },
      },
      { stat: "health", value: [30, 60, 90], to: adjacent("unit") },
      { stat: "regen", value: [5, 10, 15], to: adjacent("unit") },
    ],
    unknown: [],
    description: "Flocks that earn from empty land and shelter adjacent Units.",
  },
  "shield-camp": {
    name: "Shield Camp",
    sprite: "shield-camp",
    troop: { id: "hypaspist", count: "workers" },
    ...camp,
    ...shared,
    status: "exact",
    effects: [{ stat: "armor", value: [20, 40, 60], to: adjacent("unit") }],
    unknown: [],
    description: "Each Villager deploys a Hypaspist.",
  },
  "skull-of-typhon": {
    name: "Skull of Typhon",
    sprite: "skull-of-typhon",
    troop: { id: "drakon-colossus", count: "adjacent-circle-of-stone" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [{ stat: "frost", value: [10, 20, 30], per: adjacent("divine") }],
    unknown: [],
    description:
      "Wakes one Drakon Colossus per adjacent Circle of Stone, up to two. Its attacks gain Frost beside Divine structures.",
  },
  "archer-camp": {
    name: "Archer Camp",
    sprite: "archer-camp",
    troop: { id: "tracker", count: "workers" },
    ...camp,
    ...shared,
    status: "exact",
    effects: [{ stat: "burn", value: [2, 4, 6], per: adjacent("terrain") }],
    unknown: [],
    description:
      "Each Villager deploys a Tracker whose arrows burn beside Terrain.",
  },
  "hephaestus-forge": {
    name: "Hephaestus' Forge",
    sprite: "hephaestus-forge",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "cleave", value: [1, 2, 3], to: adjacent("melee") },
      { stat: "armor", value: [100, 200, 300], to: adjacent("melee") },
      {
        stat: "burn",
        value: [3, 6, 9],
        to: adjacent("melee"),
        when: { tile: "fertile" },
      },
      {
        stat: "poison",
        value: [3, 6, 9],
        to: adjacent("melee"),
        when: { tile: "wildland" },
      },
      {
        stat: "frost",
        value: [5, 10, 15],
        to: adjacent("melee"),
        when: { tile: "rocky" },
      },
    ],
    unknown: [],
    description:
      "The divine smithy armours adjacent Melee; its ground decides fire, poison or Frost.",
  },
  "spear-camp": {
    name: "Spear Camp",
    sprite: "spear-camp",
    troop: { id: "hoplite", count: "workers" },
    ...camp,
    ...shared,
    status: "exact",
    effects: [{ stat: "crit", value: [5, 10, 15], to: adjacent("melee") }],
    unknown: [],
    description: "Each Villager deploys a Hoplite.",
  },
  watchtower: {
    name: "Watchtower",
    sprite: "watchtower",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "health",
        value: [50, 100, 150],
        to: adjacent("melee"),
        per: colonized("tower"),
      },
      { stat: "insight", value: [1, 2, 3] },
    ],
    unknown: [],
    description:
      "Lookouts earn Insight and steel adjacent Melee for every Tower.",
  },
  "wolf-den": {
    name: "Arcadian Wolf Den",
    sprite: "wolf-den",
    troop: { id: "arcadian-wolf", count: "fixed" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [{ stat: "damage", value: [5, 10, 15], per: adjacent("beast") }],
    unknown: [],
    description:
      "Two Arcadian Wolves hunt for you, fiercer beside other Beasts.",
  },
  woodcutter: {
    name: "Woodcutter",
    sprite: "woodcutter",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      { stat: "damage", value: [5, 10, 15], to: adjacent("ranged") },
      {
        stat: "drachmas",
        value: [1, 2, 3],
        when: { scope: "adjacent", feature: "forest" },
      },
    ],
    unknown: [],
    description:
      "Fells timber beside the Forest and fletches arrows for adjacent Ranged Units.",
  },
  "drakon-nest": {
    name: "Drakon Nest",
    sprite: "drakon-nest",
    troop: { id: "drakon", count: "fixed" },
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "burn",
        value: [5, 10, 15],
        per: { scope: "adjacent", feature: "mountain" },
      },
    ],
    unknown: [],
    description:
      "A Drakon burns foes from long range, hotter beside the Mountain.",
  },
  "hesperides-tree": {
    name: "Tree of the Hesperides",
    sprite: "hesperides-tree",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [
      {
        stat: "health",
        op: "multiply",
        value: [1, 2, 3],
        to: adjacent("unit"),
        when: { scope: "adjacent", feature: "forest" },
      },
      {
        stat: "healing",
        op: "multiply",
        value: [0.5, 1, 1.5],
        to: colonized("healer"),
      },
    ],
    unknown: [],
    description:
      "Golden apples multiply adjacent Units' Health beside the Forest and every Healer's healing.",
  },
  "hall-of-rhapsodes": {
    name: "Hall of Rhapsodes",
    sprite: "hall-of-rhapsodes",
    troop: { id: "rhapsode", count: "workers" },
    ...camp,
    clan: "stag",
    status: "partial",
    effects: [
      { stat: "insight", value: [1, 2, 3], per: adjacent("knowledge") },
    ],
    unknown: ["Heal path allocation and distance ties are UNKNOWN."],
    description:
      "Stag clan: each Villager deploys a healing Rhapsode; Insight from adjacent Knowledge.",
  },
  "throne-of-zeus": {
    name: "Throne of Zeus",
    sprite: "throne-of-zeus",
    troop: { id: "elysian-champion", count: "workers" },
    ...camp,
    clan: "stag",
    status: "partial",
    effects: [],
    unknown: [
      "External revival handlers (Ward/status reset, revival VFX and audio) are UNKNOWN; revival restores Health and Armor only.",
    ],
    description:
      "Stag clan: each Villager deploys an Elysian Champion who rises once after falling.",
  },
  "misthophoros-camp": {
    name: "Misthophoros Camp",
    sprite: "misthophoros-camp",
    troop: { id: "misthophoros", count: "stored-drachmas" },
    ...noWorkers,
    clan: "raven",
    status: "exact",
    effects: [],
    unknown: [],
    description:
      "Raven clan: deploys one Misthophoros per six stored Drachmas, up to four. Spending immediately changes deployment.",
  },
  "charons-barge": {
    name: "Charon's Barge",
    sprite: "charons-barge",
    troop: { id: "boreal-giant", count: "fixed" },
    ...noWorkers,
    clan: "raven",
    status: "exact",
    effects: [
      { stat: "health", value: [5, 10, 15], per: { drachmas: true } },
      { stat: "frost", value: [1, 2, 3], per: { drachmas: true } },
    ],
    unknown: [],
    description:
      "Raven clan: a Boreal Giant whose Health and outgoing Frost grow with your stored Drachmas.",
  },
} satisfies Record<ShopBuildingId, Definition>;

type Building = Definition & {
  available: boolean;
  rarity: Rarity | null;
  tags: readonly Tag[];
  native: string;
  guid: string | null;
};
function shopBuildings() {
  const merged = {} as Record<ShopBuildingId, Building>;
  for (const id of buildingId.exclude(["polis-hall"]).options) {
    const definition: Definition = shop[id];
    const source = sourceItems[id];
    const tags: readonly Tag[] = source.tags;
    merged[id] = {
      ...definition,
      available: definition.status !== "hold",
      rarity: source.rarity,
      tags,
      native: source.native,
      guid: source.guid,
    };
  }
  return merged;
}
export const buildings = {
  "polis-hall": {
    name: "Polis Hall",
    sprite: "polis-hall",
    troop: null,
    ...noWorkers,
    ...shared,
    status: "exact",
    effects: [],
    unknown: [],
    description: "The seat of your chief and the heart of your polis.",
    available: true,
    rarity: null,
    tags: ["banner-hall", "melee", "unit", "warchief"],
    native: "BannerHall",
    guid: null,
  },
  ...shopBuildings(),
} satisfies Record<BuildingId, Building>;

export function hasTag(id: BuildingId, target: Tag | readonly Tag[]) {
  const wanted = typeof target === "string" ? [target] : target;
  return wanted.every((tag) =>
    buildings[id].tags.some((candidate) => candidate === tag),
  );
}

const statNames = {
  damage: "Damage",
  crit: "Crit Chance",
  armor: "Armor",
  health: "Health",
  regen: "Regen",
  healing: "Healing",
  burn: "Burn",
  poison: "Poison",
  frost: "Frost",
  cleave: "Cleave",
  thorn: "Thorn",
  speed: "Attack Speed",
  ward: "Ward",
  range: "Attack Range",
  revive: "Revive",
  count: "troops",
  drachmas: "Drachmas",
  insight: "Insight",
  villagers: "Villager",
} satisfies Record<Stat | Currency, string>;
const title = (word: string) =>
  word
    .split("-")
    .map((part) => (part[0]?.toUpperCase() ?? "") + part.slice(1))
    .join(" ");
const tagText = (tags: readonly string[]) => tags.map(title).join(" ");
const selectorText = (selector: ItemSelector) =>
  selector.tags ? tagText(selector.tags) : selector.any.map(title).join(" or ");
const featureText = (feature: Feature) =>
  feature === "circle-of-stone" ? "Circle of Stone" : title(feature);
function counterText(per: Counter) {
  if ("workers" in per) return "per Villager";
  if ("drachmas" in per) return "per stored Drachma";
  if ("feature" in per) return `per adjacent ${featureText(per.feature)}`;
  if ("empty" in per)
    return per.scope === "adjacent"
      ? per.empty === "playable"
        ? "per adjacent empty playable tile"
        : "per adjacent empty tile"
      : "per empty colonized tile";
  return per.scope === "adjacent"
    ? `per adjacent ${selectorText(per)}`
    : `per ${selectorText(per)} on your territory`;
}
const shown = (v: number) => String(Number(v.toPrecision(6)));
// Player-facing text generated from the same data the engine evaluates.
export function describeEffect(effect: Effect) {
  const values = effect.value.every((v) => v === effect.value[0])
    ? effect.value.slice(0, 1)
    : effect.value;
  const amount =
    "op" in effect && effect.op === "multiply"
      ? `×(1 + ${values.map(shown).join("/")})`
      : "op" in effect && effect.op === "subtract"
        ? `−${values.map(shown).join("/")}`
        : `${effect.value[0]! > 0 ? "+" : ""}${values.map(shown).join("/")}`;
  const who =
    "to" in effect && effect.to
      ? effect.to.scope === "adjacent"
        ? `Adjacent ${selectorText(effect.to)}: `
        : `Every ${selectorText(effect.to)}: `
      : effect.stat === "drachmas" ||
          effect.stat === "insight" ||
          effect.stat === "villagers"
        ? "Income: "
        : "Own troops: ";
  const when = effect.when
    ? "tile" in effect.when
      ? ` on ${title(effect.when.tile)} ground`
      : ` when adjacent to the ${featureText(effect.when.feature)}`
    : "";
  const base =
    "base" in effect && effect.base !== undefined
      ? `${effect.base > 0 ? "+" : ""}${shown(effect.base)} ${statNames[effect.stat]} and `
      : "";
  return `${who}${base}${amount} ${statNames[effect.stat]}${effect.per ? " " + counterText(effect.per) : ""}${when}`;
}

// --- Fate ---------------------------------------------------------------------------------
// Identity, tier cost (Insight), unlock collections, favor granted and gift amounts are generated
// (src/fate-source.ts). Effects below are bound from the serialized modules per
// docs/FATE-CATALOGUE.md; src/fate.test.ts checks every number against the generated scalars.
// Holder tags contain every `all`, at least one `any` and no `none` tag.
export type Holder = {
  all?: readonly Tag[];
  any?: readonly Tag[];
  none?: readonly Tag[];
};
export function holds(id: BuildingId, holder: Holder) {
  return holdsTags(buildings[id].tags, holder);
}
export function holdsTags(tags: readonly Tag[], holder: Holder) {
  return (
    (holder.all ?? []).every((t) => tags.includes(t)) &&
    (!holder.any || holder.any.some((t) => tags.includes(t))) &&
    !(holder.none ?? []).some((t) => tags.includes(t))
  );
}
// Zero-duration ordinary buffs use an effectively infinite source timer.
type BuffStat = "ward" | "crit" | "burn" | "armor" | "damage";
export type Trigger = {
  value: number;
  seconds: number;
} & (
  | { on: "battle-start" | "struck" | "crit"; stat: BuffStat }
  | { on: "health-below"; below: number; stat: BuffStat }
  | { on: "hit-other"; stat: "haste" }
);
export const deathWardChain = z
  .object({ count: z.literal(3), range: z.literal(999), ward: z.literal(1) })
  .strict();
type FateRule = {
  holders?: Holder; // charm/spell: legal targets; blessing: every owned structure it acts through
  effects?: readonly Effect[]; // shop vocabulary, evaluated at each holder
  triggers?: readonly Trigger[];
  deathWardChain?: z.infer<typeof deathWardChain>;
  discount?: number; // blessing: Drachmas off every holder shop offer (price floor 1)
  appearance?: Tag; // blessing: one extra draw-pile entry for items with this tag
  upgrade?: true; // spell: +1 level to the target
  growth?: { damage: number; health: number }; // blessing: chief, every round start
  remap?: true; // charm: the holder's Insight production pays Drachmas
  saleInsight?: true;
  storedInsight?: number; // blessing: +1 Insight per this many stored, at income
  killInsight?: number; // charm: Insight per kill by the holder's troops
  unknown?: readonly string[];
};
const each = (v: number): Triple => [v, v, v];
const plus = (
  stat: Stat | Currency,
  v: number,
  extra: Partial<{
    per: Counter;
    to: ItemSelector;
    op: "multiply" | "subtract";
  }> = {},
) => ({ stat, value: each(v), ...extra }) as Effect;
const rules = {
  "call-to-peace": { holders: { any: ["civilian"] }, discount: 1 },
  "hermes-fair-trade": {
    holders: { all: ["economy"] },
    effects: [plus("drachmas", 1)],
    unknown: [],
  },
  "well-fed": { holders: { all: ["warband"] }, effects: [plus("health", 15)] },
  "padded-armor": { holders: { all: ["melee"] }, effects: [plus("armor", 25)] },
  "protect-the-weak": {
    holders: { all: ["civilian", "unit"] },
    effects: [plus("ward", 1)],
  },
  "hermes-swift-hands": {
    holders: { all: ["civilian", "unit"] },
    effects: [plus("speed", Math.fround(0.3))],
  },
  "phalanx-discipline": {
    holders: { all: ["melee"] },
    effects: [plus("armor", 15, { per: adjacent("warband") })],
  },
  "rite-of-hestia": { holders: { any: ["civilian"] }, upgrade: true },
  "athenas-shield-wall": {
    holders: { any: ["warband"] },
    effects: [plus("armor", 20)],
    unknown: [],
  },
  "apollos-sentinels": { appearance: "tower" },
  "echidnas-hide": {
    holders: { all: ["warband"] },
    effects: [plus("health", 15), plus("thorn", 2)],
  },
  "aegis-of-thought": {
    holders: { all: ["knowledge"] },
    effects: [plus("ward", 1, { to: adjacent("unit") })],
    unknown: [],
  },
  "asclepius-second-wind": {
    holders: { all: ["unit"] },
    triggers: [
      { on: "health-below", below: 0.5, stat: "ward", value: 3, seconds: 5 },
    ],
    unknown: [],
  },
  "heracles-resolve": {
    holders: { all: ["unit"] },
    triggers: [{ on: "struck", stat: "armor", value: 10, seconds: 0 }],
    unknown: [],
  },
  "guardians-of-the-polis": {
    holders: { all: ["warband"] },
    effects: [plus("ward", 1, { per: adjacent("civilian") })],
  },
  "a-heros-last-breath": {
    holders: { all: ["melee"] },
    deathWardChain: { count: 3, range: 999, ward: 1 },
  },
  "aegis-strike": {
    holders: { all: ["melee"] },
    effects: [plus("armor", 40), plus("frost", 10)],
  },
  "the-sacred-guard": {
    holders: { all: ["warband"] },
    effects: [plus("armor", 30, { per: adjacent("tower") })],
  },
  "bond-of-the-phalanx": {
    holders: { all: ["civilian", "unit"] },
    effects: [
      plus("speed", Math.fround(0.1), {
        op: "multiply",
        per: adjacent("melee"),
      }),
    ],
  },
  "athenas-bastion": {
    holders: { all: ["unit"] },
    effects: [plus("armor", 20, { per: colonized("knowledge") })],
    unknown: [],
  },
  "gleaming-aegis": {
    holders: { all: ["unit"] },
    triggers: [{ on: "battle-start", stat: "ward", value: 15, seconds: 10 }],
    unknown: [],
  },
  "hands-of-asclepius": {
    holders: { any: ["healer"] },
    effects: [plus("speed", 1, { op: "multiply" }), plus("range", -2)],
  },
  "bronze-of-hephaestus": {
    holders: { any: ["unit"] },
    effects: [plus("armor", 150), plus("ward", 2)],
  },
  "apollos-champion": {
    holders: { any: ["warchief", "banner-hall"] },
    effects: [plus("revive", 1), plus("health", 1, { op: "multiply" })],
    unknown: [],
  },
  "watch-of-the-polis": {
    holders: { all: ["tower"] },
    effects: [
      plus("speed", Math.fround(0.1), {
        op: "multiply",
        per: adjacent("civilian"),
      }),
    ],
    unknown: [],
  },
  "in-the-heros-wake": {
    holders: { any: ["warband"] },
    effects: [plus("cleave", 2), plus("health", 150)],
    unknown: [],
  },
  "apollos-conduit": {
    holders: { any: ["healer"] },
    effects: [
      plus("healing", 15, { per: adjacent("divine") }),
      plus("speed", Math.fround(0.1), {
        op: "multiply",
        per: adjacent("divine"),
      }),
    ],
  },
  "ruins-of-delphi": {},
  "lost-wanderer": {},
  "beseech-zeus": {},
  "beseech-athena": {},
  "beseech-apollo": {},
  "aegean-salvage": {},
  "citizens-answer": {},
  "pray-to-zeus": {},
  "pray-to-athena": {},
  "pray-to-apollo": {},
  "mines-of-laurion": {},
  "ships-from-corinth": {},
  "invoke-zeus": {},
  "invoke-athena": {},
  "invoke-apollo": {},
  "call-to-learning": { holders: { all: ["knowledge"] }, discount: 1 },
  "read-the-oracle": {
    holders: { all: ["knowledge"] },
    effects: [plus("insight", 1)],
    unknown: [],
  },
  "hermes-pathfinders": {
    holders: { any: ["unit"], none: ["healer"] },
    effects: [plus("damage", 3, { per: { scope: "colonized", empty: true } })],
  },
  "wisdom-into-wealth": {
    holders: { any: ["knowledge"] },
    remap: true,
    unknown: [],
  },
  "guardians-of-the-frontier": {
    holders: { all: ["unit"] },
    effects: [plus("health", 15, { per: { scope: "colonized", empty: true } })],
  },
  "seek-the-oracle": { appearance: "mythical" },
  "athenas-apprentices": { saleInsight: true },
  "rite-of-athena": { holders: { any: ["knowledge"] }, upgrade: true },
  "artemis-arrowstorm": {
    holders: { any: ["ranged"] },
    effects: [plus("damage", 3)],
  },
  "artemis-power-shot": {
    holders: { any: ["ranged"] },
    effects: [plus("damage", 8)],
  },
  "aeolus-counsel": {
    holders: { any: ["tower"] },
    effects: [
      plus("speed", Math.fround(0.1), {
        op: "multiply",
        per: colonized("knowledge"),
      }),
    ],
    unknown: [],
  },
  "heracles-great-swing": {
    holders: { all: ["mythical", "unit"] },
    effects: [plus("cleave", 1), plus("damage", 5)],
    unknown: [],
  },
  "a-heros-ascension": { holders: { any: ["mythical"] }, upgrade: true },
  "secrets-of-the-oracle": {
    holders: { all: ["banner-hall"] },
    storedInsight: 5,
    unknown: [],
  },
  "achilles-opening": {
    holders: { any: ["ranged"] },
    triggers: [{ on: "crit", stat: "damage", value: 4, seconds: 0 }],
    unknown: [],
  },
  "wrath-of-the-titans": {
    holders: { any: ["mythical", "unit"] },
    effects: [plus("damage", 8)],
  },
  "rites-of-eleusis": {
    holders: { any: ["divine"] },
    effects: [
      plus("damage", 10, {
        to: { scope: "adjacent", any: ["mythical", "unit"] },
      }),
      plus("health", 30, {
        to: { scope: "adjacent", any: ["mythical", "unit"] },
      }),
    ],
    unknown: [],
  },
  "memory-of-the-polis": {
    holders: { any: ["knowledge"] },
    effects: [
      plus("insight", 1, { per: adjacent("civilian") }),
      plus("drachmas", 1, { per: adjacent("civilian") }),
    ],
    unknown: [],
  },
  "athenas-design": {
    holders: { any: ["melee"] },
    effects: [plus("health", 50, { per: adjacent("knowledge") })],
  },
  "wisdom-of-the-ancients": {
    holders: { any: ["mythical", "unit"] },
    effects: [plus("armor", 25, { per: colonized("divine") })],
    unknown: [],
  },
  "artemis-true-aim": {
    holders: { any: ["unit"] },
    triggers: [{ on: "battle-start", stat: "crit", value: 100, seconds: 10 }],
  },
  "athenas-might": {
    holders: { any: ["knowledge"] },
    effects: [
      plus("damage", 5, { to: colonized("unit") }),
      plus("health", 25, { to: colonized("unit") }),
      plus("crit", 5, { to: colonized("unit") }),
    ],
    unknown: [],
  },
  "breath-of-boreas": {
    holders: { any: ["ranged"] },
    effects: [plus("cleave", 2), plus("frost", 25)],
    unknown: [],
  },
  "arsenal-of-hephaestus": {
    holders: { all: ["mythical", "unit"] },
    effects: [plus("poison", 10), plus("burn", 10), plus("frost", 10)],
  },
  "ambrosial-vitality": {
    holders: { all: ["unit", "mythical"] },
    effects: [plus("health", 1, { op: "multiply" })],
  },
  "breeze-of-zephyrus": {
    holders: { any: ["melee"] },
    effects: [
      plus("damage", 20, { per: { scope: "adjacent", empty: true } }),
      plus("health", 50, { per: { scope: "adjacent", empty: true } }),
    ],
  },
  "call-to-war": { holders: { any: ["warband"] }, discount: 1 },
  // 0.77.100d video showed +0.2 action speed; the 0.77.111d asset serializes +10 Crit Chance.
  "flurry-of-blows": {
    holders: { all: ["melee"] },
    effects: [plus("crit", 10)],
  },
  "hephaestus-edge": {
    holders: { all: ["warband"] },
    effects: [plus("damage", 4)],
  },
  "burning-blades": {
    holders: { all: ["warband"] },
    effects: [plus("burn", 2)],
  },
  "growing-might-of-heracles": {
    holders: { all: ["banner-hall", "warchief"] },
    growth: { damage: 5, health: 15 },
    unknown: [],
  },
  "artemis-precision": {
    holders: { all: ["melee"] },
    effects: [plus("crit", 20)],
  },
  "rite-of-ares": { holders: { any: ["warband"] }, upgrade: true },
  "zeus-war-council": { appearance: "warband" },
  "arrows-of-prometheus": {
    holders: { all: ["ranged"] },
    effects: [plus("burn", 4)],
  },
  "spartan-discipline": {
    holders: { all: ["warband"] },
    effects: [plus("damage", 5), plus("armor", 25)],
  },
  "athenas-war-lessons": {
    holders: { all: ["warband"] },
    killInsight: 1,
    unknown: [],
  },
  "heracles-heavy-blow": {
    holders: { all: ["melee"] },
    effects: [
      plus("damage", 15),
      plus("speed", Math.fround(0.2), { op: "subtract" }),
    ],
  },
  "blood-of-ares": {
    holders: { all: ["unit"] },
    triggers: [{ on: "struck", stat: "damage", value: 3, seconds: 0 }],
    unknown: [],
  },
  "ares-cleaving-strike": {
    holders: { any: ["melee"] },
    effects: [plus("cleave", 1), plus("damage", 8)],
    unknown: [],
  },
  "warriors-ascension": {
    holders: { any: ["melee"], none: ["banner-hall", "warchief"] },
    upgrade: true,
  },
  "asclepius-battle-healers": {
    holders: { all: ["healer"] },
    effects: [
      plus("health", 15, { per: adjacent("warband") }),
      plus("healing", 10, { per: adjacent("warband") }),
    ],
  },
  "the-unbroken-phalanx": {
    holders: { all: ["melee", "unit"] },
    effects: [plus("health", 30, { per: adjacent("tower") })],
  },
  "prometheus-flame": {
    holders: { any: ["melee"] },
    effects: [plus("burn", 4, { per: adjacent("knowledge") })],
  },
  "ares-swordstorm": {
    holders: { all: ["warband"] },
    effects: [
      plus("damage", Math.fround(0.1), {
        op: "multiply",
        per: adjacent("warband"),
      }),
    ],
  },
  "achilles-charge": {
    holders: { any: ["warchief"] },
    effects: [
      plus("cleave", 3),
      plus("damage", 0.25, { op: "multiply" }),
      plus("crit", 20),
    ],
    unknown: [],
  },
  "bolt-of-zeus": {
    holders: { all: ["melee"] },
    triggers: [{ on: "battle-start", stat: "burn", value: 20, seconds: 10 }],
  },
  "sky-of-artemis": {
    holders: { any: ["tower"] },
    effects: [plus("burn", 8)],
    unknown: [],
  },
  "fury-of-the-titans": {
    holders: { any: ["mythical"] },
    effects: [plus("cleave", 1, { per: adjacent("warband") })],
    unknown: [],
  },
  "asclepius-surge": {
    holders: { all: ["healer"] },
    triggers: [{ on: "hit-other", stat: "haste", value: 1, seconds: 1 }],
    unknown: [],
  },
  "eyes-of-the-eagle": {
    holders: { all: ["warband"] },
    effects: [plus("crit", 15, { per: adjacent("tower") })],
  },
  "wrath-of-the-ancients": {
    holders: { any: ["mythical"] },
    effects: [plus("damage", 10, { per: colonized("divine") })],
    unknown: [],
  },
} satisfies Record<FateId, FateRule>;

export const patronNames = {
  zeus: "Zeus",
  athena: "Athena",
  apollo: "Apollo",
} as const;
type Patron = keyof typeof patronNames;
export type Fate = FateRule & {
  id: FateId;
  native: string;
  guid: string;
  pathId: string;
  name: string;
  sourceTitle: string;
  kind: SourceFate["kind"];
  sourceKind: SourceFate["sourceKind"];
  cost: SourceFate["cost"];
  unlock: readonly (readonly [Patron | "generic", number])[];
  favor: readonly Patron[];
  drachmas?: number;
  villagers?: number;
  serialized: readonly (readonly [string, string, number])[];
  art: `/art/fates/${string}.webp`;
  status: "exact" | "partial";
  unknown: readonly string[];
  text: string;
};
// "Warband", "Civilian Unit", "Mythical or Unit", "Melee (not Banner Hall or Warchief)".
export function holderText(h: Holder) {
  return [
    ...(h.all ?? []).map(title),
    ...(h.any ? [h.any.map(title).join(" or ")] : []),
  ]
    .join(" ")
    .concat(h.none ? ` (not ${h.none.map(title).join(" or ")})` : "");
}
const triggerWords = {
  "battle-start": "Battle start",
  struck: "When struck",
  crit: "On a critical hit",
  "health-below": "First time below half Health",
  "hit-other": "After healing or reflecting damage",
} satisfies Record<Trigger["on"], string>;
// Player-facing text generated from the bound data; unknown pieces are listed separately.
function describeFate(f: Omit<Fate, "text" | "status">) {
  const h = f.holders;
  const parts: string[] = [];
  if (f.drachmas) parts.push(`Gain ${f.drachmas} Drachmas`);
  if (f.villagers)
    parts.push(`Gain ${f.villagers} Villager${f.villagers > 1 ? "s" : ""}`);
  if (f.kind === "gift" && f.favor[0])
    parts.push(`Gain ${f.favor.length} ${patronNames[f.favor[0]]} Favor`);
  if (f.discount && h)
    parts.push(
      `${holderText(h)} structures cost ${f.discount} fewer Drachma in the shop`,
    );
  if (f.appearance)
    parts.push(
      `From the next round’s shop: ${title(f.appearance)} items have double draw weight within their rarity; matching appearance bonuses do not stack`,
    );
  if (f.upgrade && h) parts.push(`Upgrade a ${holderText(h)} structure`);
  const acts = [
    ...(f.effects ?? []).map(describeEffect),
    ...(f.triggers ?? []).map((t) =>
      t.on === "hit-other"
        ? `${triggerWords[t.on]}: your current target gains Haste for ${t.seconds} s`
        : `${triggerWords[t.on]}: +${t.value} ${t.stat === "armor" ? "maximum Armor" : statNames[t.stat]} ${t.seconds ? `for ${t.seconds} s` : "until the battle ends"}`,
    ),
    ...(f.deathWardChain
      ? [
          `On true death: immediately add ${f.deathWardChain.ward} current Ward to up to ${f.deathWardChain.count} nearest friendly units within range ${f.deathWardChain.range} of the dying unit; each ally is reached once and reviving allies qualify`,
        ]
      : []),
    ...(f.growth
      ? [
          `From the next round start: your chief gains +${f.growth.damage} Damage and +${f.growth.health} Health each round for the rest of the run`,
        ]
      : []),
    ...(f.remap
      ? ["Ordinary Insight income received by this item pays Drachmas instead"]
      : []),
    ...(f.saleInsight
      ? ["On selling a structure: gain Insight equal to the Drachmas earned"]
      : []),
    ...(f.storedInsight
      ? [
          `At your Hall’s income turn, after its own income: +1 Insight per ${f.storedInsight} Insight currently stored`,
        ]
      : []),
    ...(f.killInsight
      ? [
          `Qualifying troop kills immediately grant the active campaign +${f.killInsight} Insight, including opposing War Lessons troops; Burn and Poison ticks grant none`,
        ]
      : []),
  ];
  if (h && f.kind === "rune") parts.push(`Target ${holderText(h)}`);
  if (h && f.kind === "blessing" && f.effects?.length)
    parts.push(`Each ${holderText(h)} item`);
  parts.push(...acts);
  if (!parts.length || (f.kind === "rune" && !acts.length))
    parts.push("No part of it applies in this port yet");
  return parts.join(". ") + ".";
}
export const fates = Object.fromEntries(
  fateSource.map((source) => {
    const rule: FateRule = rules[source.id];
    if ((source.kind === "rune" || source.kind === "spell") && !rule.holders)
      throw new Error(`${source.id} needs a target selector`);
    const fate = {
      ...source,
      ...rule,
      art: `/art/fates/${source.id}.webp`,
      unknown: rule.unknown ?? [],
    } as Omit<Fate, "text" | "status">;
    return [
      source.id,
      {
        ...fate,
        status: fate.unknown.length ? "partial" : "exact",
        text: describeFate(fate),
      },
    ];
  }),
) as Record<FateId, Fate>;

export const pendingParity = [
  "map generation",
  "Unity RNG and draw-pile shuffle behind shop offers",
  "villager prices after the second purchase",
  "Fate offer weights, duplicate slots and off-roster price providers",
  "discount stacking",
  "complete round income",
  "combat formulas and content",
  "PvP matchmaking",
];
