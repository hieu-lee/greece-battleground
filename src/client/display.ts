// Shared display helpers: season labels and shader blends, and the rival chief's clan.
import { clans } from "../clans.ts";
import type { Season } from "../workshop.ts";
import type { PlayState } from "../read-model.ts";

export const seasonNames: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Autumn",
  winter: "Winter",
};

/** Target weights for the shared seasonal shader uniforms (uSnow / uAutumn / uSummer). */
export function seasonBlend(season: Season) {
  return {
    snow: season === "winter" ? 1 : 0,
    autumn: season === "autumn" ? 1 : 0,
    summer: season === "summer" ? 1 : 0,
  };
}

/** The rival chief's clan, from the frozen PvP settlement once its battle replay is loaded. */
export function rivalClan(state: PlayState) {
  if (state.phase.kind !== "result") return null;
  const layout = state.phase.encounter?.opponentLayout;
  return layout ? clans[layout.clan] : null;
}
