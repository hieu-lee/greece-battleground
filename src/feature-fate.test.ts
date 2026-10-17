import assert from "node:assert/strict";
import { test } from "node:test";
import { fatePool, gameSession, newGame, parseGame } from "./game.ts";
import type { Command, Game } from "./game.ts";
import { opponentLayout } from "./encounter-layout.ts";
import { sourceMap, startTile, tileId } from "./map.ts";
import type { TileId } from "./map.ts";
import type { FateId } from "./rules.ts";
import { sourceItemCosts } from "./source-numbers.ts";
import { income, settlement, warband } from "./warband.ts";

// Trusted source offers/wallets; purchases, territory, attachment and claims use Game.act.
// Literal contracts: evidence/fate-targeting-2026-10-16. No Unity RNG claim.
const tile = tileId.parse;
const circleTile = tile(23);
type Session = ReturnType<typeof gameSession>;
type ShopId = NonNullable<Game["shop"][number]>["id"];
const offer = (id: ShopId) => ({ id, price: sourceItemCosts[id] });
function fixture(shop: Game["shop"] = [null, null, null, null]) {
  const initial = newGame(42, "stag");
  initial.drachmas = 200;
  initial.insight = 200;
  initial.workers = 3;
  initial.favor = { zeus: 10, athena: 10, apollo: 10 };
  initial.shop = shop;
  return initial;
}
function open(initial: Game) {
  let persisted = "";
  const game = gameSession(
    initial,
    (next) => {
      persisted = JSON.stringify(next);
    },
    () => {},
  );
  return {
    game,
    saved() {
      assert.notEqual(
        persisted,
        "",
        "a real transaction must persist the save",
      );
      return persisted;
    },
  };
}
function act(game: Session, ...actions: Command[]) {
  return game.act({ revision: game.state.revision, actions });
}
function finishIncome(game: Session) {
  for (let pass = 0; pass < 100 && game.state.phase.kind === "income"; pass++)
    game.update(game.runtime.clock.last + 500);
}
function offered(initial: Game, card: FateId) {
  initial.fate = [card, null, null];
  return open(initial);
}
function circle(card: FateId, initial = fixture()) {
  const setup = open(initial);
  assert.equal(
    sourceMap(initial.seed).tiles[circleTile]?.feature,
    "circle-of-stone",
  );
  act(setup.game, { op: "colonize", tile: circleTile });
  return offered(setup.game.state, card);
}
function unit(game: Game, at: TileId) {
  const found = warband(game, "polis").find(
    (fighter) => fighter.origin?.tile === at,
  );
  assert.ok(found, `expected a real unit at tile ${at}`);
  return found;
}
function resume(saved: string) {
  return open(parseGame(JSON.parse(saved)));
}

test("colonizing Circle makes its Knowledge charms eligible for real Fate offers", () => {
  const { game } = open(fixture());
  assert.equal(fatePool(game.state).includes("read-the-oracle"), false);
  act(game, { op: "colonize", tile: circleTile });
  const pool = fatePool(game.state);
  for (const id of [
    "read-the-oracle",
    "wisdom-into-wealth",
    "aegis-of-thought",
  ] as const)
    assert.equal(pool.includes(id), true, id);
});

test("Circle Read Oracle recurs across JSON resume; replacing it with Wealth leaves only remapped base income", () => {
  const first = circle("read-the-oracle");
  assert.deepEqual(income(first.game.state), [11, 5]);
  act(first.game, { op: "fate", slot: 0, tile: circleTile });
  assert.deepEqual(
    [first.game.state.drachmas, first.game.state.insight],
    [200, 196],
  );
  assert.deepEqual(income(first.game.state), [11, 6]);
  assert.deepEqual(first.game.inspect().fate, [null, null, null]);
  assert.match(JSON.stringify(first.game.inspect()), /read-the-oracle/);

  const reopened = resume(first.saved());
  assert.deepEqual(income(reopened.game.state), [11, 6]);
  const before = reopened.game.state;
  act(reopened.game, { op: "ready" }, { op: "continue" });
  finishIncome(reopened.game);
  assert.deepEqual(
    [
      reopened.game.state.drachmas - before.drachmas,
      reopened.game.state.insight - before.insight,
    ],
    [11, 6],
  );
  const replacement = offered(
    parseGame(JSON.parse(reopened.saved())),
    "wisdom-into-wealth",
  );
  const storedInsight = replacement.game.state.insight;
  act(replacement.game, { op: "fate", slot: 0, tile: circleTile });
  assert.equal(replacement.game.state.insight, storedInsight - 4);
  assert.deepEqual(income(replacement.game.state), [12, 4]);
  const final = resume(replacement.saved());
  const paid = final.game.state;
  act(final.game, { op: "ready" }, { op: "continue" });
  finishIncome(final.game);
  assert.deepEqual(
    [
      final.game.state.drachmas - paid.drachmas,
      final.game.state.insight - paid.insight,
    ],
    [12, 4],
  );
});

for (const [card, health, damage, ward] of [
  ["aegis-of-thought", 45, 5, 1],
  ["rites-of-eleusis", 75, 15, 0],
] as const) {
  test(`${card} on Circle reaches adjacent Units and survives save plus opponent-layout serialization`, () => {
    const current = circle(
      card,
      fixture([offer("spear-camp"), offer("spear-camp"), null, null]),
    );
    act(
      current.game,
      { op: "buy", slot: 0, tile: tile(30) },
      { op: "buy", slot: 1, tile: tile(38) },
    );
    act(current.game, { op: "fate", slot: 0, tile: circleTile });
    const restored = resume(current.saved());
    const adjacent = unit(restored.game.state, tile(30));
    const distant = unit(restored.game.state, tile(38));
    assert.deepEqual(
      [adjacent.health, adjacent.damage, adjacent.ward],
      [health, damage, ward],
    );
    assert.deepEqual(
      [distant.health, distant.damage, distant.ward],
      [45, 5, 0],
    );
    const frozen = opponentLayout.parse(
      JSON.parse(JSON.stringify(settlement(restored.game.state))),
    );
    assert.equal(
      JSON.stringify(frozen).includes(card),
      true,
      "frozen rival layout must retain the feature charm",
    );
    assert.deepEqual(restored.game.inspect().fate, [null, null, null]);
    assert.equal(JSON.stringify(restored.game.inspect()).includes(card), true);
  });
}

test("Communal History may attach to Circle without paying its deferred income during purchase or reload", () => {
  const current = circle(
    "memory-of-the-polis",
    fixture([offer("farm"), null, null, null]),
  );
  act(current.game, { op: "buy", slot: 0, tile: tile(30) });
  const before = current.game.state;
  act(current.game, { op: "fate", slot: 0, tile: circleTile });
  assert.deepEqual(
    [current.game.state.drachmas, current.game.state.insight],
    [before.drachmas, before.insight - 16],
  );
  const restored = resume(current.saved());
  assert.deepEqual(
    [restored.game.state.drachmas, restored.game.state.insight],
    [before.drachmas, before.insight - 16],
  );
  assert.deepEqual(restored.game.inspect().fate, [null, null, null]);
  assert.match(JSON.stringify(restored.game.inspect()), /memory-of-the-polis/);
  // Source drops wait for IncomePhase and elapsed-time predicates; no claim or
  // roundIncome assertion here invents their order against Gather Secrets.
});

test("Athena Might stacks a newly owned Circle holder with an existing Knowledge structure", () => {
  const initial = fixture([
    offer("spear-camp"),
    offer("spring-of-mnemosyne"),
    null,
    null,
  ]);
  const current = offered(initial, "athenas-might");
  act(
    current.game,
    { op: "buy", slot: 0, tile: tile(30) },
    { op: "buy", slot: 1, tile: tile(38) },
  );
  act(current.game, { op: "fate", slot: 0 });
  const locked = unit(current.game.state, tile(30));
  assert.deepEqual([locked.health, locked.damage, locked.crit], [70, 10, 5]);
  act(current.game, { op: "colonize", tile: circleTile });
  const restored = resume(current.saved());
  const unlocked = unit(restored.game.state, tile(30));
  assert.deepEqual(
    [unlocked.health, unlocked.damage, unlocked.crit],
    [95, 15, 10],
  );
});

test("Shield Wall grants20 Armor to the source Warrior with enabled Armor0", () => {
  const current = offered(
    fixture([offer("spear-camp"), null, null, null]),
    "athenas-shield-wall",
  );
  act(current.game, { op: "buy", slot: 0, tile: tile(30) });
  assert.equal(unit(current.game.state, tile(30)).armor, 0);
  act(current.game, { op: "fate", slot: 0 });
  assert.equal(unit(resume(current.saved()).game.state, tile(30)).armor, 20);
});

// ScabbardOfGram is the sixth source-census exclusion, but has no represented
// runtime ID. It remains outside this journey; treasures stay excluded.
for (const [id, card] of [
  ["pit-of-tartarus", "fury-of-the-titans"],
  ["hephaestus-forge", "fury-of-the-titans"],
  ["iris-bridge", "rites-of-eleusis"],
  ["sacred-fire", "rites-of-eleusis"],
  ["hesperides-tree", "rites-of-eleusis"],
] as const) {
  test(`${card} rejects ${id}: matching tags without an ordinary stat or currency receiver cost nothing`, () => {
    const current = offered(fixture([offer(id), null, null, null]), card);
    act(current.game, { op: "buy", slot: 0, tile: tile(30) });
    const before = current.game.state;
    const encoded = current.saved();
    assert.throws(
      () => act(current.game, { op: "fate", slot: 0, tile: tile(30) }),
      /target|receiver/i,
    );
    assert.deepEqual(current.game.state, before);
    assert.equal(current.saved(), encoded);
  });
}

test("Achilles Charge keeps its supported siblings through purchase, JSON and the actual battle snapshot", () => {
  const current = offered(fixture(), "achilles-charge");
  act(current.game, { op: "fate", slot: 0, tile: startTile });
  const restored = resume(current.saved());
  const chief = unit(restored.game.state, startTile);
  assert.deepEqual(
    [chief.damage, chief.crit, chief.cleave, chief.health, chief.armor],
    [12.5, 20, 3, 240, 40],
  );
  act(restored.game, { op: "ready" });
  const phase = restored.game.state.phase;
  assert.ok(phase.kind === "result");
  const deployed = phase.encounter.fighters.find(
    (fighter) => fighter.side === "polis" && fighter.origin?.tile === startTile,
  );
  assert.ok(deployed);
  assert.deepEqual(
    [deployed.damage, deployed.crit, deployed.cleave],
    [12.5, 20, 3],
  );
});

test("Fury's two adjacent Warbands scale Cleave while obsolete20/21 leave its supported stats intact", () => {
  const setup = open(
    fixture([
      offer("gigantes-camp"),
      offer("spear-camp"),
      offer("archer-camp"),
      null,
    ]),
  );
  act(
    setup.game,
    { op: "buy", slot: 0, tile: tile(30) },
    { op: "buy", slot: 1, tile: tile(38) },
    { op: "colonize", tile: tile(29) },
    { op: "buy", slot: 2, tile: tile(29) },
  );
  const current = offered(setup.game.state, "fury-of-the-titans");
  assert.deepEqual(
    [
      unit(current.game.state, tile(30)).health,
      unit(current.game.state, tile(30)).cleave,
    ],
    [630, 3],
  );
  act(current.game, { op: "fate", slot: 0, tile: tile(30) });
  const cyclops = unit(resume(current.saved()).game.state, tile(30));
  assert.deepEqual(
    [cyclops.health, cyclops.damage, cyclops.crit, cyclops.cleave],
    [630, 10, 5, 5],
  );
});

test("a later invalid action rolls back Circle attachment, payment, favor and persisted bytes", () => {
  const current = circle("aegis-of-thought");
  act(current.game, { op: "reroll-shop" });
  const before = current.game.state;
  const encoded = current.saved();
  assert.throws(
    () =>
      act(
        current.game,
        { op: "fate", slot: 0, tile: circleTile },
        { op: "move", from: startTile, to: circleTile },
      ),
    /feature|occupied/i,
  );
  assert.deepEqual(current.game.state, before);
  assert.equal(current.saved(), encoded);
  act(current.game, { op: "fate", slot: 0, tile: circleTile });
  assert.equal(current.game.state.insight, before.insight - 8);
});
