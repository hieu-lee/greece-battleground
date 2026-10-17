import { z } from "zod";
import type { Tower } from "./combat.ts";

export const attackEffect = z.enum([
  "spear",
  "kopis",
  "arrow",
  "lightning",
  "fire",
]);
export type AttackEffect = z.infer<typeof attackEffect>;
export const effectId = z.enum([
  "spear",
  "kopis",
  "arrow",
  "lightning",
  "fire",
  "armor",
  "critical",
  "ward",
  "burn",
  "poison",
  "stun",
  "frost",
  "haste",
  "heal",
  "death",
  "footstep",
  "select",
  "purchase",
  "build",
  "upgrade",
  "reroll",
  "fate",
  "error",
  "victory",
  "defeat",
]);
export type EffectId = z.infer<typeof effectId>;
export const effects = {
  spear: { name: "Bronze spear", duration: 0.38, color: "#ffe6a1" },
  kopis: { name: "Kopis strike", duration: 0.38, color: "#ffe2a4" },
  arrow: { name: "Arrow flight", duration: 0.38, color: "#f3d5a5" },
  lightning: { name: "Zeus’s thunderbolt", duration: 1.4, color: "#a7e4ff" },
  fire: { name: "Drakon fire breath", duration: 1.4, color: "#ffb957" },
  armor: { name: "Armor contact", duration: 0.4, color: "#c0e0eb" },
  critical: { name: "Critical strike", duration: 0.55, color: "#ffdc6d" },
  ward: { name: "Divine ward", duration: 0.8, color: "#b1f1e5" },
  burn: { name: "Burn", duration: 0.8, color: "#ffa650" },
  poison: { name: "Poison", duration: 0.7, color: "#79e4bd" },
  stun: { name: "Stun", duration: 0.55, color: "#d6adff" },
  frost: { name: "Frost", duration: 0.7, color: "#99e0ff" },
  haste: { name: "Haste", duration: 0.65, color: "#ffc74d" },
  heal: { name: "Regeneration", duration: 0.9, color: "#a7f5b0" },
  death: { name: "Fallen warrior", duration: 0.8, color: "#c9c6b0" },
  footstep: { name: "Sandals on earth", duration: 0.15, color: "#c5b485" },
  select: { name: "Select", duration: 0.12, color: "#dac68d" },
  purchase: { name: "Drachma purchase", duration: 0.45, color: "#f8d678" },
  build: { name: "Build a structure", duration: 0.7, color: "#efdeaa" },
  upgrade: { name: "Upgrade", duration: 1.1, color: "#e9dc9b" },
  reroll: { name: "Refresh offers", duration: 0.35, color: "#b4cfcd" },
  fate: { name: "Choose a Fate", duration: 1.2, color: "#d2b3fb" },
  error: { name: "Action unavailable", duration: 0.25, color: "#d99889" },
  victory: { name: "Victory", duration: 3.2, color: "#f0d783" },
  defeat: { name: "Defeat", duration: 2.7, color: "#9aaeba" },
} satisfies Record<EffectId, { name: string; duration: number; color: string }>;

type Position = { x: number; y: number };
export type CombatSender =
  | { from: number; tower?: never; projectileId?: number }
  | {
      from: null;
      tower: {
        item: Tower["item"];
        side: Tower["side"];
        tile: Tower["origin"]["tile"];
      };
      projectileId: number;
    };
export type CombatEventPayload =
  | {
      kind: "launch";
      from: number;
      to: number;
      projectileId: number;
      effect: AttackEffect;
      source: Position;
      target: Position;
    }
  | (CombatSender & {
      kind: "attack";
      to: number;
      effect: AttackEffect;
      /** Unit attack announces Aim; launch identifies the separately released projectile. */
      projectile: boolean;
      source: Position;
      target: Position;
      windup: number;
    })
  | (CombatSender & {
      kind: "impact";
      reflection?: true;
      to: number;
      effect: AttackEffect;
      source: Position;
      target: Position;
      damage: number;
      armorDamage: number;
      critical: boolean;
      blocked: boolean;
      burnApplied: number;
    })
  | {
      kind: "burn" | "poison";
      unit: number;
      target: Position;
      amount: number;
      blocked: boolean;
    }
  | { kind: "heal"; unit: number; target: Position; amount: number }
  | { kind: "insight"; unit: number; target: Position; amount: number }
  | { kind: "stun"; unit: number; target: Position; amount: number }
  | { kind: "haste"; unit: number; target: Position; amount: number }
  | {
      kind: "frost";
      unit: number;
      target: Position;
      amount: number;
      frozen: boolean;
    }
  | { kind: "revive"; unit: number; target: Position; amount: number }
  | { kind: "death"; unit: number; target: Position }
  | { kind: "footstep"; unit: number; target: Position };

export type CombatEvent = CombatEventPayload & { id: number; tick: number };

export function eventSounds(event: CombatEvent): EffectId[] {
  switch (event.kind) {
    case "attack":
    case "launch":
      return [];
    case "impact": {
      if (event.blocked)
        return event.effect === "arrow" ? ["arrow", "ward"] : ["ward"];
      const sounds: EffectId[] = [event.effect];
      if (event.armorDamage > 0) sounds.push("armor");
      if (event.critical) sounds.push("critical");
      return sounds;
    }
    case "burn":
    case "poison":
      return event.blocked ? ["ward"] : [event.kind];
    case "heal":
    case "revive":
      return ["heal"];
    case "insight":
      return ["fate"];
    case "stun":
      return ["stun"];
    case "frost":
      return ["frost"];
    case "haste":
      return ["haste"];
    case "death":
      return ["death"];
    case "footstep":
      return ["footstep"];
  }
}

export function createEffectCursor() {
  let id = -1;
  return {
    take(events: readonly CombatEvent[]) {
      const fresh = events.filter((event) => event.id > id);
      if (fresh.length) id = fresh.at(-1)?.id ?? id;
      return fresh;
    },
    reset() {
      id = -1;
    },
  };
}
