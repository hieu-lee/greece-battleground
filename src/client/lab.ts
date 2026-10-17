import { createWorld } from "./world.ts";
import { createIsland } from "./island.ts";
import { createOverlay } from "./overlay.ts";
import { createBuildings } from "./buildings.ts";
import { seasonId, tiles } from "../workshop.ts";
import { world as shared } from "./shaders.ts";
import { createWeather } from "./weather.ts";
import { seasonBlend } from "./display.ts";
import { hexToWorld } from "./hex.ts";

// Development lab: ?season=winter&view=battle&models=polis-hall:4,spear-camp:3&zoom=9
const canvas = document.getElementById("world");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing canvas");
const params = new URL(location.href).searchParams;
const world = createWorld(canvas);
const island = createIsland(world);
const map = tiles(Number(params.get("seed") ?? 7));
const models = (params.get("models") ?? "").split(",").filter(Boolean);
// Lay out every requested level along the middle row, then the next rows.
const slots = [...map].sort((a, b) => a.r - b.r || a.q - b.q);
const placements = models.flatMap((spec) => {
  const [model, levels] = spec.split(":");
  return Array.from({ length: Number(levels ?? 1) }, (_, i) => ({
    model: model!,
    level: i + 1,
  }));
});
const used = placements
  .map((p, i) => ({ ...p, tile: slots[i]! }))
  .filter((p) => p.tile);
island.build({ polis: { tiles: map }, opponent: { tiles: tiles(99) } });
island.setOccupied(
  used.map((p) => ({ side: "polis" as const, q: p.tile.q, r: p.tile.r })),
);
const structures = createBuildings(world.scene, world.camera, () =>
  world.invalidateShadows(),
);
structures.set(
  "polis",
  used.map((p, i) => ({
    key: String(i),
    q: p.tile.q,
    r: p.tile.r,
    model: p.model,
    level: p.level,
  })),
);
world.onFrame(() => structures.tick());
const season = seasonId.catch("spring").parse(params.get("season"));
const blend = seasonBlend(season);
shared.uSnow.value = blend.snow;
shared.uAutumn.value = blend.autumn;
shared.uSummer.value = blend.summer;
createWeather(world).set(season);
const overlay = createOverlay(world.scene);
overlay.setTerritory(
  "polis",
  used.map((p) => p.tile),
);
if (params.get("view") === "battle") {
  world.flyTo({ x: 0, z: 0.5, distance: 34 }, true);
  world.clouds.clear.value.set(0, 0, 21, 9);
} else if (params.get("zoom")) {
  // Frame the requested models: centre on their tiles (the first slots are the island's top row).
  const centres = used.map((p) => hexToWorld(p.tile.q, p.tile.r));
  const mean = (pick: (c: { x: number; z: number }) => number) =>
    centres.length
      ? centres.reduce((n, c) => n + pick(c), 0) / centres.length
      : 0;
  world.flyTo(
    {
      x: centres.length ? mean((c) => c.x) : -10.4,
      z: centres.length ? mean((c) => c.z) : 0.3,
      distance: Number(params.get("zoom")),
    },
    true,
  );
}
