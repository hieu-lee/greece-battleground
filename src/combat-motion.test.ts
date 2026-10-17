import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arenaPerSource,
  battle,
  bodyRadius,
  createCombat,
  fighter,
} from "./combat.ts";
import type { Fighter } from "./combat.ts";
import { newGame } from "./game.ts";
import { tileId } from "./map.ts";
import { troopId } from "./rules.ts";
import type { ShopBuildingId } from "./rules.ts";
import { practiceMatch, warband } from "./warband.ts";

// Distances below are arena units (source × 0.5); Fighter range and movement are source values.
function unit(side: Fighter["side"], changes: Partial<Fighter> = {}) {
  return fighter.parse({
    name: "Motion fixture",
    sprite: "hoplite",
    side,
    x: 0,
    y: 0,
    health: 1000,
    armor: 0,
    damage: 0,
    speed: 1,
    windupPercent: 0,
    movement: 0,
    range: 1,
    crit: 0,
    burn: 0,
    ward: 0,
    ...changes,
  });
}
function run(fighters: Fighter[]) {
  return createCombat(
    battle.parse({
      seed: 42,
      kind: "training",
      opponent: "Motion fixture",
      fighters,
    }),
  );
}
// The engine keeps 40 ticks of events, so collect every event while advancing.
function collect(sim: ReturnType<typeof createCombat>, until: number) {
  const seen = new Map<number, (typeof sim.events)[number]>();
  while (sim.ticks < until && !sim.result) {
    sim.advance();
    for (const event of sim.events) seen.set(event.id, event);
  }
  return [...seen.values()];
}
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

test("bodies are the source UnitSizeData radii: Big 0.375, Small 0.25 arena units", () => {
  assert.equal(arenaPerSource, 0.5);
  const big = [
    "cyclops",
    "fire-titan",
    "boreal-giant",
    "drakon-colossus",
    "arcadian-wolf",
    "drakon",
    "bear",
  ];
  for (const sprite of [
    ...troopId.options,
    "aegeus",
    "atalanta",
    "fox",
    "boar",
    "bear",
  ] as const)
    assert.equal(bodyRadius(sprite), big.includes(sprite) ? 0.375 : 0.25);
});

test("in range is range² + 0.1 ≥ squared source distance: 0.5244 hits, 0.5250 never does", () => {
  for (const [range, inside, outside] of [
    [1, 0.5244, 0.525],
    [2, 1.0124, 1.013],
  ] as const) {
    const near = run([
      unit("polis", { range }),
      unit("opponent", { x: inside, range: 0 }),
    ]);
    assert.equal(
      collect(near, 1).filter((e) => e.kind === "attack" && e.from === 0)
        .length,
      1,
    );
    const far = run([
      unit("polis", { range }),
      unit("opponent", { x: outside, range: 0 }),
    ]);
    assert.equal(
      collect(far, 40).some((e) => e.kind === "attack"),
      false,
    );
  }
});

test("allies settle at their summed radii; enemies only down to the attack slot", () => {
  const small = run([
    unit("polis"),
    unit("polis", { x: 0.1 }),
    unit("opponent", { x: 9 }),
  ]);
  collect(small, 20);
  assert.ok(Math.abs(distance(small.units[0]!, small.units[1]!) - 0.5) < 1e-9);
  const mixed = run([
    unit("polis"),
    unit("polis", { x: 0.1, sprite: "cyclops" }),
    unit("opponent", { x: 9 }),
  ]);
  collect(mixed, 20);
  assert.ok(
    Math.abs(distance(mixed.units[0]!, mixed.units[1]!) - 0.625) < 1e-9,
  );
  // A range-1 Small attacker strikes a Big target from within 0.5244 (inside 0.25 + 0.375);
  // the enemies part no closer than its 0.95 x range slot, 0.475.
  const reach = run([
    unit("polis", { movement: 3, x: -2 }),
    unit("opponent", { sprite: "cyclops", range: 2 }),
  ]);
  const hit = collect(reach, 60).find(
    (e) => e.kind === "attack" && e.from === 0,
  );
  assert.ok(hit?.kind === "attack");
  assert.ok(distance(hit.source, hit.target) <= 0.5244);
  assert.ok(distance(reach.units[0]!, reach.units[1]!) >= 0.475 - 1e-9);
});

test("an issued windup survives leaving Fight while the attacker follows its living target", () => {
  // Dactyl: APS 0.5, windup 50% = 1000 ms, so its strike would land on tick 21.
  const sim = run([
    unit("polis", {
      sprite: "dactyl",
      speed: 0.5,
      windupPercent: 50,
      movement: 4.5,
      damage: 30,
    }),
    // A healer follows its furthest-forward ally (the opponent front is toward -x).
    unit("opponent", { x: -0.5, healing: 10, movement: 3, range: 1 }),
    unit("opponent", { x: -4, range: 0 }),
  ]);
  sim.advance();
  assert.deepEqual(
    [sim.units[0]?.attackAt, sim.units[0]?.target, sim.units[0]?.strike?.at],
    [1, 1, 21],
  );
  // Fight exit hides aim; the source ReleaseAim continuation still reaches its living target.
  sim.advance();
  assert.deepEqual(
    [sim.units[0]?.strike?.at, sim.units[0]?.walking],
    [21, true],
  );
  const events = collect(sim, 40);
  assert.deepEqual(
    events
      .filter((e) => e.kind === "impact" && e.from === 0)
      .map((e) => e.tick),
    [21],
  );
  assert.equal(sim.units[1]?.health, 970);
});

test("the attack timer only runs in Fight: the first hit is immediate, the next waits after a walk", () => {
  const sim = run([
    unit("polis", { windupPercent: 50, damage: 100, movement: 3 }),
    unit("opponent", { x: 0.5, health: 10, range: 0 }),
    unit("opponent", { x: 2.5, range: 0 }),
  ]);
  const events = collect(sim, 200);
  const attacks = events.flatMap((e) =>
    e.kind === "attack" && e.from === 0 ? [e] : [],
  );
  const impacts = events.filter((e) => e.kind === "impact" && e.from === 0);
  assert.deepEqual(
    [attacks[0]?.tick, impacts[0]?.tick, sim.units[1]?.health],
    [1, 11, 0],
  );
  // Walking ticks 12-38 (stopping at the 0.95 x range slot); in range from tick 39 with 0.5 s
  // accrued during the windup, the timer exceeds 1 s on tick 48, not on arrival.
  assert.deepEqual(
    attacks.slice(1, 3).map((e) => e.tick),
    [48, 68],
  );
  assert.ok(distance(attacks[1]!.source, attacks[1]!.target) <= 0.5244);
});

test("a fighting unit keeps its living target when another enemy comes closer", () => {
  const sim = run([
    unit("polis", { range: 2 }),
    unit("opponent", { x: 1 }),
    unit("opponent", { x: -3, movement: 3, range: 0 }),
  ]);
  for (let tick = 0; tick < 80; tick++) {
    sim.advance();
    assert.equal(sim.units[0]?.target, 1);
  }
  assert.ok(
    distance(sim.units[0]!, sim.units[2]!) <
      distance(sim.units[0]!, sim.units[1]!),
  );
});

test("a cyclops strikes a source hoplite within its tolerance and beyond both bodies", () => {
  const polis = newGame(7, "stag");
  polis.placements.push({
    id: "gigantes-camp",
    tile: tileId.parse(43),
    level: 1,
    workers: 1,
    rune: null,
  });
  const rival = newGame(8, "raven");
  rival.placements.push({
    id: "spear-camp",
    tile: tileId.parse(43),
    level: 1,
    workers: 1,
    rune: null,
  });
  const cyclops = warband(polis, "polis").find((u) => u.sprite === "cyclops");
  const hoplite = warband(rival, "opponent").find(
    (u) => u.sprite === "hoplite",
  );
  assert.ok(cyclops && hoplite);
  assert.deepEqual([cyclops.range, cyclops.movement], [2, 2]);
  const sim = run([
    { ...cyclops, x: -3, y: 0 },
    { ...hoplite, x: 0, y: 0, movement: 0 },
  ]);
  const strikes = collect(sim, 400)
    .filter((e) => e.kind === "attack" && e.from === 0)
    .map((e) => (e.kind === "attack" ? distance(e.source, e.target) : 0));
  assert.ok(strikes.length > 0);
  for (const d of strikes) assert.ok(d >= 0.625 && d <= 1.0124, String(d));
  // The first strike comes within one 0.05 step of the tolerance edge.
  assert.ok(strikes[0]! > 1.0124 - 0.05);
});

test("no unit walks in place within source tolerance for more than one tick in a mixed battle", () => {
  const tiles = [43, 30, 44, 31, 42, 29, 45, 32, 36, 37, 35, 38].map((t) =>
    tileId.parse(t),
  );
  const side = (
    seed: number,
    clan: "stag" | "raven",
    camps: [ShopBuildingId, number?][],
    who: Fighter["side"],
  ) => {
    const game = newGame(seed, clan);
    camps.forEach(([id, workers = 1], i) =>
      game.placements.push({
        id,
        tile: tiles[i]!,
        level: 1,
        workers,
        rune: null,
      }),
    );
    return warband(game, who);
  };
  const sim = run([
    ...side(
      7,
      "stag",
      [
        ["spear-camp", 3],
        ["archer-camp", 3],
        ["javelin-camp", 2],
        ["healers-hut", 2],
        ["wolf-den"],
        ["drakon-nest"],
        ["gigantes-camp"],
      ],
      "polis",
    ),
    ...side(
      8,
      "raven",
      [
        ["shield-camp", 3],
        ["tombs-of-erebus"],
        ["gate-of-hades"],
        ["altar-of-olympus"],
        ["dactyl-camp"],
        ["menders-hut", 2],
        ["charons-barge"],
        ["hall-of-rhapsodes", 2],
      ],
      "opponent",
    ),
  ]);
  const streak = sim.units.map(() => 0);
  let longest = 0;
  while (!sim.result) {
    const before = sim.units.map((u) => ({ x: u.x, y: u.y }));
    sim.advance();
    for (const u of sim.units) {
      const v = u.target === null ? null : sim.units[u.target]!;
      const step = u.movement * arenaPerSource * 0.05;
      const blocked =
        u.life.kind === "alive" &&
        u.walking &&
        v !== null &&
        distance(u, before[u.id]!) < 0.2 * step &&
        (distance(u, v) / arenaPerSource) ** 2 <= u.range ** 2 + 0.1;
      streak[u.id] = blocked ? streak[u.id]! + 1 : 0;
      longest = Math.max(longest, streak[u.id]!);
    }
  }
  assert.ok(longest <= 1, String(longest));
  assert.ok(sim.result.ticks < 2400);
});

test("practice opponents use the source Hoplite motion row", () => {
  const encounter = practiceMatch(newGame(42, "raven"));
  const opponents = encounter.fighters.filter((u) => u.side === "opponent");
  assert.ok(opponents.length > 0);
  for (const u of opponents)
    assert.deepEqual(
      [u.range, u.speed, u.movement, u.windupPercent],
      [1, Math.fround(0.8), 3, 50],
    );
});

test("projectile units announce a missile; drakon breathes fire", () => {
  for (const [sprite, effect, projectile] of [
    ["peltast", "spear", true],
    ["tracker", "arrow", true],
    ["drakon", "fire", true],
    ["hoplite", "spear", false],
  ] as const) {
    const sim = run([
      unit("polis", { sprite, range: 10 }),
      unit("opponent", { x: 3, range: 0 }),
    ]);
    const attack = collect(sim, 1).find((e) => e.kind === "attack");
    assert.ok(attack?.kind === "attack", sprite);
    assert.deepEqual([attack.effect, attack.projectile], [effect, projectile]);
  }
});
