import { z } from "zod";
import { clanId } from "./clans.ts";
import { featureId, fog, grid, terrainId, tileCount, tileId } from "./map.ts";
import { buildingId, level, levelCaps, runeId, buildings } from "./rules.ts";
import { validFeatureRunes } from "./charm-targets.ts";

export const featureRunes = z.array(z.tuple([tileId, runeId])).max(3);

const farmGrowth = z.number().int().min(0).max(300).multipleOf(5);
const wellGrowth = z.number().int().min(0).max(20);
const otherBuildingId = buildingId.exclude(["polis-hall"]);
const placed = {
  tile: tileId,
  workers: z.number().int().min(0).max(3),
  rune: runeId.nullable(),
};
const noHistoryPlacement = z.discriminatedUnion("id", [
  z
    .object({
      ...placed,
      id: z.literal("polis-hall"),
      level: z.union([level, z.literal(levelCaps.hall)]),
    })
    .strict(),
  z.object({ ...placed, id: otherBuildingId, level }).strict(),
]);
export const placement = z.union([
  noHistoryPlacement,
  z
    .object({ ...placed, id: z.literal("farm"), level, growth: farmGrowth })
    .strict(),
  z
    .object({
      ...placed,
      id: z.literal("offering-well"),
      level,
      growth: wellGrowth,
    })
    .strict(),
]);

export const placementRow = z.union([
  z.tuple([
    tileId,
    z.literal("polis-hall"),
    z.union([level, z.literal(levelCaps.hall)]),
    placed.workers,
    placed.rune,
  ]),
  z.tuple([tileId, otherBuildingId, level, placed.workers, placed.rune]),
  z.tuple([
    tileId,
    z.literal("farm"),
    level,
    placed.workers,
    placed.rune,
    farmGrowth,
  ]),
  z.tuple([
    tileId,
    z.literal("offering-well"),
    level,
    placed.workers,
    placed.rune,
    wellGrowth,
  ]),
]);
export function encodePlacement(
  p: z.infer<typeof placement>,
): z.infer<typeof placementRow> {
  if ("growth" in p)
    return [p.tile, p.id, p.level, p.workers, p.rune, p.growth];
  if (p.id === "polis-hall") return [p.tile, p.id, p.level, p.workers, p.rune];
  return [p.tile, p.id, p.level, p.workers, p.rune];
}
export function decodePlacement(
  row: z.infer<typeof placementRow>,
): z.infer<typeof placement> {
  const [tile, , , workers, rune] = row;
  if (row.length === 6)
    return { tile, id: row[1], level: row[2], workers, rune, growth: row[5] };
  if (row[1] === "polis-hall")
    return { tile, id: row[1], level: row[2], workers, rune };
  return { tile, id: row[1], level: row[2], workers, rune };
}

export const opponentLayout = z
  .object({
    clan: clanId,
    map: z
      .array(
        z.tuple([
          tileId,
          z.number().int(),
          z.number().int(),
          terrainId.nullable(),
          featureId.nullable(),
        ]),
      )
      .length(tileCount),
    owned: z.array(tileId).min(1).max(tileCount),
    featureRunes,
    placements: z
      .array(
        z.tuple([
          tileId,
          buildingId,
          z.union([level, z.literal(levelCaps.hall)]),
          z.number().int().min(0).max(3),
          runeId.nullable(),
        ]),
      )
      .min(1)
      .max(tileCount),
  })
  .strict()
  .superRefine((value, ctx) => {
    const owned = new Set(value.owned);
    const occupied = new Set(value.placements.map(([tile]) => tile));
    const halls = value.placements.filter(([, id]) => id === "polis-hall");
    const states = fog(value.owned);
    if (
      value.map.some(
        ([id, , , terrain, feature]) =>
          states[id] === "hidden" && (terrain !== null || feature !== null),
      ) ||
      value.map.some(
        ([id, q, r], index) =>
          id !== index || grid[index]?.q !== q || grid[index]?.r !== r,
      ) ||
      owned.size !== value.owned.length ||
      occupied.size !== value.placements.length ||
      !validFeatureRunes(
        value.featureRunes,
        value.owned,
        (tile) => value.map[tile]?.[4],
      ) ||
      value.owned.some((id) => !grid[id]?.playable) ||
      value.placements.some(
        ([tile, id, itemLevel, workers]) =>
          !owned.has(tile) ||
          value.map[tile]?.[4] ||
          workers > buildings[id].workerSlots ||
          (id !== "polis-hall" && itemLevel > levelCaps.building),
      ) ||
      halls.length !== 1
    )
      ctx.addIssue({ code: "custom", message: "Invalid opponent settlement" });
  });
export type OpponentLayout = z.infer<typeof opponentLayout>;
