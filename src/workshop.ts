import { z } from "zod";

export const structureId = z.enum([
  "banner-hall",
  "warrior-camp",
  "tracker-camp",
  "farm",
  "woodcutter",
  "defense-tower",
  "healers-hut",
  "brewery",
  "naglfar",
  "gate-of-helheim",
  "volunds-forge",
  "yggdrasil",
]);
export type StructureId = z.infer<typeof structureId>;
export const seasonId = z.enum(["spring", "summer", "autumn", "winter"]);
export type Season = z.infer<typeof seasonId>;
export const tileId = z.number().int().min(0).max(36).brand<"TileId">();
export type TileId = z.infer<typeof tileId>;
export const terrainId = z.enum(["plains", "fertile", "rocky", "forest"]);
export const definitions: Record<
  StructureId,
  { name: string; sprite: string; troop?: string }
> = {
  "banner-hall": {
    name: "Banner Hall",
    sprite: "polis-hall",
  },
  "warrior-camp": {
    name: "Warrior Camp",
    sprite: "spear-camp",
    troop: "hoplite-idle",
  },
  "tracker-camp": {
    name: "Tracker Camp",
    sprite: "archer-camp",
    troop: "tracker-idle",
  },
  farm: { name: "Farm", sprite: "wheat-field" },
  woodcutter: {
    name: "Woodcutter",
    sprite: "woodcutter",
  },
  "defense-tower": {
    name: "Defense Tower",
    sprite: "watchtower",
  },
  "healers-hut": {
    name: "Healer's Hut",
    sprite: "sanctuary",
  },
  brewery: {
    name: "Brewery",
    sprite: "brewery",
  },
  naglfar: { name: "Charon's Barge", sprite: "charons-barge" },
  "gate-of-helheim": { name: "Gate of Hades", sprite: "gate-of-hades" },
  "volunds-forge": { name: "Hephaestus' Forge", sprite: "hephaestus-forge" },
  yggdrasil: { name: "Tree of the Hesperides", sprite: "hesperides-tree" },
};

const placement = z
  .object({ tile: tileId, structure: structureId })
  .strict()
  .readonly();
const saved = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative().default(0),
    seed: z.number().int().min(0).max(4294967295),
    season: seasonId,
    placements: z.array(placement).max(37).readonly(),
  })
  .strict()
  .readonly();
export type Layout = z.infer<typeof saved>;
export const actionSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("place"), tile: tileId, structure: structureId })
    .strict(),
  z.object({ op: z.literal("move"), from: tileId, to: tileId }).strict(),
  z.object({ op: z.literal("remove"), tile: tileId }).strict(),
  z.object({ op: z.literal("season"), value: seasonId }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;

export function newLayout(seed = 77): Layout {
  return {
    version: 1,
    revision: 0,
    seed,
    season: "spring",
    placements: [
      { tile: tileId.parse(18), structure: "banner-hall" },
      { tile: tileId.parse(11), structure: "warrior-camp" },
      { tile: tileId.parse(19), structure: "farm" },
    ],
  };
}

export function parseLayout(input: unknown): Layout {
  const value = saved.parse(input);
  if (
    new Set(value.placements.map((p) => p.tile)).size !==
    value.placements.length
  )
    throw new Error("Duplicate placement tile");
  return value;
}

export function tiles(seed: number) {
  const result = [];
  let random = seed >>> 0;
  for (let q = -3; q <= 3; q++)
    for (let r = -3; r <= 3; r++) {
      if (Math.abs(q + r) > 3) continue;
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const terrain =
        terrainId.options[(random >>> 16) % terrainId.options.length];
      if (!terrain) throw new Error("Invalid terrain index");
      result.push({ id: tileId.parse(result.length), q, r, terrain });
    }
  return result;
}

export function apply(layout: Layout, action: Action): Layout {
  switch (action.op) {
    case "season":
      return { ...layout, season: action.value };
    case "place": {
      if (layout.placements.some((p) => p.tile === action.tile))
        throw new Error("Tile is occupied");
      return {
        ...layout,
        placements: [
          ...layout.placements,
          { tile: action.tile, structure: action.structure },
        ],
      };
    }
    case "remove": {
      if (!layout.placements.some((p) => p.tile === action.tile))
        throw new Error("Tile is empty");
      return {
        ...layout,
        placements: layout.placements.filter((p) => p.tile !== action.tile),
      };
    }
    case "move": {
      const moving = layout.placements.find((p) => p.tile === action.from);
      if (!moving) throw new Error("Source tile is empty");
      if (layout.placements.some((p) => p.tile === action.to))
        throw new Error("Destination is occupied");
      return {
        ...layout,
        placements: layout.placements.map((p) =>
          p.tile === action.from ? { ...p, tile: action.to } : p,
        ),
      };
    }
    default: {
      const impossible: never = action;
      return impossible;
    }
  }
}

const request = z
  .object({
    revision: z.number().int().nonnegative(),
    actions: z.array(actionSchema).min(1).max(16),
  })
  .strict();

export function session(
  initial: Layout,
  persist: (layout: Layout) => void,
  changed: () => void,
) {
  let layout = parseLayout(initial);
  const journal: { revision: number; actions: Action[] }[] = [];
  return {
    get layout() {
      return layout;
    },
    inspect(since?: number) {
      const revision = layout.revision;
      if (
        since !== undefined &&
        since <= revision &&
        since >= Math.max(0, revision - journal.length)
      ) {
        return {
          r: revision,
          changes: journal.filter((x) => x.revision > since),
        };
      }
      return {
        r: revision,
        mode: "layout-workshop",
        season: layout.season,
        seed: layout.seed,
        tiles: tiles(layout.seed).map((t) => [t.id, t.q, t.r, t.terrain]),
        placed: layout.placements.map((p) => [p.tile, p.structure]),
        operations: ["place", "move", "remove", "season"],
      };
    },
    act(input: unknown) {
      const command = request.parse(input);
      if (command.revision !== layout.revision)
        throw new Error("Stale revision; inspect before acting");
      const next = parseLayout({
        ...command.actions.reduce(apply, layout),
        revision: layout.revision + 1,
      });
      persist(next);
      layout = next;
      journal.push({ revision: layout.revision, actions: command.actions });
      if (journal.length > 32) journal.shift();
      changed();
      return { r: layout.revision, changes: command.actions };
    },
  };
}
