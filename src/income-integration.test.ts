import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession, newGame, parseGame } from "./game.ts";
import type { Command, Game } from "./game.ts";
import { sourceMap, startTile, tileId } from "./map.ts";
import { sourceItemCosts } from "./source-numbers.ts";
import { income, settlement, warband } from "./warband.ts";
import { opponentLayout } from "./encounter-layout.ts";

// Source fixtures: ordinary authored items/offers, retained wallet and acquired powers.
// Every mutation and round transition goes through the public Game transaction owner.
function fixture() {
  const initial = newGame(42, "stag");
  initial.drachmas = 200;
  initial.insight = 200;
  return initial;
}
function session(initial: Game) {
  return gameSession(initial, () => {}, () => {}, undefined, { now: 0 });
}
type Session = ReturnType<typeof session>;
function act(game: Session, ...actions: Command[]) {
  game.act({ revision: game.state.revision, actions });
}
const times = new WeakMap<Session, number>();
function claim(game: Session) {
  act(game, { op: "ready" }, { op: "continue" });
  let now = times.get(game) ?? 0;
  while (game.state.phase.kind === "income") game.update(now += 500);
  times.set(game, now);
}
const tile = tileId.parse;
const offer = (id: NonNullable<Game["shop"][number]>["id"]) => ({
  id,
  price: sourceItemCosts[id],
});

for (const [card, structure, currency, expected] of [
  ["hermes-fair-trade", "farm", "drachmas", 13],
  ["read-the-oracle", "watchtower", "insight", 6],
] as const) {
  test(`${card} modifies recurring item income without a purchase or refresh payout`, () => {
    const initial = fixture();
    initial.shop = [offer(structure), null, null, null];
    initial.fate = [card, null, null];
    const game = session(initial);
    act(game, { op: "buy", slot: 0, tile: tile(30) });
    const before = game.state[currency];
    act(game, { op: "fate", slot: 0, tile: tile(30) });
    assert.equal(game.state[currency], before - (currency === "insight" ? 4 : 0));
    const afterPurchase = game.state[currency];
    act(game, { op: "reroll-shop" });
    const afterRefresh = game.state[currency];
    assert.equal(afterRefresh, afterPurchase);
    claim(game);
    assert.equal(game.state[currency] - afterRefresh, expected);
    const resumed = session(parseGame(JSON.parse(JSON.stringify(game.state))));
    const previous = resumed.state[currency];
    claim(resumed);
    assert.equal(resumed.state[currency] - previous, expected);
  });
}

test("replacing Read the Oracle removes its ordinary grant; Wealth remaps only the attached item", () => {
  const initial = fixture();
  initial.workers = 1;
  initial.shop = [offer("watchtower"), null, null, null];
  initial.fate = ["read-the-oracle", null, null];
  const game = session(initial);
  act(game, { op: "buy", slot: 0, tile: tile(30) }, { op: "fate", slot: 0, tile: tile(30) });
  const replacement = game.state;
  replacement.fate = ["wisdom-into-wealth", null, null];
  replacement.fateChosen = false;
  const resumed = session(replacement);
  act(resumed, { op: "fate", slot: 0, tile: tile(30) }, { op: "colonize", tile: tile(23) });
  assert.equal(sourceMap(resumed.state.seed).tiles[23]?.feature, "circle-of-stone");
  assert.deepEqual(income(resumed.state), [12, 5]);
  const before = resumed.state;
  claim(resumed);
  assert.deepEqual(
    [resumed.state.drachmas - before.drachmas, resumed.state.insight - before.insight],
    [12, 5],
  );
});

test("Growing Might grants +5/+15 at each next RoundStart, including after reload, without purchase or refresh growth", () => {
  const initial = fixture();
  initial.fate = ["growing-might-of-heracles", null, null];
  const game = session(initial);
  act(game, { op: "fate", slot: 0 }, { op: "reroll-shop" });
  assert.deepEqual(game.state.chiefGrowth, { damage: 0, health: 0 });
  claim(game);
  assert.deepEqual(game.state.chiefGrowth, { damage: 5, health: 15 });
  const resumed = session(parseGame(JSON.parse(JSON.stringify(game.state))));
  act(resumed, { op: "reroll-shop" });
  assert.deepEqual(resumed.state.chiefGrowth, { damage: 5, health: 15 });
  claim(resumed);
  assert.deepEqual(resumed.state.chiefGrowth, { damage: 10, health: 30 });
  const unit = warband(resumed.state, "polis").find((u) => u.origin?.tile === startTile);
  assert.ok(unit);
  const plain = resumed.state;
  plain.chiefGrowth = { damage: 0, health: 0 };
  const base = warband(plain, "polis").find((u) => u.origin?.tile === startTile);
  assert.ok(base);
  assert.deepEqual([unit.damage - base.damage, unit.health - base.health], [10, 30]);
});

test("Gather Secrets reads live Insight after its Hall income, using floor at each threshold", () => {
  for (const [before, after] of [[0, 4], [1, 6], [5, 10], [12, 19]] as const) {
    const initial = fixture();
    initial.insight = before;
    initial.blessings = ["secrets-of-the-oracle"];
    const game = session(initial);
    claim(game);
    assert.equal(game.state.insight, after, `stored Insight ${before}`);
  }
});

test("initial Circle is dormant before colonization and pays one Insight before Gather's Hall when unlocked", () => {
  const initial = fixture();
  initial.insight = 0;
  initial.workers = 1;
  initial.blessings = ["secrets-of-the-oracle"];
  const locked = session(initial);
  claim(locked);
  assert.equal(locked.state.insight, 4);
  const unlocked = session(initial);
  act(unlocked, { op: "colonize", tile: tile(23) });
  claim(unlocked);
  assert.equal(unlocked.state.insight, 6);
});

test("Hall empty movement survives JSON resume and opponent layout without moving territory or granting growth", () => {
  const game = session(fixture());
  act(game, { op: "move", from: startTile, to: tile(30) });
  const resumed = parseGame(JSON.parse(JSON.stringify(game.state)));
  assert.equal(resumed.placements.find((p) => p.id === "polis-hall")?.tile, 30);
  assert.deepEqual(resumed.owned, fixture().owned);
  assert.deepEqual(resumed.chiefGrowth, { damage: 0, health: 0 });
  assert.equal(opponentLayout.parse(settlement(resumed)).placements[0]?.[0], 30);
  assert.deepEqual(warband(resumed, "polis")[0]?.origin, { side: "polis", tile: 30 });
});

test("occupied Hall exchange moves complete instances atomically and changes Gather's place in the source entry traversal", () => {
  const initial = fixture();
  initial.insight = 0;
  initial.blessings = ["secrets-of-the-oracle"];
  initial.shop = [offer("spring-of-mnemosyne"), null, null, null];
  const game = session(initial);
  act(game, { op: "buy", slot: 0, tile: tile(30) });
  const original = session(game.state);
  claim(original);
  assert.equal(original.state.insight, 5);
  act(game, { op: "move", from: startTile, to: tile(30) });
  assert.deepEqual(game.state.placements.map((p) => [p.id, p.tile]), [
    ["polis-hall", 30], ["spring-of-mnemosyne", 37],
  ]);
  const resumed = session(parseGame(JSON.parse(JSON.stringify(game.state))));
  claim(resumed);
  assert.equal(resumed.state.insight, 6);
});

test("sold entry holes reuse their LIFO order across JSON resume and later occupied exchanges", () => {
  const initial = fixture();
  initial.insight = 0;
  initial.blessings = ["secrets-of-the-oracle"];
  initial.shop = [offer("spring-of-mnemosyne"), offer("watchtower"), offer("farm"), offer("spring-of-mnemosyne")];
  const game = session(initial);
  act(game, { op: "buy", slot: 0, tile: tile(30) }, { op: "buy", slot: 1, tile: tile(38) });
  act(game, { op: "sell", tile: tile(30) }, { op: "sell", tile: tile(38) });
  const resumed = session(parseGame(JSON.parse(JSON.stringify(game.state))));
  act(resumed, { op: "buy", slot: 2, tile: tile(30) }, { op: "buy", slot: 3, tile: tile(38) });
  act(resumed, { op: "move", from: startTile, to: tile(30) });
  claim(resumed);
  assert.equal(resumed.state.insight, 6);
});

test("same-item upgrades retain their existing entry before a displaced Hall", () => {
  const initial = fixture();
  initial.insight = 0;
  initial.blessings = ["secrets-of-the-oracle"];
  initial.shop = [offer("spring-of-mnemosyne"), offer("spring-of-mnemosyne"), null, null];
  const game = session(initial);
  act(game, { op: "buy", slot: 0, tile: tile(30) }, { op: "move", from: startTile, to: tile(30) });
  act(game, { op: "buy", slot: 1, tile: startTile });
  claim(game);
  assert.equal(game.state.insight, 7);
});

test("exchanging a Hall with a camp preserves the entry order of resulting fighters", () => {
  const initial = fixture();
  initial.shop = [offer("spear-camp"), null, null, null];
  const game = session(initial);
  act(game, { op: "buy", slot: 0, tile: tile(30) }, { op: "move", from: startTile, to: tile(30) });
  assert.deepEqual(warband(game.state, "polis").map((u) => [u.sprite, u.origin?.tile]), [
    ["hoplite", 37], ["aegeus", 30],
  ]);
  act(game, { op: "ready" });
  assert.equal(game.state.phase.kind, "result");
});

test("Hall sale and invalid feature or same-item exchanges fail without changing the transaction", () => {
  const initial = fixture();
  initial.shop = [offer("farm"), offer("farm"), null, null];
  initial.workers = 1;
  const game = session(initial);
  act(game, { op: "buy", slot: 0, tile: tile(30) }, { op: "buy", slot: 1, tile: tile(38) });
  const before = game.state;
  assert.throws(() => act(game, { op: "move", from: tile(30), to: tile(38) }), /same|occupied|merge/i);
  assert.throws(() => act(game, { op: "sell", tile: startTile }), /cannot be sold/);
  assert.throws(() => act(game, { op: "colonize", tile: tile(23) }, { op: "move", from: startTile, to: tile(23) }), /feature|occupied/i);
  assert.deepEqual(game.state, before);
});

test("serialized entry receipts reject duplicate members, missing features and malformed free slots", () => {
  const initial = fixture();
  initial.shop = [offer("farm"), null, null, null];
  const game = session(initial);
  act(game, { op: "buy", slot: 0, tile: tile(30) }, { op: "sell", tile: tile(30) });
  const saved = game.state;
  assert.ok(saved.itemEntries, "collection mutations must retain their entry receipt");
  assert.deepEqual(parseGame(JSON.parse(JSON.stringify(saved))), saved);
  assert.throws(() => parseGame({ ...saved, itemEntries: { ...saved.itemEntries, free: [] } }), /entr|free|slot/i);
  const slots = [...saved.itemEntries.slots];
  slots[0] = startTile;
  assert.throws(() => parseGame({ ...saved, itemEntries: { ...saved.itemEntries, slots } }), /entr|feature|slot/i);
  assert.throws(() => parseGame({ ...saved, itemEntries: { ...saved.itemEntries, free: [4, 4] } }), /entr|free|slot/i);
});
