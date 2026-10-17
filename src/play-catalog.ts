import { z } from "zod";
import { clans } from "./clans.ts";
import { preparationCosts } from "./game.ts";
import { combatPolicies } from "./combat.ts";
import { rulesVersion } from "./rules-version.ts";
import {
  buildingId,
  buildings,
  describeEffect,
  fateId,
  fates,
  levelCaps,
  pendingParity,
} from "./rules.ts";
import {
  sourceEconomy,
  sourceItemCosts,
  sourceSeasonWeights,
} from "./source-numbers.ts";
import type { Tool } from "./webmcp.ts";

const lookup = z
  .object({
    ids: z
      .array(z.enum([...buildingId.options, ...fateId.options]))
      .min(1)
      .max(16)
      .optional(),
  })
  .strict();

export const catalogTool = {
  name: "catalog",
  description:
    "Batch up to 16 building/Fate IDs for semantic definitions (structures: rarity, price, clan, status exact/partial/hold, troop and count rule, workers, effects with readable text, and unknown[] pieces that are not applied; Fate: native, kind/sourceKind, Insight cost, unlock [patron, favor] collections, favor granted, holders (target tags), effects, triggers, status and unknown[]). No ids returns building summaries [id, name, available, rarity, price, status], Fate summaries [id, name, sourceKind, cost, status] for all 94 entries, the Fate economy policy (reroll ladder, one choice per roll, targeted Charms), shop season weights, costs, level caps, clan/chief skills and provisional rules. Charms are bought with {op:'fate',slot,tile} naming an owned item with matching holder tags and an actual stat or currency receiver; this includes the owned Circle of Stone for Knowledge Charms. Spells require an eligible structure. A new Charm replaces that item's previous one. clans[clan].skills[i] uses upgrade choice skill-i; all skills cap at levels.skill. Structures upgrade by duplicate buy; Hall/skills by seasonal upgrade. Cache definitions for the run; unavailable buildings cannot be purchased.",
  inputSchema: z.toJSONSchema(lookup),
  annotations: { readOnlyHint: true },
  execute: (input: unknown) => {
    const args = lookup.parse(input);
    if (args.ids)
      return Object.fromEntries(
        args.ids.map((id) => {
          const building = buildingId.safeParse(id);
          if (building.success) {
            const { sprite: _sprite, ...definition } = buildings[building.data];
            return [
              id,
              {
                ...definition,
                price:
                  building.data === "polis-hall"
                    ? null
                    : sourceItemCosts[building.data],
                effectText: definition.effects.map(describeEffect),
              },
            ];
          }
          const {
            art: _art,
            serialized: _serialized,
            ...definition
          } = fates[fateId.parse(id)];
          return [id, { ...definition, effectText: definition.text }];
        }),
      );
    return {
      buildings: buildingId.options.map((id) => [
        id,
        buildings[id].name,
        buildings[id].available,
        buildings[id].rarity,
        id === "polis-hall" ? null : sourceItemCosts[id],
        buildings[id].status,
      ]),
      shop: {
        slots: 4,
        attempts: 50,
        seasonWeights: sourceSeasonWeights,
        policy:
          "Each slot rolls the season's rarity weights, then a uniform entry of that rarity's serialized pile; previous unbought offers, offers already chosen this refill and held structures are rejected (each rejection uses one of 50 attempts; then the slot stays empty). Unity RNG and draw-pile shuffle order are UNKNOWN, so only nominal probabilities match the source.",
      },
      fate: fateId.options.map((id) => [
        id,
        fates[id].name,
        fates[id].sourceKind,
        fates[id].cost,
        fates[id].status,
      ]),
      fateEconomy: {
        offers: 3,
        rerollLadder: sourceEconomy.fateRerolls,
        policy:
          "Each new round draws 3 offers, independently with replacement, uniformly from the eligible pool: entries whose collection threshold is reached (patron favor 0/3/5/8; Generic gifts 0/5/10 by the highest single favor) and that are valid now (a Blessing once per run, a Charm needs a structure its holders match, a spell a structure below level 3, at most one Drachma gift on screen). Paid rerolls cost 1/2/4/8/16/32/64 Insight within a round and reset each round; an 8th paid reroll is rejected (provisional: unobserved). The card's tier cost (4/8/16/32 Insight, base price: discounts UNKNOWN) is paid on purchase; every entry of its favor list grants +1 favor (cap 100). A purchase spends the whole roll until the next round (inferred from 3/3 witnessed purchases). Charms and spells name their target in the same action; a new Charm replaces the structure's previous one (destroyed). Offer weights and slot distinctness are UNKNOWN.",
      },
      clans: Object.fromEntries(
        Object.entries(clans).map(([id, { name, chief, skills }]) => [
          id,
          {
            name,
            chief,
            skills: skills.map(({ icon: _icon, ...definition }) => definition),
          },
        ]),
      ),
      levels: levelCaps,
      sourceStatus: `${rulesVersion}: Hunter’s Cunning stacks temporary binary32 Add growth on living critical callbacks, including Ward-blocked hits; death cancels those grants. Other skill/content parity, attack simultaneity, revival integration, source callback/frame ordering and Unity RNG remain provisional.`,
      costs: preparationCosts,
      sale: {
        policy:
          "Preparation only: sell an owned non-Hall structure for ceil(base rarity cost/2) times level, independent of purchase discounts. Return current workers minus authored initial workers. Destroy its Charm; retain territory. Athena’s Apprentices grants matching Insight directly, not structure income.",
      },
      pendingParity,
      combatPolicies,
    };
  },
} satisfies Tool;
