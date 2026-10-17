import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apply,
  gameSession,
  newGame,
  offerProbability,
  parseGame,
  shopPool,
} from "./game.ts";
import type { Game } from "./game.ts";
import { catalogTool } from "./play-catalog.ts";
import { seasonForRound } from "./rules-version.ts";
import { buildings } from "./rules.ts";
import { sourceItemCosts, sourceRarityCosts } from "./source-numbers.ts";
import { practiceMatch } from "./warband.ts";

type Context = Parameters<NonNullable<Parameters<typeof newGame>[3]>>[0];
type Selector = (context: Context, upperBound: number) => number;

function offers(clan: Game["clan"], round: number, selector: Selector) {
  const game = newGame(42, clan, "async", () => 0);
  game.shop.fill(null);
  game.round = round;
  game.season = seasonForRound(round);
  game.drachmas = 100;
  return apply(
    parseGame(game),
    { op: "reroll-shop" },
    { offerIndex: selector, encounter: practiceMatch },
  ).shop;
}
const at =
  (k: number, entry = 0): Selector =>
  (context) =>
    context.draw === "rarity" ? k : entry;

test("rarity prices are 4/8/12/18/24 and every catalogue row carries its source price", () => {
  assert.deepEqual(sourceRarityCosts, {
    common: 4,
    uncommon: 8,
    rare: 12,
    epic: 18,
    legendary: 24,
  });
  // handoff full-shop-admission-plan-next catalogue-table.csv, serialized order.
  assert.deepEqual(sourceItemCosts, {
    "altar-of-kings": 24,
    forge: 8,
    "javelin-camp": 4,
    "apollo-fountain": 4,
    "iris-bridge": 24,
    brewery: 4,
    "sacred-fire": 8,
    "defense-tower": 4,
    "tombs-of-erebus": 12,
    farm: 4,
    "gate-of-hades": 18,
    "gate-of-etna": 24,
    "healers-hut": 4,
    "tritons-conch": 12,
    "altar-of-olympus": 12,
    house: 8,
    "hunters-lodge": 8,
    "gigantes-camp": 12,
    "dactyl-camp": 8,
    agora: 8,
    "menders-hut": 12,
    "spring-of-mnemosyne": 12,
    "silver-mine": 4,
    "thunderbolt-of-zeus": 18,
    "pit-of-tartarus": 12,
    "offering-well": 12,
    "scout-camp": 8,
    "sentry-camp": 8,
    sheepfold: 12,
    "shield-camp": 4,
    "skull-of-typhon": 18,
    "archer-camp": 8,
    "hephaestus-forge": 18,
    "spear-camp": 4,
    watchtower: 8,
    "wolf-den": 12,
    woodcutter: 4,
    "drakon-nest": 18,
    "hesperides-tree": 24,
    "hall-of-rhapsodes": 8,
    "throne-of-zeus": 18,
    "misthophoros-camp": 4,
    "charons-barge": 18,
  });
  assert.deepEqual(buildings["charons-barge"].native, "Naglfar");
  assert.equal(buildings["altar-of-olympus"].native, "Horgr");
  assert.equal(
    buildings["altar-of-olympus"].guid,
    "15b10cc9af3b15648aaea803aa4f2064",
  );
});

test("each clan pool has 41 items: 39 shared plus its two uniques, bucketed by rarity", () => {
  const stag = shopPool("stag");
  const raven = shopPool("raven");
  assert.deepEqual(
    stag.map((pile) => pile.length),
    [10, 11, 10, 6, 4],
  );
  assert.deepEqual(
    raven.map((pile) => pile.length),
    [11, 10, 10, 6, 4],
  );
  const flat = (piles: string[][]) => piles.flat();
  assert.equal(flat(stag).length, 41);
  assert.equal(flat(raven).length, 41);
  assert.ok(flat(stag).includes("hall-of-rhapsodes"));
  assert.ok(flat(stag).includes("throne-of-zeus"));
  assert.ok(!flat(stag).includes("misthophoros-camp"));
  assert.ok(!flat(stag).includes("charons-barge"));
  assert.ok(flat(raven).includes("misthophoros-camp"));
  assert.ok(flat(raven).includes("charons-barge"));
  assert.ok(!flat(raven).includes("hall-of-rhapsodes"));
  assert.equal(flat(stag).filter((id) => flat(raven).includes(id)).length, 39);
  assert.equal(new Set([...flat(stag), ...flat(raven)]).size, 43);
});

test("season weights follow the calendar: rounds 1-4 spring through 13+ winter", () => {
  const catalog = catalogTool.execute({}) as {
    shop: { seasonWeights: Record<string, number[]> };
  };
  assert.deepEqual(catalog.shop.seasonWeights, {
    spring: [85, 15, 0, 0, 0],
    summer: [55, 35, 7, 3, 0],
    autumn: [25, 45, 23, 5, 2],
    winter: [15, 20, 25, 25, 15],
  });
  assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 17, 19].map(seasonForRound), [
    "spring",
    "spring",
    "summer",
    "summer",
    "autumn",
    "autumn",
    "winter",
    "winter",
    "winter",
  ]);
});

test("the rarity draw picks the first cumulative weight above k (entry 0 shown)", () => {
  const first = (round: number, k: number) =>
    offers("stag", round, at(k))[0]?.id;
  const common = "javelin-camp";
  const uncommon = "forge";
  const rare = "tombs-of-erebus";
  const epic = "gate-of-hades";
  const legendary = "altar-of-kings";
  for (const [round, k, id] of [
    [2, 84, common],
    [2, 85, uncommon],
    [6, 54, common],
    [6, 55, uncommon],
    [6, 89, uncommon],
    [6, 90, rare],
    [6, 96, rare],
    [6, 97, epic],
    [6, 99, epic],
    [10, 24, common],
    [10, 25, uncommon],
    [10, 69, uncommon],
    [10, 70, rare],
    [10, 92, rare],
    [10, 93, epic],
    [10, 97, epic],
    [10, 98, legendary],
    [14, 14, common],
    [14, 15, uncommon],
    [14, 34, uncommon],
    [14, 35, rare],
    [14, 59, rare],
    [14, 60, epic],
    [14, 84, epic],
    [14, 85, legendary],
  ] as const)
    assert.equal(first(round, k), id, `round ${round} k ${k}`);
});

test("entries follow serialized order with clan uniques last", () => {
  const first = (clan: Game["clan"], round: number, k: number, entry: number) =>
    offers(clan, round, at(k, entry))[0]?.id;
  assert.equal(first("stag", 2, 85, 10), "hall-of-rhapsodes");
  assert.equal(first("stag", 2, 85, 0), "forge");
  assert.equal(first("raven", 2, 0, 10), "misthophoros-camp");
  assert.equal(first("stag", 14, 60, 5), "throne-of-zeus");
  assert.equal(first("raven", 14, 60, 5), "charons-barge");
  assert.equal(first("stag", 14, 85, 3), "hesperides-tree");
});

test("a slot makes up to 50 rarity+entry attempts and then stays empty", () => {
  // The previous batch shows Javelin Camp (entry 0), so entry 0 is rejected on a reroll.
  const shown = newGame(42, "stag", "async", at(0, 0));
  assert.equal(shown.shop[0]?.id, "javelin-camp");
  const reroll = (late: number | null) => {
    const calls: Context[] = [];
    const shop = apply(
      shown,
      { op: "reroll-shop" },
      {
        offerIndex: (context) => {
          calls.push(context);
          if (context.draw === "rarity") return 0;
          return context.slot === 0 && context.attempt === late ? 2 : 0;
        },
        encounter: practiceMatch,
      },
    ).shop;
    return { shop, calls: calls.filter((c) => c.slot === 0) };
  };
  const filled = reroll(49);
  assert.equal(filled.shop[0]?.id, "brewery");
  assert.equal(filled.calls.length, 100);
  assert.deepEqual(
    filled.calls.slice(0, 2).map((c) => [c.kind, c.draw, c.attempt, c.roll]),
    [
      ["shop", "rarity", 0, 1],
      ["shop", "entry", 0, 1],
    ],
  );
  const empty = reroll(null);
  assert.equal(empty.shop[0], null);
  assert.equal(empty.calls.length, 100);
  assert.equal(Math.max(...empty.calls.map((c) => c.attempt)), 49);
  // A null slot leaves the other slots to their own draws.
  const mixed = apply(
    shown,
    { op: "reroll-shop" },
    {
      offerIndex: (context) =>
        context.draw === "rarity"
          ? 0
          : context.slot === 0
            ? 0
            : context.slot + 4,
      encounter: practiceMatch,
    },
  ).shop;
  assert.deepEqual(
    mixed.map((offer) => offer?.id ?? null),
    [null, "healers-hut", "silver-mine", "shield-camp"],
  );
});

test("practice rerolls exclude only the previous unbought batch and never repeat within a batch", () => {
  let game = newGame(7, "raven");
  game.drachmas = 1000;
  const seen = new Set<string>();
  for (let roll = 0; roll < 6; roll++) {
    const before = game.shop.flatMap((offer) => (offer ? [offer.id] : []));
    game = apply(game, { op: "reroll-shop" });
    const after = game.shop.flatMap((offer) => (offer ? [offer.id] : []));
    assert.equal(new Set(after).size, after.length);
    assert.ok(after.every((id) => !before.includes(id)));
    after.forEach((id) => seen.add(id));
  }
  // Later batches may repeat items from two rolls ago: only the last batch is excluded.
  assert.ok(seen.size < 24);
});

test("rerolls cost 2/4/8/16/32/64, a seventh paid reroll is refused and counters reset next round", () => {
  const start = newGame(42, "raven");
  start.drachmas = 200;
  const session = gameSession(
    start,
    () => {},
    () => {},
  );
  const paid: number[] = [];
  for (let r = 0; r < 6; r++) {
    const before = session.state.drachmas;
    session.act({ revision: r, actions: [{ op: "reroll-shop" }] });
    paid.push(before - session.state.drachmas);
  }
  assert.deepEqual(paid, [2, 4, 8, 16, 32, 64]);
  const exhausted = session.state;
  assert.throws(
    () => session.act({ revision: 6, actions: [{ op: "reroll-shop" }] }),
    /No shop rerolls/,
  );
  assert.deepEqual(session.state, exhausted);
  session.act({ revision: 6, actions: [{ op: "ready" }] });
  session.act({ revision: 7, actions: [{ op: "continue" }] });
  assert.equal(session.state.paidShopRerolls, 0);
  const poor = newGame(42, "raven");
  poor.drachmas = 1;
  const broke = gameSession(
    poor,
    () => {},
    () => {},
  );
  const untouched = broke.state;
  assert.throws(
    () => broke.act({ revision: 0, actions: [{ op: "reroll-shop" }] }),
    /Not enough/,
  );
  assert.deepEqual(broke.state, untouched);
});

test("nominal offer probabilities match the source odds tables", () => {
  const p = offerProbability;
  assert.equal(p("stag", "spring", "spear-camp"), 17 / 200);
  assert.equal(p("raven", "spring", "misthophoros-camp"), 17 / 220);
  assert.equal(p("stag", "spring", "hall-of-rhapsodes"), 3 / 220);
  assert.equal(p("stag", "summer", "tombs-of-erebus"), 7 / 1000);
  assert.equal(p("raven", "autumn", "charons-barge"), 1 / 120);
  assert.equal(p("stag", "winter", "throne-of-zeus"), 1 / 24);
  assert.equal(p("raven", "winter", "altar-of-kings"), 3 / 80);
  assert.equal(p("stag", "spring", "tombs-of-erebus"), 0);
  assert.equal(p("stag", "spring", "charons-barge"), 0);
  // Appearance powers add one entry per matching item (Offensive Strategy = Warband,
  // Seek Myths = Mythical); two matching powers still add only one.
  assert.equal(p("stag", "spring", "spear-camp", ["warband"]), 17 / 130);
  assert.equal(p("stag", "winter", "drakon-nest", ["mythical"]), 1 / 20);
  assert.equal(
    p("stag", "winter", "thunderbolt-of-zeus", ["mythical"]),
    1 / 40,
  );
  assert.equal(p("stag", "autumn", "gate-of-etna", ["mythical"]), 1 / 125);
  assert.equal(p("stag", "autumn", "hesperides-tree", ["mythical"]), 1 / 250);
  assert.equal(
    p("stag", "winter", "drakon-nest", ["mythical", "ranged"]),
    1 / 20,
  );
});

test("the catalog exposes rarity, price, status and unknowns for all 43 shop identities", () => {
  const summary = catalogTool.execute({}) as {
    buildings: [
      string,
      string,
      boolean,
      string | null,
      number | null,
      string,
    ][];
  };
  const shop = summary.buildings.filter(([id]) => id !== "polis-hall");
  assert.equal(shop.length, 43);
  const statuses = (status: string) =>
    shop.filter((row) => row[5] === status).length;
  assert.deepEqual(
    [statuses("exact"), statuses("partial"), statuses("hold")],
    [39, 4, 0],
  );
  assert.deepEqual(
    shop.find(([id]) => id === "charons-barge"),
    ["charons-barge", "Charon's Barge", true, "epic", 18, "exact"],
  );
  const detail = catalogTool.execute({
    ids: ["wolf-den", "dactyl-camp"],
  }) as Record<
    string,
    { rarity: string; price: number; unknown: string[]; effectText: string[] }
  >;
  assert.deepEqual(
    [detail["wolf-den"]?.rarity, detail["wolf-den"]?.price],
    ["rare", 12],
  );
  assert.deepEqual(detail["wolf-den"]?.effectText, [
    "Own troops: +5/10/15 Damage per adjacent Beast",
  ]);
  assert.equal(detail["dactyl-camp"]?.unknown.length, 0);
  for (const [id, , , , , status] of shop)
    if (status === "partial")
      assert.ok(buildings[id as keyof typeof buildings].unknown.length > 0, id);
});
