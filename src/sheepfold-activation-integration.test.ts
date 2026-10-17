import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSession, newGame, parseGame } from "./game.ts";
import type { Command, Game } from "./game.ts";
import { tileId } from "./map.ts";
import { catalogTool } from "./play-catalog.ts";
import { sourceItemCosts } from "./source-numbers.ts";
import { ordinaryIncome, practiceMatch } from "./warband.ts";

const tile = tileId.parse;
const authority = { offerIndex: () => 0, encounter: practiceMatch };
const wallet = (state: Game) => [state.drachmas, state.insight];
const owner = (state: Game) =>
  gameSession(
    state,
    () => {},
    () => {},
    authority,
    { now: 0 },
  );
type Session = ReturnType<typeof owner>;
function act(session: Session, ...actions: Command[]) {
  session.act({ revision: session.state.revision, actions });
}
function fixture() {
  const state = newGame(42, "raven", "practice", () => 0);
  state.drachmas = 200;
  state.insight = 20;
  state.shop = [
    { id: "sheepfold", price: sourceItemCosts.sheepfold },
    { id: "sheepfold", price: sourceItemCosts.sheepfold },
    { id: "sheepfold", price: sourceItemCosts.sheepfold },
    null,
  ];
  return parseGame(state);
}
function purchase(session: Session, level: 1 | 2 | 3) {
  for (const slot of [0, 1, 2] as const)
    if (slot < level) act(session, { op: "buy", slot, tile: tile(30) });
  assert.equal(
    session.state.placements.find((p) => p.id === "sheepfold")?.level,
    level,
  );
  assert.deepEqual(session.state.owned, [37, 30, 38, 44, 43]);
  assert.equal(session.state.placements.length, 2);
  assert.deepEqual(wallet(session.state), [200 - 12 * level, 20]);
}
function begin(session: Session) {
  const before = wallet(session.state);
  act(session, { op: "ready" });
  assert.deepEqual(
    wallet(session.state),
    before,
    "Ready grants no Sheepfold income",
  );
  act(session, { op: "continue" });
  assert.equal(session.state.phase.kind, "income");
}

for (const level of [1, 2, 3] as const) {
  test(`Sheepfold level${level} duplicate purchases expose one Coins then Lore payment group without purchase/read/reload credit`, () => {
    const session = owner(fixture());
    try {
      purchase(session, level);
      const before = wallet(session.state);
      const encoded = JSON.stringify(session.state);
      const resumed = parseGame(JSON.parse(encoded));
      assert.deepEqual(wallet(resumed), before);
      for (const state of [session.state, resumed])
        assert.deepEqual(
          ordinaryIncome(state).filter((group) => group.tile === 30),
          [
            {
              tile: 30,
              payments: [
                { currency: "drachmas", amount: 6 * level },
                { currency: "insight", amount: 3 * level },
              ],
            },
          ],
        );
      assert.equal(JSON.stringify(session.state), encoded);
    } finally {
      session.dispose();
    }
  });

  test(`Sheepfold level${level} actual Income pays Coins before Lore, waits after the final key, and repeats once after completed-save reopening`, () => {
    const session = owner(fixture());
    try {
      purchase(session, level);
      const coins = session.state.drachmas;
      begin(session);
      assert.deepEqual(wallet(session.state), [coins + 11, 20]);
      session.update(499);
      assert.deepEqual(wallet(session.state), [coins + 11, 20]);
      session.update(500);
      assert.deepEqual(wallet(session.state), [coins + 11, 24]);
      session.update(1000);
      assert.deepEqual(wallet(session.state), [coins + 11 + 6 * level, 24]);
      session.update(1499);
      assert.deepEqual(wallet(session.state), [coins + 11 + 6 * level, 24]);
      session.update(1500);
      assert.deepEqual(wallet(session.state), [
        coins + 11 + 6 * level,
        24 + 3 * level,
      ]);
      assert.equal(
        session.state.phase.kind,
        "income",
        "final Lore key still owns its half-second wait",
      );
      session.update(1999);
      assert.equal(session.state.phase.kind, "income");
      session.update(2000);
      assert.equal(session.state.phase.kind, "prepare");
      const saved = JSON.stringify(session.state);
      const resumed = owner(parseGame(JSON.parse(saved)));
      try {
        const paid = wallet(resumed.state);
        assert.deepEqual(paid, [coins + 11 + 6 * level, 24 + 3 * level]);
        resumed.update(5000);
        assert.deepEqual(
          wallet(resumed.state),
          paid,
          "opening preparation never repays income",
        );
        begin(resumed);
        for (const now of [5500, 6000, 6500, 7000]) resumed.update(now);
        assert.equal(resumed.state.phase.kind, "prepare");
        assert.deepEqual(wallet(resumed.state), [
          coins + 22 + 12 * level,
          28 + 6 * level,
        ]);
      } finally {
        resumed.dispose();
      }
    } finally {
      session.dispose();
    }
  });
}

test("Sheepfold has no currency contribution or extra waits when all owned cells are occupied", () => {
  const state = fixture();
  state.shop = [
    { id: "sheepfold", price: 12 },
    { id: "javelin-camp", price: 4 },
    { id: "javelin-camp", price: 4 },
    { id: "javelin-camp", price: 4 },
  ];
  const session = owner(parseGame(state));
  try {
    act(
      session,
      { op: "buy", slot: 0, tile: tile(30) },
      { op: "buy", slot: 1, tile: tile(38) },
      { op: "buy", slot: 2, tile: tile(44) },
      { op: "buy", slot: 3, tile: tile(43) },
    );
    assert.deepEqual(
      ordinaryIncome(session.state).find((group) => group.tile === 30)
        ?.payments,
      [],
    );
    const before = wallet(session.state);
    begin(session);
    session.update(500);
    assert.equal(session.state.phase.kind, "income");
    session.update(1000);
    assert.equal(session.state.phase.kind, "prepare");
    assert.deepEqual(wallet(session.state), [before[0]! + 11, before[1]! + 4]);
  } finally {
    session.dispose();
  }
});

test("Sheepfold Wealth remaps the indirect Lore into its existing Coins key and one ordinary wait", () => {
  const state = fixture();
  state.fate = ["wisdom-into-wealth", null, null];
  const session = owner(state);
  try {
    purchase(session, 1);
    act(session, { op: "fate", slot: 0, tile: tile(30) });
    assert.deepEqual(
      ordinaryIncome(session.state).filter((group) => group.tile === 30),
      [{ tile: 30, payments: [{ currency: "drachmas", amount: 9 }] }],
    );
    const before = wallet(session.state);
    begin(session);
    session.update(500);
    session.update(1000);
    assert.deepEqual(wallet(session.state), [before[0]! + 20, before[1]! + 4]);
    session.update(1499);
    assert.equal(session.state.phase.kind, "income");
    session.update(1500);
    assert.equal(session.state.phase.kind, "prepare");
  } finally {
    session.dispose();
  }
});

test("the actual Sheepfold catalogue exposes its proved Lore to the player", () => {
  const detail = catalogTool.execute({ ids: ["sheepfold"] }) as Record<
    string,
    { effectText: string[] }
  >;
  assert.ok(
    detail.sheepfold?.effectText.includes(
      "Income: +1/2/3 Insight per empty colonized tile",
    ),
  );
});
