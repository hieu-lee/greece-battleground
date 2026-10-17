import { z } from "zod";
import { opponentLayout } from "./encounter-layout.ts";
import { tileId } from "./map.ts";
import { attackEffect } from "./effects.ts";
import type {
  CombatEvent,
  CombatEventPayload,
  CombatSender,
} from "./effects.ts";
import { deathWardChain, troopId } from "./rules.ts";
import { sourceUnitBody } from "./source-numbers.ts";
import { tutorialBodies } from "./tutorial-opponents-data.ts";
import { binary32Max, floatStat, statValue } from "./float-stat.ts";
import type { FloatStat } from "./float-stat.ts";

// Combat stats are source FloatStats (binary32). Structure effects scale some of them by stored
// currency (Charon's Barge: +15 Health per Drachma at level 3), so the only sound bound is the
// largest finite binary32 value, not a hand-picked cap.
const amount = z.number().min(0).max(binary32Max);
const unitBodies = { ...sourceUnitBody, ...tutorialBodies };
const triggerValues = {
  value: amount,
  seconds: z.number().min(0).max(60),
};
const buffStat = z.enum(["ward", "crit", "burn", "armor", "damage"]);
const unitTrigger = z.discriminatedUnion("on", [
  z
    .object({
      on: z.enum(["battle-start", "struck", "crit"]),
      stat: buffStat,
      ...triggerValues,
    })
    .strict(),
  z
    .object({
      on: z.literal("health-below"),
      stat: buffStat,
      below: z.number().min(0).max(1),
      ...triggerValues,
    })
    .strict(),
  z
    .object({
      on: z.literal("hit-other"),
      stat: z.literal("haste"),
      ...triggerValues,
    })
    .strict(),
]);
export const side = z.enum(["polis", "opponent"]);
export const fighter = z
  .object({
    name: z.string().min(1).max(60),
    // Shop troops, both chiefs and the PvE neutrals.
    sprite: z.enum([
      ...troopId.options,
      "aegeus",
      "atalanta",
      "lykaon",
      "thracian-raider",
      "fox",
      "boar",
      "bear",
    ]),
    attackEffect: attackEffect.optional(),
    side,
    origin: z.object({ side, tile: tileId }).strict().nullable().default(null),
    x: z.number().min(-30).max(30),
    y: z.number().min(-20).max(20),
    health: z.number().min(-binary32Max).max(binary32Max),
    armor: amount,
    damage: amount,
    attackStat: floatStat.optional(),
    armorStat: floatStat.optional(),
    damageStat: z
      .enum(["attack", "fire", "poison", "thorn", "frost", "health"])
      .default("attack"),
    piercing: z.boolean().default(false),
    damageReduction: amount.default(0),
    speed: z.number().positive().max(100),
    speedStat: z
      .object({
        basis: z.number().positive().max(binary32Max),
        multiply: z.number().min(-binary32Max).max(binary32Max),
      })
      .strict()
      .optional(),
    windupPercent: z.number().int().min(0).max(100),
    movement: z.number().min(0).max(20),
    range: z.number().min(0).max(20),
    crit: z.number().min(0).max(100),
    burn: amount,
    thorn: amount.optional(),
    ward: z.number().int().min(0).max(1000),
    regen: amount.default(0),
    healing: amount.optional(),
    revive: z.number().min(0).max(2_147_483_647).optional(),
    poison: amount.optional(),
    stun: amount.optional(),
    cleave: z.number().min(-binary32Max).max(binary32Max).optional(),
    frost: z.number().min(-binary32Max).max(binary32Max).optional(),
    criticalGrowth: amount.default(0),
    // Fate Charm hooks (rules.ts Trigger) and Insight per attack kill (Know Your Enemy).
    triggers: z.array(unitTrigger).max(8).optional(),
    deathWardChain: deathWardChain.optional(),
    killInsight: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [key, current] of [
      ["attackStat", value.damage],
      ["armorStat", value.armor],
    ] as const) {
      const stat = value[key];
      if (stat && statValue(stat) !== Math.fround(current))
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "FloatStat metadata must reproduce its current value",
        });
    }
    if (value.speedStat) {
      const factor = Math.fround(value.speedStat.multiply);
      const expected =
        factor === 0
          ? Math.fround(value.speedStat.basis)
          : Math.fround(Math.fround(value.speedStat.basis) * factor);
      if (expected !== Math.fround(value.speed))
        ctx.addIssue({
          code: "custom",
          path: ["speedStat"],
          message: "Attack speed metadata must reproduce its current value",
        });
    }
    if (Math.fround(value.frost ?? 0) >= 2_147_483_648)
      ctx.addIssue({
        code: "custom",
        path: ["frost"],
        message: "Frost upward rounding must fit a signed32 integer",
      });
    const interval = Math.fround(1 / Math.fround(value.speed));
    if (
      !Number.isFinite(interval) ||
      !Number.isFinite(Math.fround(interval * value.windupPercent))
    )
      ctx.addIssue({
        code: "custom",
        path: ["speed"],
        message: "Attack windup must remain finite in binary32",
      });
    if (Math.fround(value.revive ?? 0) >= 2_147_483_648)
      ctx.addIssue({
        code: "custom",
        path: ["revive"],
        message:
          "Modified revival count must fit a nonnegative signed32 integer",
      });
    if (value.origin && value.origin.side !== value.side)
      ctx.addIssue({ code: "custom", message: "Fighter origin side mismatch" });
  });
export const horn = z
  .object({
    side,
    speed: z.number().positive().max(binary32Max),
    duration: z.number().positive().max(binary32Max),
    targets: z.array(tileId).max(128),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!Number.isFinite(Math.fround(1 / Math.fround(value.speed))))
      ctx.addIssue({
        code: "custom",
        path: ["speed"],
        message: "Horn interval must remain finite in binary32",
      });
    if (Math.fround(value.duration) <= 0)
      ctx.addIssue({
        code: "custom",
        path: ["duration"],
        message: "Haste duration must remain positive in binary32",
      });
  });
const signedStat = z.number().min(-binary32Max).max(binary32Max);
export const tower = z
  .object({
    item: z.enum(["defense-tower", "thunderbolt-of-zeus"]),
    side,
    origin: z.object({ side, tile: tileId }).strict(),
    x: z.number().min(-30).max(30),
    y: z.number().min(-20).max(20),
    speed: signedStat,
    count: signedStat,
    damage: signedStat,
    burn: signedStat,
    poison: signedStat,
    frost: signedStat,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.origin.side !== value.side)
      ctx.addIssue({ code: "custom", message: "Tower origin side mismatch" });
    if (Math.fround(value.frost) >= 2_147_483_648)
      ctx.addIssue({
        code: "custom",
        path: ["frost"],
        message: "Frost upward rounding must fit a signed32 integer",
      });
  });
export type Tower = z.infer<typeof tower>;
export const battle = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff),
    kind: z.enum(["training", "pvp", "pve"]),
    opponent: z.string().min(1).max(60),
    opponentLayout: opponentLayout.nullable().default(null),
    fighters: z.array(fighter).min(2).max(256),
    horns: z.array(horn).max(128).optional(),
    towers: z.array(tower).max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "pvp") {
      const layout = value.opponentLayout;
      if (
        !layout ||
        value.fighters.some(
          (unit) =>
            !unit.origin ||
            (unit.side === "opponent" &&
              !layout.placements.some(([tile]) => tile === unit.origin?.tile)),
        ) ||
        value.towers?.some(
          (controller) =>
            controller.side === "opponent" &&
            !layout.placements.some(
              ([tile]) => tile === controller.origin.tile,
            ),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "PvP needs actual opponent layout and fighter origins",
        });
    } else if (value.opponentLayout !== null)
      ctx.addIssue({
        code: "custom",
        message: "Synthetic encounter cannot claim an opponent settlement",
      });
    if (
      !value.fighters.some((u) => u.side === "polis") ||
      !value.fighters.some((u) => u.side === "opponent")
    )
      ctx.addIssue({ code: "custom", message: "Both warbands are required" });
  });
export type Battle = z.infer<typeof battle>;
export type Fighter = z.infer<typeof fighter>;
export const outcome = z
  .object({
    winner: z.enum(["polis", "opponent", "draw"]),
    ticks: z.number().int().min(0).max(2400),
    survivors: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    // Shared campaign Insight from qualifying kills, paid by atomic Ready settlement.
    insight: z.number().int().positive().optional(),
  })
  .strict();
export type Outcome = z.infer<typeof outcome>;
type Life =
  | { kind: "alive" }
  | { kind: "reviving"; restoreAt: number }
  | { kind: "dead" };
type Unit = Fighter & {
  id: number;
  thorn: number;
  maximumHealth: number;
  maximumArmor: number;
  healing: number;
  poison: number;
  stun: number;
  cleave: number;
  currentRevives: number;
  life: Life;
  poisoned: number;
  poisonProgress: number;
  stunned: number;
  hasted: number;
  frost: number;
  frostStacks: number;
  frozen: number;
  stopped: boolean;
  readonly speedBasis: number;
  readonly speedMultiplier: number;
  speedChanges: {
    kind: "stun" | "frost" | "freeze" | "haste";
    value: number;
  }[];
  readonly startingDamage: number;
  readonly attackStat: FloatStat;
  readonly armorStat: FloatStat;
  windupSeconds: number;
  burning: number;
  burnProgress: number;
  /** Source StateBehaviourFight timer: accrues only while in Fight; an attack resets it. */
  fightTimer: number;
  /** The first Fight entry attacks at once (source OnEnter flag). */
  fought: boolean;
  /** Tick the unit entered Move (it re-picks its target every 0.1 s there), else null. */
  moveSince: number | null;
  /** Every enemy had its maximum attackers when the unit picked: it holds no slot. */
  waiting: boolean;
  target: number | null;
  walking: boolean;
  attackAt: number | null;
  hitAt: number | null;
  deathAt: number | null;
  strike: {
    kind: "attack" | "heal";
    at: number;
    projectileId: number | null;
    held: boolean;
  } | null;
  facing: number;
  timed: { stat: z.infer<typeof buffStat>; value: number; remaining: number }[];
  thresholdFired: boolean;
};

export const tickSeconds = 0.05;
// Engine distances are arena units. Source attackRange, movementSpeed and UnitSizeData
// _colliderRadius share Unity units; Small bodies (0.5) are our art's 0.25, so every source
// distance is multiplied by this one constant and Fighter rows keep literal source values.
export const arenaPerSource = 0.5;
export const bodyRadius = (sprite: Fighter["sprite"]) =>
  unitBodies[sprite].radius * arenaPerSource;
function sourceDistanceSquared(
  u: { x: number; y: number },
  v: { x: number; y: number },
) {
  const dx = Math.fround((v.x - u.x) / arenaPerSource);
  const dy = Math.fround((v.y - u.y) / arenaPerSource);
  return Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy));
}
// Source Fightcheck (binary32): isWithinRange = range² + 0.1 >= squared centre distance,
// evaluated in source units.
function inRange(
  u: { x: number; y: number; range: number },
  v: { x: number; y: number },
) {
  return (
    sourceDistanceSquared(u, v) <=
    Math.fround(Math.fround(u.range * u.range) + Math.fround(0.1))
  );
}
// Core scalar math is locked to demo 0.77.111d; scheduling and RNG remain provisional.
export const combatPolicies = {
  tickSeconds,
  maximumTicks: 2400,
  armor:
    "An expendable pool absorbs nonpiercing damage and always absorbs Fire and Thorn.",
  ward: "One charge absorbs damage from an attack or Burn tick; attached Burn still applies.",
  burn: "Each source starts its own one-second timer; added stacks preserve progress. Fire damage precedes 20% decay, with binary32 rounding and removal at 0.0001 stacks.",
  critical:
    "An inclusive binary32 percentage comparison doubles damage. The seeded LCG is provisional, not Unity RNG. Critical-hit growth stacks binary32 Add grants on living attackers, including Ward-blocked hits; death clears those temporary grants. Attack simultaneity, revival integration and complete Unity event/frame parity remain provisional.",
  thorn:
    "A nonprojectile Attack hit reflects the defender’s current Thorn damage after incoming callbacks, including an armor-absorbed or lethal hit. Ward-blocked and fully damage-reduced hits do not reflect. Reflection inherits the incoming critical flag, uses Armor and Ward, does not recurse or attach base Burn/Poison, and uses normal living or reviving reflector crit/kill callbacks. Event scheduling remains provisional.",
  poison:
    "Every hit adds the attacker's Poison stacks, even when Ward blocks it. Each poisoned unit ticks once per second from its first stack for stacks × 1 Poison damage that Ward and Armor absorb; stacks never decay, and each point of healing removes one stack.",
  regeneration:
    "Positive modified Regen heals living or reviving recipients through ordinary Health processing, capped at starting maximum and cleansing Poison by the amount healed. It does not finish revival early and ignores true-dead actors. The source seconds dispatcher uses a strict >1 initial gate; this port's fixed one-second tick, frame phase and ordering remain provisional.",
  deathWardChain:
    "True death synchronously grants direct current Ward to up to3 nearest friendly actors within source range999, rescanning from the original source each hop. Source/prior/dead recipients are excluded; reviving allies qualify. Binary32 squared-distance ties preserve registration order. Successful revival does not dispatch it. Source Transform3D geometry is projected into this port's provisional2D arena; native scene initialization order remains an acceptance input.",
  healing:
    "Healers target the nearest injured ally by binary32 squared distance, otherwise move with the furthest-forward ally. Full targets cancel before windup; a target filled during windup receives a zero heal. Critical heals double. Path eligibility and ties are UNKNOWN.",
  stun: "Ordinary attacks add the current Stun stat as binary32 seconds even when Ward absorbs damage. Active Stun suspends new Fight/Move actions, preserving an already-issued delayed hit. The timer subtracts battle delta while alive or reviving; revival does not reset it. True death cancels it. The existing fixed-step scheduling remains provisional, not native Unity frame parity.",
  cleave:
    "Normal source settings: nearest-even Cleave count, radius2.5 around the primary target, and50% of original precritical health/status values rounded away from zero. Secondary hits retain critical/piercing, force nonprojectile, attach scaled positive statuses even through Ward, and credit kills without ordinary critical growth or recursive Cleave. Candidate distance uses binary32 with the source IntroSort tie behavior. Healing selects injured same-team secondary targets and attaches no damage statuses. The current simulation projects source3D positions into its provisional2D50ms geometry.",
  towers:
    "Static item controllers use strict binary32 APS timers paused through every burst delay, including the final wait. Positive fractional counts ceil. Tower selects nearest unselected recipients, cycling when exhausted; Thunderbolt samples with replacement using the port RNG. The source overlap buffer holds32 colliders before dead filtering/deduplication. This port offers its first32 enemy actors as one-collider proxies; native collider membership, ordering, height and Unity RNG remain UNKNOWN. Arrows track targets at source speed15; infinite-speed lightning arrives on the next50ms update. Sender-null projectiles apply health then positive Fire/Poison/Frost once, without Unit callbacks or alive contribution. Global frame/physics order remains provisional.",
  frost:
    "Positive ordinary Frost rounds upward to stacks, capped at100. Direct attacks apply it once; projectiles apply their original temporary list before Cleave, then a dedicated second primary Frost pass (both captured source builds). Stacks1–49 add -0.15 and50–99 add -0.30 to the ordered attack-speed Multiply group; they do not periodically decay. At100, the slow clears and a separate -1 modifier/freezing control starts for2 binary32 battle-seconds. An ordered-zero Multiply aggregate skips multiplication. Incoming Frost is ignored while frozen. Ordinary steering reads a distinct source stat, so no movement-speed multiplier is applied. Stun/Freeze share a last-write control Boolean; ending either can unlock actions while its peer remains active. Fixed50ms scheduling remains provisional.",
  haste:
    "Haste adds one +1 operand to the ordered instance attack-speed Multiply group. Reapplication adds binary32 seconds without stacking another operand. Its timer continues through revival, while true death cancels it. Ordinary steering reads the distinct source movement stat. Horn controllers preserve binary32 timer overshoot and activate only strictly above their phase-start reciprocal APS threshold; normal completion subtracts max(0.05,1/currentAPS). Fixed50ms event ordering remains provisional.",
  revival:
    "A nearest-even rounded Revive charge guarantees revival: the unit lies reviving (alive for victory, untargetable) for 3 s, then restores full Health and Armor; in the3D player, Champion restoration shows a half-second HDR model flash and ground dust, with adapted linear fade/smoke. Other revivals retain the generic heal cue. Burn and Poison attached by the lethal hit still apply and resume ticking after restoration. External revival handlers (status reset) are UNKNOWN.",
  fate: "Battle-start grants apply at t=0. Struck grants require a negative Health+Armor result, including status ticks and reflection; Ward, invincibility and zero results do not trigger them. Armor raises the maximum without replenishing the pool. Damage grants join ordered Add before Multiply. Ordinary grants and Raven critical growth survive revival; true-dead bodies retain the inert lifetime policy. Duration0 uses an effectively infinite binary32 timer, with a fresh holder and no stack cap. Finite timers subtract binary32 delta; Ward expiry subtracts the original grant from the shared current pool. Second Wind polls the health ratio once per battle, including revival. Vitalic Rush grants additive-duration Haste to the healer's current target after completed heals (including zero) or reflected callbacks. Fixed50ms phase scheduling remains provisional. War Lessons pays the active campaign1 Insight per qualifying troop kill from either army, including an opposing ghost. Primary completion rejects an actually dead source; reviving sources and secondary kills retain their callback eligibility. Successful revival and ordinary periodic Burn/Poison do not pay. Guaranteed rewards consume a random sample. The atomic battle credits this total at Ready before PostBattle; Continue never repays it.",
  targeting:
    "The nearest enemy with a free attack slot (source UnitSizeData maximum attackers: Small 4, Big 6), else the nearest enemy (source NoTargetsAvailable); tied distances retain deployment order. Slots count the enemies currently assigned to a unit, a provisional reading: source slot allocation and its ring search are UNKNOWN. A unit in range keeps its living target (source Fight); a moving unit re-picks every 0.1 s and at once when its target falls; idle re-picks every tick (source: every 1 s). Chief priorities Aggro/WaitForBackup are UNKNOWN and not applied.",
  movement:
    "Source distances × 0.5 arena units (arenaPerSource): range, movement and the UnitSizeData collider radius (Small 0.5, Big 0.75). In range when range² + 0.1 ≥ squared centre distance (binary32, source units). Units walk straight toward the slot at 0.95 × range, a unit without a free slot too (the source NoTargetsAvailable position rule is UNKNOWN). Overlapping bodies push apart symmetrically, enemies only down to the shorter range's slot (it lies inside a Big target's collider). A unit held back to under a fifth of a step stands rather than walking in place. Separation, steering and the battle spawn geometry are provisional (source spread force and NavMesh steering are UNKNOWN).",
  windup:
    "The attack timer runs only while in range of the target; the first time a unit is in range it attacks at once, later attacks wait until the timer exceeds max(0.05 s, 1/APS). Current APS and source windup percentage request a binary32 delay, clamped to 50ms and rounded to nearest milliseconds. Fixed 50ms steps round scheduling upward. Leaving Fight or being stunned does not cancel an already-issued hit on the same living target; falling does. Tracker, Peltast and Drakon release independent projectiles at windup end. Their captured payload tracks its selected target at source speed15 until binary32 XZ progress reaches99%; health/status/Cleave/current Frost resolve at arrival. Native world spawn/HitSpot transforms, Unity frame and battle-end teardown remain unverified.",
};

// Current source ArraySortHelper preserves its count-three and partition tie behavior.
// evidence/pve-current-cleave-2026-10-16 documents the native branches and literal witnesses.
function sortCleaveTargets(targets: { unit: Unit; distance: number }[]) {
  const compare = (i: number, j: number) =>
    targets[i]!.distance - targets[j]!.distance;
  const swap = (i: number, j: number) => {
    [targets[i], targets[j]] = [targets[j]!, targets[i]!];
  };
  const swapGreater = (i: number, j: number) => {
    if (compare(i, j) > 0) swap(i, j);
  };
  function downHeap(i: number, n: number, lo: number) {
    const saved = targets[lo + i - 1]!;
    while (i <= Math.floor(n / 2)) {
      let child = 2 * i;
      if (child < n && compare(lo + child - 1, lo + child) < 0) child++;
      if (saved.distance >= targets[lo + child - 1]!.distance) break;
      targets[lo + i - 1] = targets[lo + child - 1]!;
      i = child;
    }
    targets[lo + i - 1] = saved;
  }
  function intro(lo: number, hi: number, depth: number) {
    while (hi > lo) {
      const count = hi - lo + 1;
      if (count <= 16) {
        if (count === 2) swapGreater(lo, hi);
        else if (count === 3) {
          swapGreater(lo, hi - 1);
          swapGreater(lo, hi);
          swapGreater(hi - 1, hi);
        } else {
          for (let i = lo; i < hi; i++) {
            const saved = targets[i + 1]!;
            let j = i;
            while (j >= lo && saved.distance < targets[j]!.distance) {
              targets[j + 1] = targets[j]!;
              j--;
            }
            targets[j + 1] = saved;
          }
        }
        return;
      }
      if (depth === 0) {
        for (let i = Math.floor(count / 2); i >= 1; i--) downHeap(i, count, lo);
        for (let i = count; i > 1; i--) {
          swap(lo, lo + i - 1);
          downHeap(1, i - 1, lo);
        }
        return;
      }
      depth--;
      const mid = lo + Math.floor((hi - lo) / 2);
      swapGreater(lo, mid);
      swapGreater(lo, hi);
      swapGreater(mid, hi);
      const pivot = targets[mid]!.distance;
      swap(mid, hi - 1);
      let left = lo,
        right = hi - 1;
      while (left < right) {
        do left++;
        while (targets[left]!.distance < pivot);
        do right--;
        while (pivot < targets[right]!.distance);
        if (left >= right) break;
        swap(left, right);
      }
      swap(left, hi - 1);
      intro(left + 1, hi, depth);
      hi = left - 1;
    }
  }
  if (targets.length > 1)
    intro(
      0,
      targets.length - 1,
      2 * (Math.floor(Math.log2(targets.length)) + 1),
    );
}

const lifeOf = (unit: { life: Life }) => unit.life.kind;
// Shared TickableStackDamage threshold (mechanics-ledger source_stack_threshold 0.0001), as Burn.
const negligibleStacks = Math.fround(0.0001);
function dropNegligiblePoison(unit: {
  poisoned: number;
  poisonProgress: number;
}) {
  if (unit.poisoned <= negligibleStacks) {
    unit.poisoned = 0;
    unit.poisonProgress = 0;
  }
}
export function createCombat(input: Battle) {
  const units: Unit[] = input.fighters.map((u, id) => ({
    ...u,
    health: Math.fround(u.health),
    armor: Math.fround(u.armor),
    damage: Math.fround(u.damage),
    startingDamage: Math.fround(u.damage),
    attackStat: u.attackStat ?? {
      base: u.damage,
      add: 0,
      subtract: 0,
      multiply: 1,
    },
    armorStat: u.armorStat ?? {
      base: u.armor,
      add: 0,
      subtract: 0,
      multiply: 1,
    },
    crit: Math.fround(u.crit),
    burn: Math.fround(u.burn),
    thorn: Math.fround(u.thorn ?? 0),
    regen: Math.fround(u.regen),
    healing: Math.fround(u.healing ?? 0),
    poison: Math.fround(u.poison ?? 0),
    stun: Math.fround(u.stun ?? 0),
    cleave: Math.fround(u.cleave ?? 0),
    stunned: 0,
    hasted: 0,
    frost: Math.fround(u.frost ?? 0),
    frostStacks: 0,
    frozen: 0,
    stopped: false,
    speedBasis: Math.fround(u.speedStat?.basis ?? u.speed),
    speedMultiplier: Math.fround(u.speedStat?.multiply ?? 1),
    speedChanges: [],
    currentRevives: (() => {
      const value = Math.fround(u.revive ?? 0);
      const lower = Math.floor(value);
      return value - lower === 0.5
        ? lower + (lower % 2)
        : Math.floor(value + 0.5);
    })(),
    life: { kind: "alive" } as Life,
    poisoned: 0,
    poisonProgress: 0,
    criticalGrowth: Math.fround(u.criticalGrowth),
    damageStat: u.damageStat ?? "attack",
    piercing: u.piercing ?? false,
    damageReduction: Math.fround(u.damageReduction ?? 0),
    id,
    maximumHealth: Math.fround(u.health),
    maximumArmor: Math.fround(u.armor),
    speed: Math.fround(u.speed),
    windupSeconds: 0,
    burning: 0,
    burnProgress: 0,
    fightTimer: 0,
    fought: false,
    moveSince: null,
    waiting: false,
    target: null,
    walking: false,
    attackAt: null,
    hitAt: null,
    deathAt: null,
    strike: null,
    facing: u.side === "polis" ? 1 : -1,
    timed: [],
    thresholdFired: false,
  }));
  const horns = (input.horns ?? []).map((value) => ({
    side: value.side,
    targets: new Set(value.targets),
    duration: Math.fround(value.duration),
    timer: 0,
    threshold: Math.fround(1 / Math.fround(value.speed)),
  }));
  const towers: {
    value: Tower;
    timer: number;
    threshold: number;
    burst: { index: number; at: number } | null;
    selected: Set<number>;
  }[] = (input.towers ?? []).map((value) => ({
    value: {
      ...value,
      speed: Math.fround(value.speed),
      count: Math.fround(value.count),
      damage: Math.fround(value.damage),
      burn: Math.fround(value.burn),
      poison: Math.fround(value.poison),
      frost: Math.fround(value.frost),
    },
    timer: 0,
    threshold: Math.fround(1 / Math.fround(value.speed)),
    burst: null,
    selected: new Set<number>(),
  }));
  const projectiles: {
    tower: Tower;
    to: Unit;
    x: number;
    y: number;
    projectileId: number;
  }[] = [];
  type TroopShot = {
    id: number;
    from: Unit;
    to: Unit;
    source: { x: number; y: number };
    x: number;
    y: number;
    progress: number;
    damage: number;
    critical: boolean;
    statuses: HitStatuses;
  };
  const troopProjectiles: TroopShot[] = [];
  const projectileHeight = (sprite: Fighter["sprite"]) =>
    sprite === "tracker"
      ? Math.fround(0.05)
      : sprite === "peltast"
        ? Math.fround(0.2)
        : 0;
  let ticks = 0;
  let killInsight = 0;
  let random = input.seed;
  let result: Outcome | null = null;
  const events: CombatEvent[] = [];
  let eventId = 0;
  function emit(event: CombatEventPayload) {
    events.push({ ...event, id: eventId++, tick: ticks });
  }
  const position = (unit: { x: number; y: number }) => ({
    x: unit.x,
    y: unit.y,
  });
  function speedChange(
    unit: Unit,
    kind: Unit["speedChanges"][number]["kind"],
    value: number | null,
  ) {
    const existing = unit.speedChanges.find((change) => change.kind === kind);
    if (value === null)
      unit.speedChanges = unit.speedChanges.filter(
        (change) => change.kind !== kind,
      );
    else if (existing) existing.value = value;
    else unit.speedChanges.push({ kind, value });
    let factor = unit.speedMultiplier;
    for (const change of unit.speedChanges)
      factor = Math.fround(factor + change.value);
    unit.speed =
      factor === 0 ? unit.speedBasis : Math.fround(unit.speedBasis * factor);
  }
  function stunTimer(unit: Unit, remaining: number) {
    const active = remaining > 0;
    if (active !== unit.stunned > 0) {
      speedChange(unit, "stun", active ? 0 : null);
      unit.stopped = active;
      if (active && unit.strike) unit.strike.held = false;
    }
    unit.stunned = remaining;
  }
  function hasteTimer(unit: Unit, remaining: number) {
    const active = remaining > 0;
    if (active !== unit.hasted > 0)
      speedChange(unit, "haste", active ? 1 : null);
    unit.hasted = remaining;
  }
  function endFreeze(unit: Unit) {
    speedChange(unit, "freeze", null);
    unit.stopped = false;
    unit.frozen = 0;
    unit.frostStacks = 0;
    speedChange(unit, "frost", null);
  }
  function applyFrost(unit: Unit, value: number) {
    if (value <= 0 || unit.frozen > 0) return;
    const previous = unit.frostStacks;
    if (previous === 0) speedChange(unit, "frost", 0);
    unit.frostStacks = Math.min(100, previous + Math.ceil(value));
    const frozen = unit.frostStacks === 100;
    if (frozen) {
      unit.frozen = 2;
      speedChange(unit, "frost", 0);
      speedChange(unit, "freeze", -1);
      unit.stopped = true;
      if (unit.strike) unit.strike.held = false;
    } else
      speedChange(
        unit,
        "frost",
        -Math.fround((unit.frostStacks >= 50 ? 30 : 15) / 100),
      );
    emit({
      kind: "frost",
      unit: unit.id,
      target: position(unit),
      amount: unit.frostStacks - previous,
      frozen,
    });
  }
  function updateStat(unit: Unit, stat: "damage" | "armor") {
    const operands = unit.timed
      .filter((buff) => buff.stat === stat)
      .map((buff) => buff.value);
    if (stat === "damage") unit.damage = statValue(unit.attackStat, operands);
    else {
      unit.maximumArmor = statValue(unit.armorStat, operands);
      unit.armor = Math.min(unit.armor, unit.maximumArmor);
    }
  }
  function applyBuff(
    unit: Unit,
    stat: z.infer<typeof buffStat>,
    value: number,
    seconds: number,
  ) {
    unit.timed.push({
      stat,
      value: Math.fround(value),
      remaining: seconds === 0 ? binary32Max : Math.fround(seconds),
    });
    if (stat === "damage" || stat === "armor") updateStat(unit, stat);
    else if (stat === "ward") unit.ward += value;
    else unit[stat] = Math.fround(unit[stat] + value);
  }
  function trigger(
    unit: Unit,
    on: NonNullable<Fighter["triggers"]>[number]["on"],
    recipient = unit,
  ) {
    for (const t of unit.triggers ?? []) {
      if (t.on !== on) continue;
      if (t.stat === "haste") {
        hasteTimer(
          recipient,
          Math.min(binary32Max, Math.fround(recipient.hasted + t.seconds)),
        );
        emit({
          kind: "haste",
          unit: recipient.id,
          target: position(recipient),
          amount: t.seconds,
        });
      } else applyBuff(recipient, t.stat, t.value, t.seconds);
    }
  }
  function notifyCurrentTarget(unit: Unit) {
    const target = unit.target === null ? null : units[unit.target];
    if (unit.life.kind !== "dead" && target && target.life.kind !== "dead")
      trigger(unit, "hit-other", target);
  }
  function grantDeathWard(source: Unit) {
    const chain = source.deathWardChain;
    if (!chain) return;
    const selected = new Set<number>();
    const rangeSquared = Math.fround(chain.range * chain.range);
    for (let hop = 0; hop < chain.count; hop++) {
      let target: Unit | undefined;
      let nearest = Infinity;
      for (const candidate of units) {
        if (
          candidate === source ||
          candidate.life.kind === "dead" ||
          candidate.side !== source.side ||
          selected.has(candidate.id)
        )
          continue;
        const distance = sourceDistanceSquared(source, candidate);
        if (distance <= rangeSquared && distance < nearest) {
          nearest = distance;
          target = candidate;
        }
      }
      if (!target) break;
      target.ward += chain.ward;
      selected.add(target.id);
    }
  }
  for (const unit of units) trigger(unit, "battle-start");
  const visual = (unit: Unit) =>
    unit.attackEffect ??
    (unit.sprite === "tracker"
      ? "arrow"
      : unit.sprite === "drakon"
        ? "fire"
        : unit.sprite === "aegeus" ||
            unit.sprite === "atalanta" ||
            unit.sprite === "lykaon"
          ? "kopis"
          : "spear");
  function changeHealth(
    unit: Unit,
    signedAmount: number,
    stat: Fighter["damageStat"],
    critical = false,
    piercing = false,
  ) {
    if (
      unit.life.kind === "dead" ||
      (unit.life.kind === "reviving" && signedAmount <= 0)
    )
      return {
        blocked: unit.life.kind === "reviving" && signedAmount < 0,
        changed: 0,
        receivedAmount: 0,
        armorDamage: 0,
      };
    const healthBefore = unit.health;
    const armorBefore = unit.armor;
    let change = Math.fround(signedAmount);
    if (change < 0 && stat !== "health") {
      if (unit.ward > 0) {
        unit.ward--;
        return { blocked: true, changed: 0, receivedAmount: 0, armorDamage: 0 };
      }
      if (unit.damageReduction > 0)
        change = Math.fround(
          Math.fround(
            1 - Math.fround(Math.min(100, unit.damageReduction) / 100),
          ) * change,
        );
    }
    const receivedAmount = change;
    if (critical) change = Math.fround(change + change);
    if (
      change < 0 &&
      unit.armor > 0 &&
      (!piercing || stat === "fire" || stat === "thorn")
    ) {
      const remainder = Math.fround(change + unit.armor);
      unit.armor = Math.max(0, remainder);
      change = Math.min(0, remainder);
    }
    // Native HealthController clamps twice; branch order matters for negative maxima.
    let health = Math.fround(unit.health + change);
    for (let pass = 0; pass < 2; pass++)
      health =
        health < 0
          ? 0
          : health > unit.maximumHealth
            ? unit.maximumHealth
            : health;
    unit.health = health;
    // The reported change is the combined Health+Armor pool (callback amount, handoff
    // heal-callback-v4-tests-next); TickablePoison.OnHealthChanged removes that many stacks when
    // it is positive (mechanics-ledger poison_defaults).
    const changed = Math.fround(
      Math.fround(Math.fround(unit.health - healthBefore) + unit.armor) -
        armorBefore,
    );
    const armorDamage = Math.fround(armorBefore - unit.armor);
    if (changed > 0 && unit.poisoned > 0) {
      unit.poisoned = Math.max(0, Math.fround(unit.poisoned - changed));
      dropNegligiblePoison(unit);
    }
    if (unit.health <= 0 && unit.life.kind === "alive") {
      unit.deathAt = ticks;
      unit.strike = null;
      if (unit.currentRevives > 0) {
        unit.currentRevives--;
        unit.life = { kind: "reviving", restoreAt: ticks + 3 / tickSeconds };
      } else {
        unit.life = { kind: "dead" };
        unit.timed = unit.timed.filter((buff) => buff.stat !== "damage");
        unit.damage = unit.startingDamage;
        stunTimer(unit, 0);
        hasteTimer(unit, 0);
        endFreeze(unit);
        grantDeathWard(unit);
        emit({ kind: "death", unit: unit.id, target: position(unit) });
      }
    }
    if (changed < 0 && lifeOf(unit) !== "dead") trigger(unit, "struck");
    return { blocked: false, changed, receivedAmount, armorDamage };
  }
  function rewardKill(from: Unit, to: Unit) {
    if (to.life.kind !== "dead" || from.killInsight === undefined) return;
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    killInsight += from.killInsight;
    if (from.killInsight > 0)
      emit({
        kind: "insight",
        unit: from.id,
        target: position(from),
        amount: from.killInsight,
      });
  }
  function damageCallback(from: Unit, to: Unit, critical: boolean) {
    if (from.life.kind === "dead") return;
    notifyCurrentTarget(from);
    if (critical) {
      if (from.criticalGrowth > 0)
        applyBuff(from, "damage", from.criticalGrowth, 0);
      trigger(from, "crit");
    }
    rewardKill(from, to);
  }
  type HitStatuses = Pick<Unit, "burn" | "poison" | "frost" | "stun">;
  function impact(
    source: Unit | { tower: Tower; projectileId: number },
    to: Unit,
    amount: number,
    critical: boolean,
    statuses: HitStatuses,
    projectile: boolean,
    secondary: boolean,
    projectileId?: number,
  ) {
    const from = "tower" in source ? null : source;
    const sender: CombatSender =
      "tower" in source
        ? {
            from: null,
            tower: {
              item: source.tower.item,
              side: source.tower.side,
              tile: source.tower.origin.tile,
            },
            projectileId: source.projectileId,
          }
        : {
            from: source.id,
            ...(projectileId === undefined ? {} : { projectileId }),
          };
    const wasDead = to.life.kind === "dead";
    const hit = changeHealth(
      to,
      amount,
      from?.damageStat ?? "attack",
      critical,
      from?.piercing ?? false,
    );
    const blocked = hit.blocked;
    const armorDamage = hit.armorDamage;
    const life: Life["kind"] = lifeOf(to);
    if (from && secondary) rewardKill(from, to);
    else if (from && !wasDead) damageCallback(from, to, critical);
    if (
      from &&
      hit.receivedAmount < 0 &&
      from.damageStat === "attack" &&
      !projectile &&
      from !== to &&
      from.life.kind !== "dead" &&
      to.thorn >= Math.fround(8 * 1.401298464324817e-45)
    ) {
      const reflected = changeHealth(
        from,
        Math.fround(-to.thorn),
        "thorn",
        critical,
        true,
      );
      damageCallback(to, from, critical);
      if (!reflected.blocked && from.life.kind === "alive") from.hitAt = ticks;
      emit({
        kind: "impact",
        effect: "spear",
        reflection: true,
        source: position(to),
        target: position(from),
        armorDamage: reflected.armorDamage,
        burnApplied: 0,
        from: to.id,
        to: from.id,
        damage: reflected.changed === 0 ? 0 : -reflected.changed,
        critical,
        blocked: reflected.blocked,
      });
    }
    if (life !== "dead") {
      if (from) applyFrost(to, statuses.frost);
      if (statuses.stun > 0) {
        stunTimer(
          to,
          Math.min(binary32Max, Math.fround(to.stunned + statuses.stun)),
        );
        emit({
          kind: "stun",
          unit: to.id,
          target: position(to),
          amount: statuses.stun,
        });
      }
      if (statuses.burn > 0) {
        if (to.burning === 0) to.burnProgress = 0;
        to.burning = Math.fround(to.burning + statuses.burn);
      }
      if (statuses.poison > 0) {
        if (to.poisoned === 0) to.poisonProgress = 0;
        to.poisoned = Math.fround(to.poisoned + statuses.poison);
      }
      if (!from) applyFrost(to, statuses.frost);
      if (!blocked && life === "alive") to.hitAt = ticks;
    }
    emit({
      kind: "impact",
      effect:
        "tower" in source
          ? source.tower.item === "defense-tower"
            ? "arrow"
            : "lightning"
          : visual(source),
      source: position("tower" in source ? source.tower : source),
      target: position(to),
      armorDamage,
      burnApplied: life !== "dead" ? statuses.burn : 0,
      ...sender,
      to: to.id,
      damage: hit.changed === 0 ? 0 : -hit.changed,
      critical,
      blocked,
    });
  }
  function cleave(
    from: Unit,
    primary: Unit,
    amount: number,
    critical: boolean,
    statuses: HitStatuses,
  ) {
    const lower = Math.floor(from.cleave);
    const count =
      from.cleave - lower === 0.5
        ? lower + (lower % 2)
        : Math.floor(from.cleave + 0.5);
    if (
      count <= 0 ||
      count >= 2_147_483_648 ||
      (amount <= 0 && from.damageStat === "health")
    )
      return;
    if (
      Math.abs(amount) < Math.fround(8 * 1.401298464324817e-45) &&
      !Object.values(statuses).some((value) => value > 0)
    )
      return;
    const healing = amount > 0;
    const targets = [];
    for (const unit of units) {
      if (
        unit === primary ||
        unit === from ||
        unit.life.kind === "dead" ||
        unit.side !== primary.side ||
        (healing && unit.health >= unit.maximumHealth)
      )
        continue;
      const dx = Math.fround((unit.x - primary.x) / arenaPerSource);
      const dy = Math.fround((unit.y - primary.y) / arenaPerSource);
      const distance = Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy));
      if (distance <= Math.fround(2.5 * 2.5)) targets.push({ unit, distance });
    }
    sortCleaveTargets(targets);
    const scale = (value: number) => {
      const scaled = Math.fround(Math.fround(Math.abs(value) * 50) / 100);
      const ceil = Math.ceil(scaled);
      // The reached native conversion is signed32; overflowing conversions yield INT_MIN.
      if (ceil >= 2_147_483_648) return -2_147_483_648;
      return Math.fround(Math.sign(value) * ceil);
    };
    const health = scale(amount);
    const scaled = {
      burn: Math.max(0, scale(statuses.burn)),
      poison: Math.max(0, scale(statuses.poison)),
      frost: Math.max(0, scale(statuses.frost)),
      stun: Math.max(0, scale(statuses.stun)),
    };
    for (const { unit } of targets.slice(0, count)) {
      if (unit.life.kind === "dead") continue;
      if (healing) {
        const healed = changeHealth(
          unit,
          health,
          "health",
          critical,
          from.piercing,
        );
        if (healed.changed > 0)
          emit({
            kind: "heal",
            unit: unit.id,
            target: position(unit),
            amount: healed.changed,
          });
      } else impact(from, unit, health, critical, scaled, false, true);
    }
  }

  function advance() {
    if (result) return;
    ticks++;
    while (events[0] && ticks - events[0].tick > 40) events.shift();
    for (const u of units) {
      for (let index = u.timed.length - 1; index >= 0; index--) {
        const buff = u.timed[index]!;
        buff.remaining = Math.fround(buff.remaining - Math.fround(tickSeconds));
        if (buff.remaining > 0) continue;
        u.timed.splice(index, 1);
        if (buff.stat === "damage" || buff.stat === "armor")
          updateStat(u, buff.stat);
        else if (buff.stat === "ward") u.ward -= Math.min(u.ward, buff.value);
        else u[buff.stat] = Math.fround(u[buff.stat] - buff.value);
      }
      const threshold = u.triggers?.find((t) => t.on === "health-below");
      if (
        u.life.kind !== "dead" &&
        threshold &&
        !u.thresholdFired &&
        u.maximumHealth > 0 &&
        Math.fround(Math.fround(u.health / u.maximumHealth) * 100) <
          Math.fround(threshold.below * 100)
      ) {
        u.thresholdFired = true;
        trigger(u, "health-below");
      }
    }
    for (const u of units) {
      if (u.life.kind !== "dead" && u.hasted > 0)
        hasteTimer(
          u,
          Math.max(0, Math.fround(u.hasted - Math.fround(tickSeconds))),
        );
      if (u.life.kind !== "dead" && u.stunned > 0)
        stunTimer(
          u,
          Math.max(0, Math.fround(u.stunned - Math.fround(tickSeconds))),
        );
      if (u.life.kind !== "dead" && u.frozen > 0) {
        u.frozen = Math.fround(u.frozen - Math.fround(tickSeconds));
        if (u.frozen <= 0) endFreeze(u);
      }
      if (u.life.kind === "reviving" && ticks >= u.life.restoreAt) {
        u.health = u.maximumHealth;
        u.armor = u.maximumArmor;
        u.deathAt = null;
        u.life = { kind: "alive" };
        emit({
          kind: "revive",
          unit: u.id,
          target: position(u),
          amount: u.health,
        });
      }
      if (u.life.kind !== "alive" || u.burning <= 0) continue;
      u.burnProgress = Math.fround(u.burnProgress + Math.fround(tickSeconds));
      while (u.burnProgress >= 1 && u.burning > 0) {
        u.burnProgress = Math.fround(u.burnProgress - 1);
        const hit = changeHealth(u, -u.burning, "fire");
        emit({
          kind: "burn",
          unit: u.id,
          target: position(u),
          amount: hit.changed === 0 ? 0 : -hit.changed,
          blocked: hit.blocked,
        });
        const reduction = Math.min(
          u.burning,
          Math.fround(Math.fround(20 * u.burning) / 100),
        );
        u.burning = Math.fround(u.burning - reduction);
      }
      if (u.burning <= negligibleStacks) {
        u.burning = 0;
        u.burnProgress = 0;
      }
    }
    for (const u of units) {
      if (u.life.kind !== "alive" || u.poisoned <= 0) continue;
      u.poisonProgress = Math.fround(
        u.poisonProgress + Math.fround(tickSeconds),
      );
      while (u.poisonProgress >= 1 && u.poisoned > 0) {
        u.poisonProgress = Math.fround(u.poisonProgress - 1);
        const hit = changeHealth(u, -u.poisoned, "poison");
        emit({
          kind: "poison",
          unit: u.id,
          target: position(u),
          amount: hit.changed === 0 ? 0 : -hit.changed,
          blocked: hit.blocked,
        });
      }
    }
    if (ticks % 20 === 0) {
      for (const u of units)
        if (u.life.kind !== "dead" && u.regen > 0) {
          const healed = changeHealth(u, u.regen, "health").changed;
          if (healed > 0)
            emit({
              kind: "heal",
              unit: u.id,
              target: position(u),
              amount: healed,
            });
        }
    }
    for (const horn of horns) {
      horn.timer = Math.fround(horn.timer + Math.fround(tickSeconds));
      if (horn.timer <= horn.threshold) continue;
      for (const unit of units) {
        if (
          unit.life.kind === "dead" ||
          unit.side !== horn.side ||
          !unit.origin ||
          !horn.targets.has(unit.origin.tile)
        )
          continue;
        hasteTimer(
          unit,
          Math.min(binary32Max, Math.fround(unit.hasted + horn.duration)),
        );
        emit({
          kind: "haste",
          unit: unit.id,
          target: position(unit),
          amount: horn.duration,
        });
      }
      horn.timer = Math.fround(
        horn.timer - Math.max(Math.fround(0.05), horn.threshold),
      );
    }
    for (let i = 0; i < projectiles.length;) {
      const shot = projectiles[i]!;
      if (shot.to.life.kind === "dead") {
        projectiles.splice(i, 1);
        continue;
      }
      const dx = shot.to.x - shot.x,
        dy = shot.to.y - shot.y;
      const distance = Math.hypot(dx, dy);
      const step = 15 * arenaPerSource * tickSeconds;
      if (shot.tower.item === "thunderbolt-of-zeus" || distance <= step) {
        impact(
          shot,
          shot.to,
          -shot.tower.damage,
          false,
          {
            burn: Math.max(0, shot.tower.burn),
            poison: Math.max(0, shot.tower.poison),
            frost: Math.max(0, shot.tower.frost),
            stun: 0,
          },
          true,
          false,
        );
        projectiles.splice(i, 1);
      } else {
        shot.x += (dx / distance) * step;
        shot.y += (dy / distance) * step;
        i++;
      }
    }
    for (let i = 0; i < troopProjectiles.length;) {
      const shot = troopProjectiles[i]!;
      // The arena projects the source XZ plane; native spawn/HitSpot heights remain separate.
      const dx = Math.fround(shot.to.x - shot.x);
      const dy = Math.fround(shot.to.y - shot.y);
      const distance = Math.fround(
        Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy))),
      );
      const step = Math.fround(
        Math.fround(15 * arenaPerSource) * Math.fround(tickSeconds),
      );
      if (distance === 0 || distance <= step) {
        shot.x = Math.fround(shot.to.x);
        shot.y = Math.fround(shot.to.y);
      } else {
        shot.x = Math.fround(
          shot.x + Math.fround(Math.fround(dx / distance) * step),
        );
        shot.y = Math.fround(
          shot.y + Math.fround(Math.fround(dy / distance) * step),
        );
      }
      const total = Math.fround(
        Math.sqrt(sourceDistanceSquared(shot.source, shot.to)),
      );
      const traveled = Math.fround(
        Math.sqrt(sourceDistanceSquared(shot.source, shot)),
      );
      shot.progress =
        total === 0
          ? 1
          : Math.min(1, Math.max(0, Math.fround(traveled / total)));
      if (shot.progress >= Math.fround(0.99)) {
        impact(
          shot.from,
          shot.to,
          -shot.damage,
          shot.critical,
          shot.statuses,
          true,
          false,
          shot.id,
        );
        cleave(shot.from, shot.to, -shot.damage, shot.critical, shot.statuses);
        if (lifeOf(shot.to) !== "dead") applyFrost(shot.to, shot.from.frost);
        troopProjectiles.splice(i, 1);
      } else i++;
    }
    for (const controller of towers) {
      const value = controller.value;
      if (!controller.burst) {
        if (value.speed <= 0) continue;
        controller.timer = Math.fround(
          controller.timer + Math.fround(tickSeconds),
        );
        if (controller.timer <= controller.threshold) continue;
        controller.selected.clear();
        controller.burst = { index: 0, at: ticks };
      }
      if (ticks < controller.burst.at) continue;
      if (controller.burst.index >= value.count) {
        controller.burst = null;
        controller.timer = Math.fround(
          controller.timer - Math.max(Math.fround(0.05), controller.threshold),
        );
        continue;
      }
      const pool = units
        .filter((u) => u.side !== value.side)
        .slice(0, 32)
        .filter((u) => u.life.kind !== "dead");
      let candidates = pool.filter(
        (u) => value.item !== "defense-tower" || !controller.selected.has(u.id),
      );
      if (!candidates.length && controller.selected.size) {
        controller.selected.clear();
        candidates = pool;
      }
      let target: Unit | undefined;
      if (value.item === "thunderbolt-of-zeus" && candidates.length) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        target =
          candidates[Math.floor((random / 0x100000000) * candidates.length)];
      } else {
        let nearest = Infinity;
        for (const candidate of candidates) {
          const dx = Math.fround((candidate.x - value.x) / arenaPerSource);
          const dy = Math.fround((candidate.y - value.y) / arenaPerSource);
          const distance = Math.fround(
            Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy))),
          );
          if (distance < nearest) {
            nearest = distance;
            target = candidate;
          }
        }
      }
      if (target) {
        if (value.item === "defense-tower") controller.selected.add(target.id);
        const projectileId = eventId;
        emit({
          kind: "attack",
          from: null,
          tower: {
            item: value.item,
            side: value.side,
            tile: value.origin.tile,
          },
          projectileId,
          to: target.id,
          effect: value.item === "defense-tower" ? "arrow" : "lightning",
          projectile: true,
          source: position(value),
          target: position(target),
          windup:
            value.item === "defense-tower"
              ? Math.hypot(target.x - value.x, target.y - value.y) /
                (15 * arenaPerSource)
              : tickSeconds,
        });
        projectiles.push({
          tower: value,
          to: target,
          x: value.x,
          y: value.y,
          projectileId,
        });
      }
      controller.burst.index++;
      controller.burst.at = ticks + (value.item === "defense-tower" ? 4 : 1);
    }
    // Actions are computed together so deployment order cannot suppress a same-tick attack.
    // Damage is captured when an attack is admitted, so a same-tick death cannot weaken it.
    const attacks: {
      from: Unit;
      to: Unit;
      damage: number;
      kind: "attack" | "heal";
      projectileId: number | null;
    }[] = [];
    const completeStrike = (from: Unit, to: Unit) => {
      if (!from.strike || from.strike.at > ticks) return;
      attacks.push({
        from,
        to,
        damage: from.damage,
        kind: from.strike.kind,
        projectileId: from.strike.projectileId,
      });
      from.strike = null;
    };
    const moves: { unit: Unit; x: number; y: number }[] = [];
    // Attack slots per target (source UnitSizeData _maxAttackers: Small 4, Big 6).
    const attackers = units.map(() => 0);
    for (const u of units)
      if (
        u.life.kind === "alive" &&
        u.healing === 0 &&
        u.target !== null &&
        !u.waiting
      )
        attackers[u.target]!++;
    for (const u of units) {
      u.walking = false;
      if (u.life.kind !== "alive") {
        u.strike = null;
        continue;
      }
      if (u.stopped) {
        const target = u.target === null ? undefined : units[u.target];
        if (target?.life.kind === "alive") completeStrike(u, target);
        else u.strike = null;
        continue;
      }
      const healing = u.healing > 0;
      let target = u.target === null ? undefined : units[u.target];
      // CancelAim hides aim on Fight exit; the issued ReleaseAim still reaches a living target.
      const fighting = target?.life.kind === "alive" && inRange(u, target);
      if (!fighting && u.strike) u.strike.held = false;
      if (target?.life.kind !== "alive") u.strike = null;
      if (
        !u.strike &&
        (healing ||
          (!fighting &&
            (target?.life.kind !== "alive" ||
              u.moveSince === null ||
              (ticks - u.moveSince) % 2 === 0)))
      ) {
        if (!healing && u.target !== null && !u.waiting) attackers[u.target]!--;
        target = undefined;
        let distance = Infinity;
        let key = Infinity;
        let open = false;
        for (const candidate of units) {
          if (
            candidate.life.kind !== "alive" ||
            (healing
              ? candidate.id === u.id || candidate.side !== u.side
              : candidate.side === u.side)
          )
            continue;
          const d = Math.hypot(candidate.x - u.x, candidate.y - u.y);
          if (!healing) {
            // The nearest enemy with a free attack slot, else the nearest (source TryAssign).
            const free =
              attackers[candidate.id]! <
              unitBodies[candidate.sprite].maxAttackers;
            if ((free && !open) || (free === open && d < distance)) {
              target = candidate;
              distance = d;
              open = free;
            }
            continue;
          }
          if (u.movement === 0 && !inRange(u, candidate)) continue;
          // FriendlyDamaged by squared distance, then FriendlyFront (ML rule 41).
          const dx = Math.fround(candidate.x - u.x);
          const dy = Math.fround(candidate.y - u.y);
          const hurt = candidate.health < candidate.maximumHealth;
          const previousHurt = target && target.health < target.maximumHealth;
          const nextKey = hurt
            ? Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy))
            : -candidate.x * (u.side === "polis" ? 1 : -1);
          if (
            !target ||
            (hurt && !previousHurt) ||
            (hurt === previousHurt && nextKey < key)
          ) {
            target = candidate;
            key = nextKey;
          }
        }
        if (!healing) {
          u.waiting = !open;
          if (target && open) attackers[target.id]!++;
        }
      }
      u.target = target?.id ?? null;
      if (!target) {
        u.moveSince = null;
        continue;
      }
      u.facing = target.x >= u.x ? 1 : -1;
      if (!inRange(u, target)) {
        completeStrike(u, target);
        // Move toward the source attack slot at 0.95 x range from the target's centre.
        u.moveSince ??= ticks;
        const distance = Math.hypot(target.x - u.x, target.y - u.y);
        const step = Math.min(
          distance - 0.95 * u.range * arenaPerSource,
          u.movement * arenaPerSource * tickSeconds,
        );
        if (step <= 0) continue;
        moves.push({
          unit: u,
          x: u.x + ((target.x - u.x) / distance) * step,
          y: u.y + ((target.y - u.y) / distance) * step,
        });
        continue;
      }
      u.moveSince = null;
      if (u.speed > 0)
        u.fightTimer = Math.fround(u.fightTimer + Math.fround(tickSeconds));
      if (u.strike) {
        completeStrike(u, target);
        continue;
      }
      if (
        u.speed <= 0 ||
        (u.fought &&
          u.fightTimer <= Math.max(0.05, Math.fround(1 / u.speed))) ||
        (healing && target.health >= target.maximumHealth)
      )
        continue;
      u.fought = true;
      u.fightTimer = 0;
      u.attackAt = ticks;
      const seconds = Math.max(
        Math.fround(0.05),
        Math.fround(
          Math.fround(Math.fround(1 / Math.fround(u.speed)) * u.windupPercent) /
            100,
        ),
      );
      const milliseconds = Math.trunc(seconds * 1000 + 0.5);
      u.windupSeconds = milliseconds / 1000;
      const wait = Math.ceil(milliseconds / (tickSeconds * 1000));
      const projectileId =
        !healing && unitBodies[u.sprite].projectile ? eventId : null;
      if (!healing)
        emit({
          kind: "attack",
          from: u.id,
          to: target.id,
          effect: visual(u),
          projectile: unitBodies[u.sprite].projectile,
          source: position(u),
          target: position(target),
          windup: u.windupSeconds,
        });
      u.strike = {
        kind: healing ? "heal" : "attack",
        at: ticks + wait,
        projectileId,
        held:
          projectileId !== null &&
          (u.sprite === "tracker" || u.sprite === "peltast"),
      };
    }
    const starts = moves.map(({ unit }) => position(unit));
    for (const move of moves) {
      move.unit.x = move.x;
      move.unit.y = move.y;
    }
    // Separate living bodies symmetrically after their simultaneous movement. Enemies part only
    // down to the shorter range's source attack slot (0.95 x range from the target's centre):
    // that slot lies inside a Big target's collider for a Small range-1 attacker.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < units.length; i++) {
        const a = units[i];
        if (!a || a.life.kind !== "alive") continue;
        for (let j = i + 1; j < units.length; j++) {
          const b = units[j];
          if (!b || b.life.kind !== "alive") continue;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const bodies = bodyRadius(a.sprite) + bodyRadius(b.sprite);
          const contact =
            a.side === b.side
              ? bodies
              : Math.min(
                  bodies,
                  0.95 * arenaPerSource * Math.min(a.range, b.range),
                );
          if (d >= contact) continue;
          const overlap = (contact - d) / 2;
          const nx = d > 0 ? dx / d : 0,
            ny = d > 0 ? dy / d : 1;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
        }
      }
    }
    // Walking means covering at least a fifth of a full step: a unit held back by the crowd, or
    // settling at its stop point, stands instead of walking in place.
    moves.forEach(({ unit }, i) => {
      const start = starts[i]!;
      unit.walking =
        Math.hypot(unit.x - start.x, unit.y - start.y) >=
        0.2 * unit.movement * arenaPerSource * tickSeconds;
      if (unit.walking && (ticks + unit.id * 2) % 5 === 0)
        emit({ kind: "footstep", unit: unit.id, target: position(unit) });
    });
    for (const { from, to, damage, kind, projectileId } of attacks) {
      if (to.life.kind !== "alive") continue;
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const critical =
        from.crit >= Math.fround(Math.fround(random / 0x100000000) * 100);
      if (kind === "heal") {
        // A target filled during windup resolves with callback 0: no heal event.
        const healed = changeHealth(to, from.healing, "health", critical);
        if (healed.changed > 0)
          emit({
            kind: "heal",
            unit: to.id,
            target: position(to),
            amount: healed.changed,
          });
        notifyCurrentTarget(from);
        cleave(from, to, from.healing, critical, {
          burn: 0,
          poison: 0,
          frost: 0,
          stun: 0,
        });
        continue;
      }
      const statuses = {
        burn: from.burn,
        poison: from.poison,
        frost: from.frost,
        stun: from.stun,
      };
      if (projectileId !== null) {
        const source = position(from);
        troopProjectiles.push({
          id: projectileId,
          from,
          to,
          source,
          ...source,
          progress: 0,
          damage,
          critical,
          statuses,
        });
        emit({
          kind: "launch",
          from: from.id,
          to: to.id,
          projectileId,
          effect: visual(from),
          source,
          target: position(to),
        });
      } else {
        impact(from, to, -damage, critical, statuses, false, false);
        cleave(from, to, -damage, critical, statuses);
      }
    }
    const alivePolis = units.filter(
      (u) => u.side === "polis" && u.life.kind !== "dead",
    ).length;
    const aliveOpponent = units.filter(
      (u) => u.side === "opponent" && u.life.kind !== "dead",
    ).length;
    if (
      !alivePolis ||
      !aliveOpponent ||
      ticks === combatPolicies.maximumTicks
    ) {
      result = {
        winner:
          !alivePolis && !aliveOpponent
            ? "draw"
            : !aliveOpponent
              ? "polis"
              : !alivePolis
                ? "opponent"
                : "draw",
        ticks,
        survivors: [alivePolis, aliveOpponent],
        ...(killInsight ? { insight: killInsight } : {}),
      };
    }
  }
  return {
    advance,
    get ticks() {
      return ticks;
    },
    get units(): readonly Readonly<Unit>[] {
      return units;
    },
    get projectiles() {
      const held = units.flatMap((unit) =>
        unit.strike?.held &&
        unit.strike.projectileId !== null &&
        unit.target !== null
          ? [
              {
                kind: "held" as const,
                id: unit.strike.projectileId,
                from: unit.id,
                to: unit.target,
              },
            ]
          : [],
      );
      return [
        ...held,
        ...troopProjectiles.map((shot) => ({
          kind: "flight" as const,
          id: shot.id,
          from: shot.from.id,
          to: shot.to.id,
          source: { ...shot.source },
          position: position(shot),
          progress: shot.progress,
          heightPerDistance: projectileHeight(shot.from.sprite),
        })),
      ];
    },
    get events(): readonly CombatEvent[] {
      return events;
    },
    get result() {
      return result;
    },
  };
}
export function resolveBattle(input: Battle): Outcome {
  const simulation = createCombat(input);
  while (!simulation.result) simulation.advance();
  return simulation.result;
}
