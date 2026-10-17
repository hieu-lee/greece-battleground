import { z } from "zod";
import { featureId, sourceMap, tileCount, tileId } from "./map.ts";
import type { TileId } from "./map.ts";
import type { Game } from "./game.ts";

// Cell/reference Dictionary entries enumerate by slot and reuse removed slots LIFO.
export const itemEntries = z
  .object({
    slots: z.array(tileId.nullable()).min(1).max(tileCount),
    free: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(tileCount - 1),
      )
      .max(tileCount),
  })
  .strict();
type Entries = z.infer<typeof itemEntries>;
type Collection = Pick<Game, "seed" | "placements" | "itemEntries">;

function initialEntries(game: Collection): Entries {
  const tiles = sourceMap(game.seed).tiles;
  return {
    slots: [
      ...featureId.options.flatMap((feature) =>
        tiles.filter((tile) => tile.feature === feature).map((tile) => tile.id),
      ),
      ...game.placements.map((p) => p.tile),
    ],
    free: [],
  };
}

export function entryTiles(game: Collection): TileId[] {
  return (game.itemEntries ?? initialEntries(game)).slots.filter(
    (tile) => tile !== null,
  );
}

// Native saved-run Load clears the dictionary, then reinserts saved pairs in order.
export function resumeEntries(game: Game): Game {
  return game.itemEntries?.free.length
    ? { ...game, itemEntries: { slots: entryTiles(game), free: [] } }
    : game;
}

export function validateEntries(game: Collection) {
  const entries = game.itemEntries;
  if (!entries) return;
  const expected = new Set(initialEntries(game).slots);
  const members = entries.slots.filter((tile) => tile !== null);
  const free = new Set(entries.free);
  if (
    members.length !== expected.size ||
    new Set(members).size !== members.length ||
    members.some((tile) => !expected.has(tile)) ||
    free.size !== entries.free.length ||
    entries.free.some((slot) => entries.slots[slot] !== null) ||
    entries.slots.some((tile, slot) => (tile === null) !== free.has(slot))
  )
    throw new Error("Invalid item entry slots or free list");
}

function materialize(game: Collection): Entries {
  return (game.itemEntries ??= initialEntries(game));
}

export function addEntry(game: Collection, tile: TileId) {
  const entries = materialize(game);
  const slot = entries.free.pop();
  if (slot === undefined) entries.slots.push(tile);
  else entries.slots[slot] = tile;
}

export function removeEntry(game: Collection, tile: TileId) {
  const entries = materialize(game);
  const slot = entries.slots.indexOf(tile);
  if (slot < 0) throw new Error("Missing item entry");
  entries.slots[slot] = null;
  entries.free.push(slot);
}
