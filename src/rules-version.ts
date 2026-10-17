export const rulesVersion = "greece-118-v31";
export const saveVersion = 31;
export const sourceRoundLimit = 20;
export const sourceCalendar = {
  pveRounds: [1, 5, 9, 13],
  maxRoundExclusive: sourceRoundLimit,
  pveAvailable: true,
} as const;

export function seasonForRound(round: number) {
  return round >= 13
    ? "winter"
    : round >= 9
      ? "autumn"
      : round >= 5
        ? "summer"
        : "spring";
}

export function sourceEncounterKind(round: number) {
  return sourceCalendar.pveRounds.some((scheduled) => scheduled === round)
    ? "pve"
    : "pvp";
}
