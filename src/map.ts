import { z } from "zod";

// Installed 0.77.118d / build 25904130 PlayerTileCollection, in serialized order:
// cube [x, y, z, TileCellInstance.State]. State 1 Unlocked, 2 OutOfBoundsBehindFog,
// 4 Unlockable (installed-demo/build-25904130/assets/current-map-bindings.json; handoff
// 20261013-build118-map-native-delta-next). Bounds (-4,-4,-4) to exclusive (4,4,4).
// prettier-ignore
const cells = [
  [-4, 1, 3, 2], [-4, 2, 2, 2], [-4, 3, 1, 2], [-3, 0, 3, 2], [-3, 1, 2, 2],
  [-3, 2, 1, 2], [-3, 3, 0, 2], [-2, -1, 3, 2], [-2, 0, 2, 2], [-2, 1, 1, 2],
  [-2, 2, 0, 2], [-2, 3, -1, 2], [-1, -2, 3, 2], [-1, -1, 2, 2], [-1, 0, 1, 4],
  [-1, 1, 0, 4], [-1, 2, -1, 4], [-1, 3, -2, 2], [0, -3, 3, 2], [0, -2, 2, 2],
  [0, -1, 1, 4], [0, 0, 0, 4], [0, 1, -1, 4], [0, 2, -2, 4], [0, 3, -3, 2],
  [1, -4, 3, 2], [1, -3, 2, 2], [1, -2, 1, 4], [1, -1, 0, 4], [1, 0, -1, 4],
  [1, 1, -2, 4], [1, 2, -3, 4], [1, 3, -4, 2], [2, -4, 2, 2], [2, -3, 1, 2],
  [2, -2, 0, 4], [2, -1, -1, 4], [2, 0, -2, 1], [2, 1, -3, 4], [2, 2, -4, 2],
  [3, -4, 1, 2], [3, -3, 0, 2], [3, -2, -1, 4], [3, -1, -2, 4], [3, 0, -3, 4],
  [3, 1, -4, 2],
] as const;
const unlocked = 1;
const outOfBounds = 18;

export const tileId = z
  .number()
  .int()
  .min(0)
  .max(cells.length - 1)
  .brand<"TileId">();
export type TileId = z.infer<typeof tileId>;
// TileCellInstance.Type 0..3.
export const terrainId = z.enum(["plains", "rocky", "wildland", "fertile"]);
export type Terrain = z.infer<typeof terrainId>;
// Serialized InitialItems, in request order.
export const featureId = z.enum(["mountain", "forest", "circle-of-stone"]);
export type Feature = z.infer<typeof featureId>;
// Unlocked = owned territory; Unlockable = a playable cell bordering it; Hidden = any other
// playable cell; out-of-bounds = the 27 OutOfBoundsBehindFog cells, never playable.
export const fogState = z.enum([
  "unlocked",
  "unlockable",
  "hidden",
  "out-of-bounds",
]);
export type FogState = z.infer<typeof fogState>;

// Engine axial (q, r) = (-z, -y): PTHexDir Right..DownRight become the client's neighbour order.
export const grid = cells.map(([, y, z, state], id) => ({
  id: tileId.parse(id),
  // 0 - v, not -v: a JSON round trip turns -0 into 0.
  q: 0 - z,
  r: 0 - y,
  playable: (state & outOfBounds) === 0,
}));
export const tileCount = grid.length;
// GenerateRandomStartingZone takes the first Unlocked cell: (2,0,-2).
export const startTile = tileId.parse(
  cells.findIndex(([, , , state]) => state === unlocked),
);
const startCell = grid[startTile];
if (!startCell) throw new Error("The source map has no start cell");
export const start = startCell;
const byAxial = new Map(grid.map((t) => [`${t.q},${t.r}`, t.id]));
const directions = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;
export function neighbours(id: TileId): TileId[] {
  const t = grid[id];
  if (!t) return [];
  return directions.flatMap(
    ([dq, dr]) => byAxial.get(`${t.q + dq},${t.r + dr}`) ?? [],
  );
}
export function adjacent(a: TileId, b: TileId) {
  return neighbours(a).includes(b);
}
// The start plus Take(4) of its neighbours.
export const startingTiles = 5;
// Start plus its six neighbours: the serialized DisallowedPositions of every initial item.
const startZone = [startTile, ...neighbours(startTile)];

// ponytail: Unity Random/Shuffle internals are UNKNOWN, so draws use the engine's seeded LCG;
// the call order (start zone, items, terrain) follows SetupPlayer. Replace once the native RNG is proved.
function stream(seed: number) {
  let cursor = (seed ^ 0x6d617000) >>> 0;
  return (count: number) => {
    cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
    return Math.floor((cursor / 0x100000000) * count);
  };
}

export function sourceMap(seed: number) {
  const range = stream(seed);
  // InitialStateSetup: playable cells become Hidden, the start Unlocked, then Shuffle + Take(4)
  // of the start's neighbours become Unlocked.
  const around = neighbours(startTile);
  for (let i = around.length - 1; i > 0; i--) {
    const j = range(i + 1);
    [around[i], around[j]] = [around[j] as TileId, around[i] as TileId];
  }
  const owned = [startTile, ...around.slice(0, startingTiles - 1)];
  const isUnlocked = (id: TileId) => owned.includes(id);
  // SetupInitialItems: each item goes on a playable Plains cell outside the start zone; a
  // successful placement removes that cell and its neighbours from later candidates. Fitness
  // and insertion are UNKNOWN, so the cell is drawn uniformly.
  const features = new Map<TileId, Feature>();
  const blocked = new Set<TileId>(startZone);
  for (const feature of featureId.options) {
    const candidates = grid.filter((t) => t.playable && !blocked.has(t.id));
    const chosen = candidates[range(candidates.length)];
    if (!chosen) continue;
    features.set(chosen.id, feature);
    for (const id of [chosen.id, ...neighbours(chosen.id)]) blocked.add(id);
  }
  // InitialTypeSetup with the 118 pool: quotas appended Default0, Wildland2, Rocky2, Fertile2;
  // each draw removes a random pool entry.
  const pool: Terrain[] = [
    "wildland",
    "wildland",
    "rocky",
    "rocky",
    "fertile",
    "fertile",
  ];
  const draw = () => pool.splice(range(pool.length), 1)[0] ?? "plains";
  const terrain = new Map<TileId, Terrain>();
  const eligible = grid.filter((t) => t.playable && !features.has(t.id));
  const first = eligible.filter((t) => isUnlocked(t.id));
  if (first.length) {
    const index = range(first.length);
    const chosen = first[index];
    if (chosen) terrain.set(chosen.id, draw());
    // Native passes the subset index to the broader list's RemoveAt; kept as proved.
    eligible.splice(index, 1);
  }
  const remaining = eligible.filter((t) => !isUnlocked(t.id));
  for (
    let budget = 200;
    budget > 0 && pool.length && remaining.length;
    budget--
  ) {
    const data = draw();
    const index = range(remaining.length);
    const chosen = remaining[index];
    if (chosen) terrain.set(chosen.id, data);
    remaining.splice(index, 1);
  }
  return {
    owned,
    tiles: grid.map((t) => ({
      id: t.id,
      q: t.q,
      r: t.r,
      terrain: terrain.get(t.id) ?? ("plains" as Terrain),
      feature: features.get(t.id) ?? null,
    })),
  };
}

export function fog(owned: readonly TileId[]): FogState[] {
  const mine = new Set(owned);
  return grid.map((t) =>
    !t.playable
      ? "out-of-bounds"
      : mine.has(t.id)
        ? "unlocked"
        : neighbours(t.id).some((id) => mine.has(id))
          ? "unlockable"
          : "hidden",
  );
}

// What a player may see: hidden cells conceal their terrain and feature (null). Unlockable cells
// keep theirs: they are the colonize choices, drawn through thin mist.
export type MapRow = [TileId, number, number, Terrain | null, Feature | null];
export function publicMap(seed: number, owned: readonly TileId[]): MapRow[] {
  const states = fog(owned);
  return sourceMap(seed).tiles.map((t) =>
    states[t.id] === "hidden"
      ? [t.id, t.q, t.r, null, null]
      : [t.id, t.q, t.r, t.terrain, t.feature],
  );
}
