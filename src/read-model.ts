import { z } from "zod";
import { publicTutorial } from "./tutorial-domain.ts";
import { clanId } from "./clans.ts";
import {
  decodePlacement,
  featureRunes,
  placementRow,
} from "./encounter-layout.ts";
import { buildingId, level, blessingId, fateId, god } from "./rules.ts";
import { seasonId } from "./workshop.ts";
import { featureId, fogState, terrainId, tileCount, tileId } from "./map.ts";
import { outcome, battle } from "./combat.ts";
import {
  rulesVersion,
  sourceRoundLimit,
  sourceCalendar,
} from "./rules-version.ts";

export const guestInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[^\p{C}]+$/u),
    clan: clanId,
  })
  .strict();
const integer = z.number().int().nonnegative();
export const publicGame = z
  .object({
    r: integer,
    rulesVersion: z.literal(rulesVersion),
    calendar: z
      .object({
        pveRounds: z.tuple([
          z.literal(sourceCalendar.pveRounds[0]),
          z.literal(sourceCalendar.pveRounds[1]),
          z.literal(sourceCalendar.pveRounds[2]),
          z.literal(sourceCalendar.pveRounds[3]),
        ]),
        maxRoundExclusive: z.literal(sourceRoundLimit),
        pveAvailable: z.literal(sourceCalendar.pveAvailable),
      })
      .strict(),
    round: integer.min(1).max(sourceRoundLimit),
    season: seasonId,
    clan: clanId,
    mode: z.enum(["practice", "tutorial", "async"]),
    tutorial: publicTutorial.nullable(),
    phase: z.enum(["income", "prepare", "result", "season", "finished"]),
    battleId: integer.nullable(),
    skills: z.tuple([level, level, level]),
    battle: outcome
      .extend({
        opponent: z.string(),
        kind: z.enum(["training", "pvp", "pve"]),
      })
      .strict()
      .nullable(),
    outcome: z.enum(["victory", "defeat", "round-limit"]).nullable(),
    lives: integer.max(5),
    wins: integer.max(10),
    balance: z.tuple([
      z.number().int().min(-1_000_000).max(1_000_000),
      integer,
    ]),
    workers: integer.max(208),
    villagerPrice: integer,
    freeRerolls: integer.max(3),
    rerollCosts: z.tuple([integer.nullable(), integer.nullable()]),
    owned: z.array(tileId).min(1).max(tileCount),
    fog: z.array(fogState).length(tileCount),
    placements: z.array(placementRow),
    featureRunes,
    shop: z.array(z.tuple([buildingId, integer]).nullable()).length(4),
    fate: z.array(fateId.nullable()).length(3),
    fateChosen: z.boolean(),
    blessings: z.array(blessingId).max(100),
    favor: z.record(god, integer.max(100)),
  })
  .strict();
export const mapRows = z
  .array(
    z.tuple([
      tileId,
      z.number().int(),
      z.number().int(),
      terrainId.nullable(),
      featureId.nullable(),
    ]),
  )
  .length(tileCount);
export const armyRows = z.array(
  z.tuple([
    z.string(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ]),
);
export const replaySchema = z
  .object({
    r: integer,
    battleId: integer,
    rulesVersion: z.literal(rulesVersion),
    encounter: battle,
    outcome,
  })
  .strict();
export const changesSchema = z
  .object({
    r: integer,
    changes: z.array(
      z
        .object({ r: integer, delta: publicGame.omit({ r: true }).partial() })
        .strict(),
    ),
  })
  .strict();
export type PublicGame = z.infer<typeof publicGame>;
export type MapRows = z.infer<typeof mapRows>;
export function playState(
  state: PublicGame,
  replay: z.infer<typeof replaySchema> | null,
) {
  const phase =
    state.phase === "result"
      ? {
          kind: "result" as const,
          battleId: state.battleId,
          encounter:
            replay?.battleId === state.battleId ? replay.encounter : null,
        }
      : state.phase === "finished"
        ? { kind: "finished" as const, outcome: state.outcome }
        : { kind: state.phase };
  return {
    ...state,
    revision: state.r,
    drachmas: state.balance[0],
    insight: state.balance[1],
    phase,
    placements: state.placements.map(decodePlacement),
    shop: state.shop.map((item) =>
      item ? { id: item[0], price: item[1] } : null,
    ),
  };
}
export type PlayState = ReturnType<typeof playState>;
