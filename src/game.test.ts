import { test } from "node:test";
import assert from "node:assert/strict";
import { gameSession, newGame, parseGame } from "./game.ts";
import { income, warband, settlement, practiceMatch } from "./warband.ts";
import { seasonForRound } from "./rules-version.ts";
import { tileId } from "./map.ts";

function finishIncome(game: ReturnType<typeof gameSession>) {
  for (let pass = 0; pass < 100 && game.state.phase.kind === "income"; pass++)
    game.update(game.runtime.clock.last + 500);
}

function capturedCamp() {
  const initial = newGame();
  initial.drachmas = 22;
  initial.shop = [
    { id: "spear-camp", price: 4 },
    { id: "spear-camp", price: 4 },
    { id: "silver-mine", price: 4 },
    null,
  ];
  return initial;
}

test("giving up ends each active phase, clears income work and persists a restartable defeat", () => {
  for (const mode of ["practice", "tutorial"] as const) {
    for (const phase of ["prepare", "income", "result", "season"] as const) {
      const initial = newGame(42, "stag", mode);
      if (phase === "season") {
        initial.round = 5;
        initial.season = "summer";
      }
      initial.phase = { kind: phase === "result" ? "prepare" : phase };
      if (phase === "result" && initial.tutorial) {
        initial.tutorial.stage = "prepare";
        initial.tutorial.chapter = null;
      }
      let saved = initial;
      const game = gameSession(
        initial,
        (next) => {
          saved = next;
        },
        () => {},
      );
      if (phase === "result")
        game.act({ revision: game.state.revision, actions: [{ op: "ready" }] });
      game.act({ revision: game.state.revision, actions: [{ op: "give-up" }] });
      assert.deepEqual(game.state.phase, {
        kind: "finished",
        outcome: "defeat",
      });
      assert.equal(game.state.lives, 0);
      assert.equal(game.pending, false);
      assert.equal(game.state.incomeCheckpoint, null);
      assert.equal(game.state.tutorial?.chapter ?? null, null);
      assert.deepEqual(parseGame(saved), game.state);
      const ended = game.state;
      game.update(game.runtime.clock.last + 10_000);
      assert.deepEqual(game.state, ended, "no late income after giving up");
      assert.throws(
        () =>
          game.act({ revision: ended.revision, actions: [{ op: "give-up" }] }),
        /ended/,
      );
      game.act({
        revision: ended.revision,
        actions: [{ op: "restart", clan: "raven" }],
      });
      assert.equal(game.state.lives, 5);
      assert.equal(game.state.clan, "raven");
    }
  }
  const blocked = gameSession(
    newGame(),
    () => {
      throw new Error("Storage blocked");
    },
    () => {},
  );
  const before = blocked.state;
  assert.throws(
    () =>
      blocked.act({ revision: before.revision, actions: [{ op: "give-up" }] }),
    /Storage blocked/,
  );
  assert.deepEqual(blocked.state, before);
});

test("async creation, rerolls and next-round offers use the authoritative selector independently of map seed", () => {
  const initial = newGame(42, "stag", "async", () => 0);
  // Rarity draw 0 = Common, entry 0 = Javelin Camp; later slots reject it 50 times and stay empty.
  assert.deepEqual(
    initial.shop.map((offer) => offer?.id ?? null),
    ["javelin-camp", null, null, null],
  );
  const game = gameSession(
    initial,
    () => {},
    () => {},
    {
      offerIndex: () => 1,
      encounter: (current) => ({
        seed: 17,
        kind: "pvp",
        opponentLayout: settlement(current),
        opponent: "Another submitted chief",
        fighters: [
          ...warband(current, "polis"),
          ...warband(current, "opponent"),
        ],
      }),
    },
  );
  game.act({
    revision: 0,
    actions: [{ op: "reroll-shop" }],
  });
  // Index 0 of the 12 eligible round-1 entries is Concord of Hestia; index 1 Aegis Weave (the
  // Hall is Melee). Ineligible Charms (no Warband/Economy/Knowledge structure) never count.
  assert.deepEqual(initial.fate, [
    "call-to-peace",
    "call-to-peace",
    "call-to-peace",
  ]);
  game.act({ revision: 1, actions: [{ op: "reroll-fate" }] });
  assert.deepEqual(
    game.state.shop.map((offer) => offer?.id ?? null),
    ["apollo-fountain", null, null, null],
  );
  assert.deepEqual(game.state.fate, [
    "padded-armor",
    "padded-armor",
    "padded-armor",
  ]);
  game.act({ revision: 2, actions: [{ op: "ready" }] });
  game.act({ revision: 3, actions: [{ op: "continue" }] });
  finishIncome(game);
  assert.equal(game.state.round, 2);
  // The previous batch (Fountain of Apollo) is excluded, so every attempt is rejected.
  assert.deepEqual(game.state.shop, [null, null, null, null]);
  assert.deepEqual(game.state.fate, [
    "padded-armor",
    "padded-armor",
    "padded-armor",
  ]);
});

test("duplicate purchases upgrade levels while villagers independently increase staffing", () => {
  const game = gameSession(
    capturedCamp(),
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "buy", slot: 0, tile: 30 }] });
  assert.deepEqual(game.state.placements[1], {
    tile: 30,
    id: "spear-camp",
    level: 1,
    workers: 1,
    rune: null,
  });
  assert.equal(game.state.drachmas, 18);
  game.act({ revision: 1, actions: [{ op: "buy", slot: 1, tile: 30 }] });
  assert.deepEqual(game.state.placements[1], {
    tile: 30,
    id: "spear-camp",
    level: 2,
    workers: 1,
    rune: null,
  });
  assert.equal(game.state.drachmas, 14);
  game.act({
    revision: 2,
    actions: [{ op: "villager" }, { op: "assign", tile: 30 }],
  });
  assert.deepEqual(game.state.placements[1], {
    tile: 30,
    id: "spear-camp",
    level: 2,
    workers: 2,
    rune: null,
  });
  assert.equal(game.state.drachmas, 10);
  assert.equal(game.inspect().villagerPrice, 7);
});

test("a later failed command rolls back currency, shop, staffing and persistence", () => {
  let saves = 0;
  const game = gameSession(
    capturedCamp(),
    () => {
      saves++;
    },
    () => {},
  );
  const before = game.state;
  assert.throws(
    () =>
      game.act({
        revision: 0,
        actions: [
          { op: "buy", slot: 0, tile: 30 },
          { op: "buy", slot: 1, tile: 37 },
        ],
      }),
    /occupied/,
  );
  assert.deepEqual(game.state, before);
  assert.equal(saves, 0);
  game.act({ revision: 0, actions: [{ op: "buy", slot: 0, tile: 30 }] });
  assert.throws(
    () => game.act({ revision: 0, actions: [{ op: "villager" }] }),
    /Stale/,
  );
  assert.equal(game.state.drachmas, 18);
  assert.equal(saves, 1);
});

test("a purchased Fate gift can colonize only contiguous territory and is consumed once", () => {
  const initial = newGame();
  initial.fate = ["lost-wanderer", "call-to-peace", "beseech-athena"];
  const game = gameSession(
    initial,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "fate", slot: 0 }] });
  assert.equal(game.state.insight, 0);
  assert.equal(game.state.workers, 1);
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "colonize", tile: 14 }] }),
    /border/,
  );
  assert.equal(game.state.workers, 1);
  game.act({ revision: 1, actions: [{ op: "colonize", tile: 29 }] });
  assert.equal(game.state.workers, 0);
  assert.deepEqual(game.state.owned, [37, 30, 38, 44, 43, 29]);
  assert.throws(
    () => game.act({ revision: 2, actions: [{ op: "fate", slot: 0 }] }),
    /empty/,
  );
});

test("a Blessing changes eligible offer prices and a Charm rejects incompatible targets without loss", () => {
  const first = capturedCamp();
  first.insight = 8;
  first.fate = ["call-to-peace", "burning-blades", "lost-wanderer"];
  const game = gameSession(
    first,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "fate", slot: 0 }] });
  assert.deepEqual(game.inspect().shop, [
    ["spear-camp", 4],
    ["spear-camp", 4],
    ["silver-mine", 3],
    null,
  ]);
  // One choice per roll: the purchase spent the whole selection.
  assert.deepEqual(game.state.fate, [null, null, null]);
  game.act({ revision: 1, actions: [{ op: "buy", slot: 2, tile: 30 }] });
  const second = game.state;
  second.fate = ["burning-blades", null, null];
  second.fateChosen = false;
  const charm = gameSession(
    second,
    () => {},
    () => {},
  );
  assert.throws(
    () =>
      charm.act({
        revision: 2,
        actions: [{ op: "fate", slot: 0, tile: 30 }],
      }),
    /cannot target/,
  );
  assert.throws(
    () => charm.act({ revision: 2, actions: [{ op: "fate", slot: 0 }] }),
    /target structure first/,
  );
  assert.equal(charm.state.insight, 4);
  charm.act({
    revision: 2,
    actions: [
      { op: "buy", slot: 0, tile: 43 },
      { op: "fate", slot: 0, tile: 43 },
    ],
  });
  assert.equal(
    charm.state.placements.find((p) => p.tile === 43)?.rune,
    "burning-blades",
  );
  assert.deepEqual(
    [charm.state.drachmas, charm.state.insight, charm.state.favor.zeus],
    [15, 0, 1],
  );
});

test("save failures do not advance revisions and restored state preserves all purchases", () => {
  const failed = gameSession(
    capturedCamp(),
    () => {
      throw new Error("Storage blocked");
    },
    () => {},
  );
  assert.throws(
    () =>
      failed.act({ revision: 0, actions: [{ op: "buy", slot: 0, tile: 30 }] }),
    /blocked/,
  );
  assert.equal(failed.state.revision, 0);
  assert.equal(failed.state.drachmas, 22);
  let saved = "";
  const game = gameSession(
    capturedCamp(),
    (state) => {
      saved = JSON.stringify(state);
    },
    () => {},
  );
  game.act({
    revision: 0,
    actions: [
      { op: "buy", slot: 0, tile: 30 },
      { op: "villager" },
      { op: "assign", tile: 30 },
    ],
  });
  const restored = gameSession(
    parseGame(JSON.parse(saved)),
    () => {},
    () => {},
  );
  assert.deepEqual(restored.state, game.state);
  const copy = restored.state;
  copy.drachmas = 0;
  assert.equal(restored.state.drachmas, 14);
  assert.deepEqual(restored.inspect(1), { r: 1, changes: [] });
});

test("malformed saves and commands reject duplicate, disconnected and invalid Charm state", () => {
  const initial = capturedCamp();
  for (const invalid of [
    { ...initial, drachmas: -1_000_001 },
    { ...initial, owned: [...initial.owned, 14] },
    { ...initial, placements: [...initial.placements, ...initial.placements] },
    { ...initial, placements: [{ ...initial.placements[0], workers: 1 }] },
    {
      ...initial,
      placements: [{ ...initial.placements[0], rune: "protect-the-weak" }],
    },
  ])
    assert.throws(() => parseGame(invalid));
  const game = gameSession(
    initial,
    () => {},
    () => {},
  );
  for (const input of [
    { revision: 0, actions: [] },
    { revision: 0, actions: [{ op: "buy", slot: 4, tile: 30 }] },
    { revision: 0, actions: [{ op: "buy", slot: 0, tile: 46 }] },
    { revision: 0, actions: [{ op: "villager", price: 0 }] },
  ])
    assert.throws(() => game.act(input));
  assert.equal(game.state.drachmas, 22);
});

test("rerolls use a free Stag allowance and reject purchases that exceed the balance", () => {
  const initial = newGame();
  initial.drachmas = 0;
  const game = gameSession(
    initial,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "reroll-shop" }] });
  assert.equal(game.state.freeRerolls, 0);
  assert.equal(game.state.drachmas, 0);
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "reroll-shop" }] }),
    /Drachmas/,
  );
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "villager" }] }),
    /Drachmas/,
  );
  assert.equal(game.state.revision, 1);
});

test("Athena’s immediate Favor gift works independently of the Villager inventory", () => {
  const initial = newGame(42, "raven");
  initial.workers = 100;
  initial.fate[0] = "beseech-athena";
  const game = gameSession(
    initial,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "fate", slot: 0 }] });
  assert.deepEqual(game.state.favor, { athena: 3, zeus: 0, apollo: 0 });
  assert.equal(game.state.workers, 100);
  assert.equal(game.state.insight, 0);
});

test("Raven colonization grants the recorded starting-tier Drachma and Insight reward", () => {
  const initial = newGame(42, "raven");
  initial.workers = 1;
  const game = gameSession(
    initial,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "colonize", tile: 29 }] });
  assert.deepEqual(game.inspect().balance, [12, 5]);
  assert.equal(game.state.workers, 0);
});

test("compact changes reconstruct generated shop and Fate offers without RNG knowledge", () => {
  const game = gameSession(
    newGame(),
    () => {},
    () => {},
  );
  const snapshot = game.inspect();
  const shopResult = game.act({
    revision: 0,
    actions: [{ op: "reroll-shop" }],
  });
  assert.ok(Object.hasOwn(shopResult.changes[0]?.delta ?? {}, "shop"));
  const fateResult = game.act({
    revision: 1,
    actions: [{ op: "reroll-fate" }],
  });
  assert.ok(Object.hasOwn(fateResult.changes[0]?.delta ?? {}, "fate"));
  assert.deepEqual(fateResult.changes[0]?.delta.balance, [11, 3]);
  const result = game.inspect(0);
  assert.ok("changes" in result);
  const rebuilt = { ...snapshot };
  for (const change of result.changes)
    Object.assign(rebuilt, change.delta, { r: change.r });
  assert.deepEqual(rebuilt, game.inspect());
  assert.deepEqual(result.changes, [
    ...shopResult.changes,
    ...fateResult.changes,
  ]);
  const firstChange = result.changes[0];
  assert.ok(firstChange);
  firstChange.delta.shop = [];
  const reread = game.inspect(0);
  assert.ok("changes" in reread);
  assert.deepEqual(reread.changes, [
    ...shopResult.changes,
    ...fateResult.changes,
  ]);
});

test("battle results survive reload and are claimed once before preparation resumes", () => {
  const game = gameSession(
    newGame(),
    () => {},
    () => {},
  );
  const before = game.inspect();
  game.act({ revision: 0, actions: [{ op: "ready" }] });
  assert.equal(game.state.phase.kind, "result");
  assert.equal(game.inspect().battle?.winner, "opponent");
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "villager" }] }),
    /Preparation/,
  );
  const restored = gameSession(
    parseGame(JSON.parse(JSON.stringify(game.state))),
    () => {},
    () => {},
  );
  assert.deepEqual(restored.inspect(), game.inspect());
  game.act({ revision: 1, actions: [{ op: "continue" }] });
  finishIncome(game);
  assert.equal(game.state.round, 2);
  assert.equal(game.state.wins, 0);
  assert.equal(game.state.lives, 5);
  assert.equal(game.state.chiefBattles, 1);
  assert.deepEqual(game.inspect().balance, [22, 8]);
  assert.equal(game.state.phase.kind, "prepare");
  assert.throws(
    () =>
      game.act({
        revision: game.state.revision,
        actions: [{ op: "continue" }],
      }),
    /No battle/,
  );
  const patch = game.inspect(0);
  assert.ok("changes" in patch);
  const rebuilt = { ...before };
  for (const e of patch.changes) Object.assign(rebuilt, e.delta, { r: e.r });
  assert.deepEqual(rebuilt, game.inspect());
  assert.equal(rebuilt.battle, null);
});

test("a season decision defers the round's income and Hall improvement applies before that income", () => {
  const start = newGame();
  start.round = 4;
  start.villagerPurchases = 2;
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
  assert.equal(game.state.round, 5);
  assert.equal(game.state.season, "summer");
  assert.equal(game.state.phase.kind, "season");
  assert.equal(game.state.villagerPurchases, 2);
  assert.deepEqual(game.inspect().balance, [11, 4]);
  assert.throws(
    () =>
      game.act({ revision: 1, actions: [{ op: "buy", slot: 0, tile: 30 }] }),
    /Preparation/,
  );
  game.act({ revision: 1, actions: [{ op: "upgrade", choice: "hall" }] });
  finishIncome(game);
  assert.equal(game.state.placements[0]?.level, 2);
  assert.equal(game.state.phase.kind, "prepare");
  assert.equal(game.state.villagerPurchases, 0);
  assert.deepEqual(game.inspect().balance, [24, 9]);
  assert.throws(
    () =>
      game.act({
        revision: game.state.revision,
        actions: [{ op: "upgrade", choice: "hall" }],
      }),
    /No seasonal/,
  );
  const before = game.inspect().balance;
  game.act({
    revision: game.state.revision,
    actions: [{ op: "ready" }, { op: "continue" }],
  });
  finishIncome(game);
  assert.deepEqual(game.inspect().balance, [
    (before[0] ?? 0) + 13,
    (before[1] ?? 0) + 5,
  ]);
});

test("rounds5,9,13 wait for Hall or skill before granting income and asking the authoritative offer selector", () => {
  for (const [round, hallLevel, hallIncome] of [
    [5, 1, [13, 5]],
    [9, 2, [15, 6]],
    [13, 3, [17, 7]],
  ] satisfies [number, 1 | 2 | 3, [number, number]][]) {
    for (const choice of ["hall", "skill-0"] as const) {
      const start = newGame(42, "raven");
      start.round = round - 1;
      start.season = seasonForRound(start.round);
      const hall = start.placements[0];
      assert.ok(hall);
      hall.level = hallLevel;
      start.drachmas = 37;
      start.insight = 12;
      start.villagerPurchases = 2;
      start.paidShopRerolls = 3;
      start.paidFateRerolls = 4;
      start.shopRolls = 7;
      start.fateRolls = 11;
      start.shop = [null, null, null, null];
      start.fate = [null, null, null];
      let offers = 0;
      const offerRounds: number[] = [];
      let saves = 0;
      const game = gameSession(
        start,
        () => saves++,
        () => {},
        {
          offerIndex(context) {
            offers++;
            offerRounds.push(context.round);
            return 0;
          },
          encounter: practiceMatch,
        },
      );
      game.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
      assert.equal(game.state.phase.kind, "season");
      assert.equal(game.state.round, round);
      assert.deepEqual(game.inspect().balance, [37, 12]);
      assert.deepEqual(game.state.shop, [null, null, null, null]);
      assert.deepEqual(game.state.fate, [null, null, null]);
      assert.deepEqual(
        [
          game.state.shopRolls,
          game.state.fateRolls,
          game.state.villagerPurchases,
          game.state.paidShopRerolls,
          game.state.paidFateRerolls,
        ],
        [7, 11, 2, 3, 4],
      );
      assert.equal(offers, 0);
      assert.equal(saves, 1);
      const pending = game.state;
      assert.throws(
        () => game.act({ revision: 1, actions: [{ op: "villager" }] }),
        /Preparation/,
      );
      assert.throws(
        () =>
          game.act({
            revision: 1,
            actions: [
              { op: "upgrade", choice },
              { op: "upgrade", choice },
            ],
          }),
        /No seasonal/,
      );
      assert.deepEqual(
        game.state,
        pending,
        "A rejected choice batch preserves pending income and offers",
      );
      assert.equal(saves, 1);
      // A rollback may consume provisional external randomness; only committed state is promised.
      offers = 0;
      offerRounds.length = 0;
      game.act({ revision: 1, actions: [{ op: "upgrade", choice }] });
      finishIncome(game);
      const expected =
        choice === "hall"
          ? hallIncome
          : [11 + (hallLevel - 1) * 2, 4 + hallLevel - 1];
      assert.deepEqual(game.inspect().balance, [
        37 + (expected[0] ?? 0),
        12 + (expected[1] ?? 0),
      ]);
      assert.equal(game.state.phase.kind, "prepare");
      assert.equal(
        game.state.placements[0]?.level,
        choice === "hall" ? hallLevel + 1 : hallLevel,
      );
      assert.equal(game.state.skills[0], choice === "hall" ? 1 : 2);
      assert.deepEqual(
        [
          game.state.shopRolls,
          game.state.fateRolls,
          game.state.villagerPurchases,
          game.state.paidShopRerolls,
          game.state.paidFateRerolls,
        ],
        [8, 12, 0, 0, 0],
      );
      // A constant selector fills slot 0 on its first rarity+entry draw; slots 1-3 then reject
      // the same item for all 50 attempts (2 draws each); Fate asks 3 times.
      assert.equal(offers, 2 + 3 * 50 * 2 + 3);
      assert.ok(offerRounds.every((offerRound) => offerRound === round));
      assert.deepEqual(
        game.state.shop.map((offer) => offer?.id ?? null),
        ["javelin-camp", null, null, null],
      );
      // Index 0 of the eligible pool (source table order) is Concord of Hestia.
      assert.deepEqual(game.state.fate, [
        "call-to-peace",
        "call-to-peace",
        "call-to-peace",
      ]);
      const prepared = game.state;
      const preparedSaves = saves;
      assert.throws(
        () => game.act({ revision: 1, actions: [{ op: "upgrade", choice }] }),
        /Stale/,
      );
      assert.throws(
        () =>
          game.act({
            revision: game.state.revision,
            actions: [{ op: "upgrade", choice }],
          }),
        /No seasonal/,
      );
      assert.deepEqual(game.state, prepared);
      assert.equal(saves, preparedSaves);
      assert.equal(
        offers,
        2 + 3 * 50 * 2 + 3,
        "Rejected duplicate choices must not roll or grant again",
      );
    }
  }
});

test("rejected fully improved seasonal choices do not grant pending income or offers", () => {
  const start = newGame(42, "raven");
  start.round = 13;
  start.season = "winter";
  start.phase = { kind: "season" };
  const hall = start.placements[0];
  assert.ok(hall);
  hall.level = 4;
  start.skills = [3, 3, 3];
  let offers = 0,
    saves = 0;
  const game = gameSession(
    start,
    () => saves++,
    () => {},
    {
      offerIndex: () => {
        offers++;
        return 0;
      },
      encounter: practiceMatch,
    },
  );
  for (const choice of ["hall", "skill-0", "skill-1", "skill-2"] as const)
    assert.throws(
      () => game.act({ revision: 0, actions: [{ op: "upgrade", choice }] }),
      /fully improved/,
    );
  assert.deepEqual(game.state, start);
  assert.equal(offers, 0);
  assert.equal(saves, 0);
});

test("round17 prepares directly without another season choice or duplicate income", () => {
  const start = newGame(42, "raven");
  start.round = 16;
  start.season = "winter";
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
  finishIncome(game);
  assert.equal(game.state.round, 17);
  assert.equal(game.state.phase.kind, "prepare");
  assert.deepEqual(game.inspect().balance, [22, 8]);
  assert.deepEqual([game.state.shopRolls, game.state.fateRolls], [1, 1]);
  const before = game.state;
  assert.throws(
    () =>
      game.act({
        revision: game.state.revision,
        actions: [{ op: "upgrade", choice: "hall" }],
      }),
    /No seasonal/,
  );
  assert.deepEqual(game.state, before);
});

test("a finished practice run cannot shop and restart creates the selected clan without stale revisions", () => {
  const start = newGame();
  // Trusted ordinary-battle fixture; a PvE result cannot complete ten wins.
  start.round = 2;
  start.chiefBattles = 1;
  start.wins = 9;
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
  assert.deepEqual(game.state.phase, { kind: "finished", outcome: "victory" });
  assert.equal(game.state.wins, 10);
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "villager" }] }),
    /Preparation/,
  );
  game.act({ revision: 1, actions: [{ op: "restart", clan: "raven" }] });
  assert.equal(game.state.revision, 2);
  assert.equal(game.state.clan, "raven");
  assert.equal(game.state.wins, 0);
  assert.equal(game.state.round, 1);
  assert.deepEqual(game.inspect().balance, [11, 4]);
  assert.throws(
    () => game.act({ revision: 2, actions: [{ op: "restart", clan: "stag" }] }),
    /Finish this/,
  );
});

test("losing the final life ends the run and a blocked battle save leaves preparation intact", () => {
  const start = newGame();
  start.round = 19;
  start.season = "winter";
  start.lives = 1;
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
  assert.equal(game.state.lives, 0);
  assert.deepEqual(game.state.phase, { kind: "finished", outcome: "defeat" });
  assert.throws(
    () => game.act({ revision: 1, actions: [{ op: "ready" }] }),
    /phase/,
  );
  assert.deepEqual(
    parseGame(JSON.parse(JSON.stringify(game.state))),
    game.state,
  );

  const blocked = gameSession(
    newGame(),
    () => {
      throw new Error("Storage blocked");
    },
    () => {},
  );
  const before = blocked.state;
  assert.throws(
    () =>
      blocked.act({
        revision: 0,
        actions: [{ op: "ready" }, { op: "continue" }],
      }),
    /Storage blocked/,
  );
  assert.deepEqual(blocked.state, before);
});

test("the Symposium counts adjacent Warband structures rather than troops or the chief", () => {
  const start = newGame();
  start.fate = ["lost-wanderer", null, null];
  start.owned.push(tileId.parse(29));
  start.placements.push(
    { tile: tileId.parse(30), id: "brewery", level: 1, workers: 0, rune: null },
    {
      tile: tileId.parse(29),
      id: "spear-camp",
      level: 1,
      workers: 2,
      rune: null,
    },
    {
      tile: tileId.parse(38),
      id: "archer-camp",
      level: 1,
      workers: 1,
      rune: null,
    },
    {
      tile: tileId.parse(43),
      id: "spear-camp",
      level: 1,
      workers: 1,
      rune: null,
    },
  );
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  assert.deepEqual(income(game.state), [11, 6]);
  assert.deepEqual(
    warband(game.state, "polis").map((u) => u.regen),
    [1, 1, 1, 1, 0],
  );
  assert.throws(
    () =>
      game.act({
        revision: 0,
        actions: [
          { op: "fate", slot: 0 },
          { op: "assign", tile: tileId.parse(30) },
        ],
      }),
    /worker|staff|slot/i,
  );
  assert.equal(game.state.insight, 4);
});

test("previous-rules and incomplete saves reject rather than granting reroll allowance or changing staffing", () => {
  const start = newGame();
  start.drachmas = 67;
  start.workers = 100;
  start.placements.push({
    tile: tileId.parse(30),
    id: "brewery",
    level: 2,
    workers: 3,
    rune: null,
  });
  const { mode, phase, skills, chiefBattles, ...legacy } = start;
  const bytes = JSON.stringify(legacy);
  assert.throws(() => parseGame(JSON.parse(bytes)));
  assert.equal(JSON.stringify(legacy), bytes);
  assert.throws(() => parseGame({ ...newGame(), version: 1 }));
  const { paidShopRerolls, ...missingCounter } = newGame();
  assert.throws(() => parseGame(missingCounter));
  assert.throws(() => parseGame(start), /workers/);
});

test("Arcadia’s upgraded critical growth counts all Economy structures", () => {
  const start = newGame(42, "raven");
  start.round = 5;
  start.season = "summer";
  start.phase = { kind: "season" };
  start.placements.push({
    tile: tileId.parse(30),
    id: "silver-mine",
    level: 1,
    workers: 0,
    rune: null,
  });
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  assert.equal(warband(game.state, "polis")[0]?.criticalGrowth, 2);
  game.act({ revision: 0, actions: [{ op: "upgrade", choice: "skill-1" }] });
  finishIncome(game);
  assert.equal(warband(game.state, "polis")[0]?.criticalGrowth, 3);
  assert.equal(game.state.phase.kind, "prepare");
});

test("Athens level-three structure bonuses include an improved Hall", () => {
  const start = newGame();
  start.round = 9;
  start.season = "autumn";
  start.phase = { kind: "season" };
  const hall = start.placements[0];
  assert.ok(hall);
  hall.level = 2;
  const game = gameSession(
    start,
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "upgrade", choice: "hall" }] });
  assert.equal(game.state.placements[0]?.level, 3);
  assert.deepEqual(income(game.state), [15, 6]);
  // King's Resolve L1 x one level-3 structure, binary32 (stat-operator-composition-closure-next).
  assert.equal(warband(game.state, "polis")[0]?.health, 254.39999389648438);
});
