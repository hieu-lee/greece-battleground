import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, gameSession, newGame, parseGame } from "./game.ts";
import { opponentLayout } from "./encounter-layout.ts";
import { settlement } from "./warband.ts";
import {
  grid,
  neighbours,
  publicMap,
  sourceMap,
  startTile,
  tileId,
} from "./map.ts";

const ids = (states: readonly string[], wanted: string) =>
  states.flatMap((state, id) => (state === wanted ? [id] : []));

test("the 118 source map has 46 cells: 19 playable around the (2,0,-2) start and 27 behind fog", () => {
  assert.equal(grid.length, 46);
  assert.deepEqual(
    grid.filter((t) => t.playable).map((t) => t.id),
    [
      14, 15, 16, 20, 21, 22, 23, 27, 28, 29, 30, 31, 35, 36, 37, 38, 42, 43,
      44,
    ],
  );
  assert.equal(startTile, 37);
  assert.deepEqual(grid[37], { id: 37, q: 2, r: 0, playable: true });
  assert.deepEqual(neighbours(startTile), [44, 38, 30, 29, 36, 43]);
});

test("seed 42 generates its start zone, items and 2/2/2 terrain deterministically", () => {
  const map = sourceMap(42);
  assert.deepEqual(map, sourceMap(42));
  assert.deepEqual(map.owned, [37, 30, 38, 44, 43]);
  assert.deepEqual(
    map.tiles.flatMap((t) =>
      t.feature || t.terrain !== "plains"
        ? [[t.id, t.feature ?? t.terrain]]
        : [],
    ),
    [
      [15, "mountain"],
      [16, "rocky"],
      [20, "forest"],
      [22, "fertile"],
      [23, "circle-of-stone"],
      [27, "wildland"],
      [31, "fertile"],
      [36, "wildland"],
      [38, "rocky"],
    ],
  );
  assert.notDeepEqual(sourceMap(7).tiles, map.tiles);
});

test("every seed keeps the source quotas, item spacing and one special starting tile", () => {
  const zone = new Set([startTile, ...neighbours(startTile)]);
  for (let seed = 0; seed < 300; seed++) {
    const map = sourceMap(seed);
    const count = (terrain: string) =>
      map.tiles.filter((t) => t.terrain === terrain).length;
    assert.deepEqual(
      [count("rocky"), count("wildland"), count("fertile")],
      [2, 2, 2],
    );
    assert.equal(map.owned.length, 5);
    assert.ok(map.owned.every((id) => zone.has(id)));
    assert.equal(
      map.owned.filter((id) => map.tiles[id]?.terrain !== "plains").length,
      1,
    );
    const items = map.tiles.filter((t) => t.feature);
    assert.deepEqual(items.map((t) => t.feature).sort(), [
      "circle-of-stone",
      "forest",
      "mountain",
    ]);
    for (const item of items) {
      assert.equal(item.terrain, "plains");
      assert.ok(grid[item.id]?.playable && !zone.has(item.id));
      assert.ok(
        items.every((other) => !neighbours(item.id).includes(other.id)),
      );
    }
  }
});

test("engine fog follows owned territory through colonization, saves and the public read model", () => {
  const start = newGame(42, "stag");
  start.workers = 1;
  let saved = "";
  const session = gameSession(
    start,
    (state) => {
      saved = JSON.stringify(state);
    },
    () => {},
  );
  const before = session.inspect().fog;
  assert.deepEqual(ids(before, "unlocked"), [30, 37, 38, 43, 44]);
  assert.deepEqual(ids(before, "unlockable"), [22, 23, 29, 31, 36, 42]);
  assert.deepEqual(ids(before, "hidden"), [14, 15, 16, 20, 21, 27, 28, 35]);
  assert.equal(ids(before, "out-of-bounds").length, 27);
  assert.throws(
    () => session.act({ revision: 0, actions: [{ op: "colonize", tile: 45 }] }),
    /beyond the map/,
  );
  session.act({ revision: 0, actions: [{ op: "colonize", tile: 29 }] });
  const after = session.inspect(0);
  assert.ok("changes" in after);
  const delta = after.changes[0]?.delta.fog;
  assert.ok(Array.isArray(delta));
  assert.deepEqual(ids(delta, "unlockable"), [21, 22, 23, 28, 31, 36, 42]);
  assert.deepEqual(ids(delta, "hidden"), [14, 15, 16, 20, 27, 35]);
  const resumed = gameSession(
    parseGame(JSON.parse(saved)),
    () => {},
    () => {},
  );
  assert.deepEqual(resumed.inspect().fog, delta);
});

test("map features occupy their tile and saves cannot leave the playable map", () => {
  const start = newGame(42, "stag");
  start.workers = 1;
  start.drachmas = 30;
  start.shop[0] = { id: "brewery", price: 4 };
  const owned = apply(start, { op: "colonize", tile: tileId.parse(23) });
  assert.throws(
    () => apply(owned, { op: "buy", slot: 0, tile: tileId.parse(23) }),
    /map feature/,
  );
  const built = apply(owned, { op: "buy", slot: 0, tile: tileId.parse(30) });
  assert.throws(
    () =>
      apply(built, {
        op: "move",
        from: tileId.parse(30),
        to: tileId.parse(23),
      }),
    { message: "A map feature occupies this tile" },
  );
  for (const invalid of [
    { ...start, owned: [...start.owned, tileId.parse(45)] },
    { ...start, owned: start.owned.filter((id) => id !== 44) },
    {
      ...owned,
      placements: [
        ...owned.placements,
        { tile: 23, id: "brewery", level: 1, workers: 0, rune: null },
      ],
    },
  ])
    assert.throws(() => parseGame(invalid));
});

test("frozen opponent layouts carry the 46-cell source map and reject altered geometry", () => {
  const layout = settlement(newGame(42, "raven"));
  assert.deepEqual(opponentLayout.parse(layout), layout);
  assert.deepEqual(layout.map[23], [23, 2, -2, "plains", "circle-of-stone"]);
  const moved = structuredClone(layout);
  moved.map[37] = [tileId.parse(37), 0, 0, "plains", null];
  assert.throws(() => opponentLayout.parse(moved));
  const builtBeside = structuredClone(layout);
  builtBeside.placements.push([tileId.parse(30), "brewery", 1, 0, null]);
  assert.doesNotThrow(() => opponentLayout.parse(builtBeside));
  const builtOnItem = structuredClone(layout);
  builtOnItem.owned.push(tileId.parse(23));
  builtOnItem.placements.push([tileId.parse(23), "brewery", 1, 0, null]);
  assert.throws(() => opponentLayout.parse(builtOnItem));
});

test("hidden cells conceal terrain and features in public map rows and frozen layouts until bordered", () => {
  const game = newGame(42, "raven");
  // Seed 42 hides Rocky 16, Mountain 15 and Forest 20 beyond the starting border.
  const rows = publicMap(game.seed, game.owned);
  assert.deepEqual(rows[16], [16, 1, -2, null, null]);
  assert.deepEqual(rows[15], [15, 0, -1, null, null]);
  assert.deepEqual(rows[20], [20, -1, 1, null, null]);
  assert.deepEqual(rows[23], [23, 2, -2, "plains", "circle-of-stone"]);
  const layout = settlement(game);
  assert.deepEqual(layout.map[16], [16, 1, -2, null, null]);
  assert.ok(!JSON.stringify(layout.map).includes("mountain"));
  const leaked = structuredClone(layout);
  leaked.map[16] = [tileId.parse(16), 1, -2, "rocky", null];
  assert.throws(() => opponentLayout.parse(leaked));
  game.workers = 1;
  const bordered = apply(game, { op: "colonize", tile: tileId.parse(22) });
  assert.deepEqual(publicMap(bordered.seed, bordered.owned)[16], [
    16,
    1,
    -2,
    "rocky",
    null,
  ]);
});
