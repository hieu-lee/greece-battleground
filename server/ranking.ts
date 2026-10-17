// Source ranking arithmetic from the 0.77.118d / build 25904130 captures:
// handoffs/20261013-build118-ranking-source-next (RankingELO.GetNewPlayerRanking, collection thresholds)
// handoffs/20261013-build118-ranking-callers-next (GameOver XP award, placement-counter timing).
// Creation, live aggregate and resume contracts: evidence/ranking-contract-2026-10-16.
const f = Math.fround;

export const startingElo = 0;

export function sourceOpponentMean(opponents: readonly number[]) {
  if (!opponents.length) return 0;
  // At most19 Int32 reports: their Int64 sum is exact in JavaScript's integer range.
  const mean = f(
    opponents.reduce((sum, elo) => sum + elo, 0) / opponents.length,
  );
  return mean >= -2147483648 && mean < 2147483648
    ? Math.trunc(mean)
    : -2147483648;
}

// K uses the selected queue's placement counter before GameOver increments it.
export function kFactor(placements: number) {
  return placements < 5 ? 40 : placements < 20 ? 20 : 10;
}

// Single-precision steps, then ceil (more than five wins) or floor, then the zero clamp.
// `change` is the source LastELOChange, stored before the clamp.
export function rate(
  wins: number,
  player: number,
  opponent: number,
  placements: number,
) {
  const k = kFactor(placements);
  const d = f(wins > 5 ? f(player) - f(opponent) : f(opponent) - f(player));
  const p = f(1 / f(1 + f(10 ** f(d / 400))));
  const raw = f(f(f(wins - 4.5) * p) * k);
  const change = wins > 5 ? Math.ceil(raw) : Math.floor(raw);
  return { k, change, elo: Math.max(0, (player + change) | 0) };
}

export function xpAward(wins: number) {
  return wins >= 10 ? 5 : wins >= 8 ? 2 : wins >= 5 ? 1 : 0;
}

export const xpThresholds = [0, 10, 30, 90, 150, 300, 600, 1200] as const;

// GetRanking over ascending thresholds: the last band reached; the final band reports its own threshold.
export function xpRank(xp: number) {
  const index = Math.max(
    0,
    xpThresholds.findLastIndex((t) => xp >= t),
  );
  const floor = xpThresholds[index] ?? 0;
  return { band: index + 1, floor, next: xpThresholds[index + 1] ?? floor };
}
