const standard = ["idle", "walk", "attack", "hit", "death"] as const;
export type TroopPose = (typeof standard)[number] | "revive";
const champion: readonly TroopPose[] = [...standard, "revive"];

export function requiredTroopPoses(sprite: string): readonly TroopPose[] {
  return sprite === "elysian-champion" ? champion : standard;
}
