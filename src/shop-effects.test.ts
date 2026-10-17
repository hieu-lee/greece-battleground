import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, gameSession, newGame, parseGame } from "./game.ts";
import type { Game } from "./game.ts";
import { grid, tileId } from "./map.ts";
import type { ShopBuildingId } from "./rules.ts";
import { sourceSpawn, sourceUnit } from "./source-numbers.ts";
import {
  boardOf,
  income,
  roundIncome,
  troopCount,
  warband,
} from "./warband.ts";

// Seed 42 map (src/map.ts): Hall 37; Rocky 38,16; Fertile 22,31; Wildland 27,36; Mountain 15,
// Forest 20, Circle of Stone 23. Tiles 42,43,44,35 are Plains with no map item nearby.
const playable = grid.filter((t) => t.playable).map((t) => t.id);
type Row = [number, ShopBuildingId, 1 | 2 | 3, number];
function board(
  rows: Row[],
  clan: Game["clan"] = "stag",
  owned: readonly number[] = playable,
  seed = 42,
) {
  const game = newGame(seed, clan);
  game.owned = owned.map((id) => tileId.parse(id));
  for (const [tile, id, level, workers] of rows)
    game.placements.push({
      tile: tileId.parse(tile),
      id,
      level,
      workers,
      rune: null,
    });
  return parseGame(game);
}
const troops = (game: Game, sprite: string) =>
  warband(game, "polis").filter((u) => u.sprite === sprite);
const hall = (game: Game) => warband(game, "polis")[0];

test("worker producers deploy one troop per Villager at every level; a fourth is refused", () => {
  for (const [id, sprite] of [
    ["spear-camp", "hoplite"],
    ["archer-camp", "tracker"],
    ["javelin-camp", "peltast"],
    ["shield-camp", "hypaspist"],
    ["healers-hut", "asclepiad"],
    ["hall-of-rhapsodes", "rhapsode"],
    ["throne-of-zeus", "elysian-champion"],
  ] as const)
    for (const level of [1, 2, 3] as const) {
      assert.deepEqual(
        [0, 1, 2, 3].map(
          (workers) => troops(board([[42, id, level, workers]]), sprite).length,
        ),
        [0, 1, 2, 3],
        `${id} L${level}`,
      );
      assert.throws(() => board([[42, id, level, 4]]), /Too big/);
    }
  for (const id of ["spear-camp", "menders-hut"] as const) {
    const buyer = newGame(42, "stag");
    buyer.drachmas = 20;
    buyer.shop[0] = { id, price: 4 };
    const bought = apply(buyer, { op: "buy", slot: 0, tile: tileId.parse(30) });
    assert.equal(bought.placements[1]?.workers, 1);
  }
  assert.throws(() => board([[42, "menders-hut", 1, 0]]), /Too few workers/);
  assert.equal(
    troops(board([[42, "menders-hut", 2, 3]]), "battle-physician").length,
    3,
  );
});

test("Altar of Olympus always sends four Shades while its Villagers produce 1/2/3 Insight each", () => {
  for (const [level, workers, insight] of [
    [1, 0, 0],
    [2, 3, 6],
    [3, 3, 9],
  ] as const) {
    const game = board([[42, "altar-of-olympus", level, workers]]);
    const shades = troops(game, "shade");
    assert.equal(shades.length, 4);
    assert.deepEqual(
      [shades[0]?.health, shades[0]?.damage],
      [45 * level, 5 * level],
    );
    assert.equal(income(game)[1] - 5, insight);
  }
  assert.equal(income(board([[38, "silver-mine", 2, 3]]))[0], 11 + 4 + 3);
});

test("fixed producers deploy their serialized count at every level", () => {
  for (const [id, sprite, count, clan] of [
    ["tombs-of-erebus", "spartoi", 2, "stag"],
    ["gate-of-hades", "erinys", 2, "stag"],
    ["gate-of-etna", "fire-titan", 1, "stag"],
    ["gigantes-camp", "cyclops", 1, "stag"],
    ["dactyl-camp", "dactyl", 3, "stag"],
    ["charons-barge", "boreal-giant", 1, "raven"],
    ["wolf-den", "arcadian-wolf", 2, "stag"],
    ["drakon-nest", "drakon", 1, "stag"],
  ] as const)
    for (const level of [1, 2, 3] as const)
      assert.equal(
        troops(board([[42, id, level, 0]], clan), sprite).length,
        count,
        `${id} L${level}`,
      );
});

test("Skull of Typhon deploys one per adjacent Circle of Stone, capped at 2", () => {
  const skull = (tile: number) => {
    const placement = {
      tile: tileId.parse(tile),
      id: "skull-of-typhon" as const,
      level: 1 as const,
      workers: 0,
      rune: null,
    };
    const game = newGame(42, "stag");
    return troopCount(
      boardOf({
        ...game,
        placements: [...game.placements, placement],
      }),
      placement,
    );
  };
  assert.equal(skull(16), 1);
  assert.equal(skull(42), 0);
  assert.equal(sourceSpawn["drakon-colossus"].cap, 2);
});

test("Iris Bridge adds its level bonus to every adjacent Warband camp (DERIVED)", () => {
  const game = board([
    [43, "iris-bridge", 2, 0],
    [42, "spear-camp", 1, 1],
    [44, "shield-camp", 1, 2],
  ]);
  assert.equal(troops(game, "hoplite").length, 3);
  assert.equal(troops(game, "hypaspist").length, 4);
});

test("new troop stat rows equal the installed unit definitions", () => {
  // [health, damage, armor, APS, movement, range, crit] at L1, then health at L3.
  for (const [id, row, health3] of [
    ["spartoi", [150, 8, 0, 0.6499999761581421, 3, 1, 0], 450],
    ["erinys", [250, 15, 50, 0.699999988079071, 3.5, 1, 5], 750],
    ["fire-titan", [750, 20, 300, 0.5, 2, 2, 0], 2250],
    ["rhapsode", [25, 0, 0, 0.699999988079071, 2.5, 6, 0], 75],
    ["asclepiad", [35, 0, 0, 0.4000000059604645, 2.5, 6, 0], 105],
    ["elysian-champion", [200, 12, 30, 0.699999988079071, 3, 1, 0], 600],
    ["shade", [45, 5, 0, 0.699999988079071, 4.5, 1, 0], 135],
    ["cyclops", [550, 10, 0, 0.5, 2, 2, 0], 1650],
    ["dactyl", [30, 5, 0, 0.5, 4.5, 1, 0], 90],
    ["battle-physician", [60, 0, 0, 0.699999988079071, 3, 4, 10], 180],
    ["boreal-giant", [350, 20, 100, 0.4000000059604645, 2, 1.5, 10], 1050],
    ["drakon-colossus", [500, 55, 100, 0.6000000238418579, 2.5, 2, 25], 1500],
    ["arcadian-wolf", [125, 8, 0, 0.800000011920929, 4.5, 1.5, 15], 375],
    ["drakon", [200, 10, 300, 0.5, 3.5, 10, 0], 600],
  ] as const) {
    const u = sourceUnit(id, 1);
    assert.deepEqual(
      [u.health, u.damage, u.armor, u.speed, u.movement, u.range, u.crit],
      row,
      id,
    );
    assert.equal(sourceUnit(id, 3).health, health3, id);
  }
  const titan = sourceUnit("fire-titan", 3);
  assert.deepEqual(
    [titan.armor, titan.damage, titan.burn, titan.cleave],
    [900, 60, 30, 10],
  );
  const drakon = sourceUnit("drakon", 2);
  assert.deepEqual([drakon.armor, drakon.damage, drakon.burn], [600, 20, 20]);
  assert.deepEqual(
    [
      sourceUnit("spartoi", 2).poison,
      sourceUnit("asclepiad", 3).healing,
      sourceUnit("battle-physician", 3).healing,
      sourceUnit("rhapsode", 2).healing,
      sourceUnit("elysian-champion", 3).revive,
      sourceUnit("misthophoros", 3).armor,
      sourceUnit("misthophoros", 3).crit,
    ],
    [10, 30, 45, 30, 1, 45, 10],
  );
});

test("Arcadian Wolf Dens strengthen each other; other neighbours add nothing", () => {
  for (const [level, damage] of [
    [1, 13],
    [3, 39],
  ] as const) {
    const pair = board([
      [42, "wolf-den", level, 0],
      [43, "wolf-den", level, 0],
    ]);
    assert.deepEqual(
      troops(pair, "arcadian-wolf").map((u) => u.damage),
      [damage, damage, damage, damage],
    );
  }
  const lone = board([
    [42, "wolf-den", 3, 0],
    [43, "spear-camp", 1, 0],
  ]);
  assert.equal(troops(lone, "arcadian-wolf")[0]?.damage, 24);
  assert.equal(
    troops(board([[42, "wolf-den", 1, 0]]), "arcadian-wolf")[0]?.damage,
    8,
  );
});

test("Gate of Hades gains 16 Damage per adjacent Divine structure at level 2", () => {
  const game = board([
    [43, "gate-of-hades", 2, 0],
    [42, "apollo-fountain", 1, 0],
    [44, "apollo-fountain", 1, 0],
  ]);
  assert.deepEqual(
    troops(game, "erinys").map((u) => [u.damage, u.crit]),
    [
      [62, 5],
      [62, 5],
    ],
  );
});

test("Altar of Heroes scales adjacent Units by Melee, Ranged and Healer structures on your territory", () => {
  const rows: Row[] = [
    [44, "altar-of-kings", 2, 0],
    [42, "spear-camp", 1, 1],
    [35, "archer-camp", 1, 1],
    [28, "healers-hut", 1, 1],
  ];
  const withoutCircle = board(
    rows,
    "stag",
    playable.filter((id) => id !== 23),
  );
  const chief = hall(withoutCircle);
  assert.deepEqual([chief?.damage, chief?.crit, chief?.regen], [22, 6, 10]);
  assert.deepEqual(income(withoutCircle), [11, 4]);
  // The owned Circle earns1 Insight and adds2 more through the level2 Altar.
  assert.deepEqual(income(board(rows)), [11, 7]);
});

test("Arsenal gives adjacent Units 15 Armor per Melee structure, plus 10 more on Rocky ground", () => {
  const rows = (tile: number): Row[] => [
    [tile, "forge", 1, 0],
    [42, "spear-camp", 1, 1],
    [35, "shield-camp", 1, 1],
  ];
  assert.equal(hall(board(rows(44)))?.armor, 40 + 45);
  assert.equal(hall(board(rows(38)))?.armor, 40 + 75);
});

test("Asclepian Sanctuary adds Healing per adjacent empty owned tile", () => {
  assert.equal(
    troops(board([[42, "healers-hut", 2, 1]]), "asclepiad")[0]?.healing,
    32,
  );
  const crowded = board([
    [42, "healers-hut", 1, 1],
    [43, "silver-mine", 1, 0],
    [36, "silver-mine", 1, 0],
    [35, "silver-mine", 1, 0],
  ]);
  assert.equal(troops(crowded, "asclepiad")[0]?.healing, 10);
});

test("Oikos strengthens adjacent Units and adds a Villager each round only on Fertile ground", () => {
  const fertile = board([
    [22, "house", 1, 0],
    [29, "spear-camp", 1, 1],
  ]);
  assert.deepEqual(
    troops(fertile, "hoplite").map((u) => [u.health, u.regen]),
    [[75, 3]],
  );
  assert.equal(roundIncome(fertile).villagers, 1);
  assert.equal(roundIncome(board([[42, "house", 1, 0]])).villagers, 0);
  const session = gameSession(
    fertile,
    () => {},
    () => {},
  );
  session.act({ revision: 0, actions: [{ op: "ready" }] });
  session.act({ revision: 1, actions: [{ op: "continue" }] });
  for (
    let pass = 0;
    pass < 100 && session.state.phase.kind === "income";
    pass++
  )
    session.update(session.runtime.clock.last + 500);
  assert.equal(session.state.workers, 1);
});

test("Agora earns 6 plus 3 per adjacent Economy structure at level 3", () => {
  // Raven, so Stag's level-3 Civic Splendour Drachma does not add.
  const game = board(
    [
      [43, "agora", 3, 0],
      [42, "silver-mine", 1, 0],
      [44, "silver-mine", 1, 0],
    ],
    "raven",
  );
  assert.equal(income(game)[0], 11 + 12);
});

test("Archer Camp troops gain 2/4/6 Burn per adjacent Terrain item; neighbours receive none", () => {
  const tracker = (rows: Row[]) =>
    troops(board(rows), "tracker").map((u) => u.burn);
  assert.deepEqual(tracker([[42, "archer-camp", 2, 1]]), [0]);
  assert.deepEqual(
    tracker([
      [42, "archer-camp", 2, 3],
      [43, "pit-of-tartarus", 1, 0],
    ]),
    [4, 4, 4],
  );
  assert.deepEqual(
    tracker([
      [42, "archer-camp", 2, 1],
      [43, "pit-of-tartarus", 1, 0],
      [36, "pit-of-tartarus", 1, 0],
    ]),
    [8],
  );
  // The Forest beside tile 28 is a Terrain map item.
  assert.deepEqual(tracker([[28, "archer-camp", 2, 1]]), [4]);
  const neighbour = board([
    [42, "archer-camp", 2, 1],
    [43, "pit-of-tartarus", 1, 0],
    [35, "spear-camp", 1, 1],
  ]);
  assert.equal(troops(neighbour, "hoplite")[0]?.burn, 0);
});

test("multiplied Health, stored-Drachma growth and 118d SheepFold income", () => {
  const tree = board([
    [28, "hesperides-tree", 1, 0],
    [29, "spear-camp", 1, 1],
  ]);
  assert.equal(troops(tree, "hoplite")[0]?.health, 90);
  const barge = board([[42, "charons-barge", 1, 0]], "raven");
  assert.equal(troops(barge, "boreal-giant")[0]?.health, 350 + 5 * 11);
  const fold = board(
    [[42, "sheepfold", 1, 0]],
    "stag",
    [37, 30, 38, 44, 43, 42],
  );
  assert.deepEqual(income(fold), [11 + 2 * 4, 8]);
});

// handoff 20261013-stat-operator-composition-closure-next: per stat, the Add list folds in binary32
// from 0 and the Multiply list from f32(1), Add applied before Multiply.
test("chief Health folds every Add (growth and structures) before King's Resolve", () => {
  const chief = (rows: Row[]) => {
    const game = board([[42, "silver-mine", 3, 0], ...rows]);
    game.chiefBattles = 1;
    game.skills = [1, 1, 3];
    return hall(game)?.health;
  };
  // Handoff table: one Add50 grant, skill 3, one level-3 structure.
  assert.equal(chief([]), 342.20001220703125);
  // Oikos (+30) adjacent to the Hall joins the Add list: f(f(240+80)*f(1+0.18)).
  assert.equal(chief([[44, "house", 1, 0]]), 377.60003662109375);
});
test("Multiply modifiers fold from binary32 1 in list order", () => {
  // Seed 0: tile 30 beside the Hall is Fertile. King's Resolve skill 2 (0.12) then the Pit of
  // Tartarus (x0.2 on Fertile): f(f(f(1)+0.12)+0.2) = 1.3200000524520874, not f(1+f(0.12+0.2)).
  const game = board(
    [
      [30, "pit-of-tartarus", 1, 0],
      [44, "silver-mine", 3, 0],
    ],
    "stag",
    playable,
    0,
  );
  game.skills = [1, 1, 2];
  assert.equal(hall(game)?.health, 316.8000183105469);
});
test("currency-scaled armies stay valid battles: Charon's Barge with a full treasury", () => {
  const game = board([[42, "charons-barge", 3, 0]], "raven");
  game.drachmas = 1_000_000;
  assert.equal(troops(game, "boreal-giant")[0]?.health, 1050 + 15 * 1_000_000);
  const fought = apply(game, { op: "ready" });
  assert.equal(fought.phase.kind, "result");
});
