import type { Battle } from "./combat.ts";
import type { Game } from "./game.ts";
import { grid, start } from "./map.ts";
import { pveBoards } from "./pve-data.ts";
import { hornActivations, towerActivations, warband } from "./warband.ts";

function origin(cell: readonly [number, number, number]) {
  const tile = grid.find((t) => t.q === 0 - cell[2] && t.r === 0 - cell[1]);
  if (!tile) throw new Error("PvE source cell is outside the board");
  return tile;
}

export function pveMatch(game: Game): Battle {
  const round = game.round;
  if (round !== 1 && round !== 5 && round !== 9 && round !== 13)
    throw new Error("No PvE encounter is scheduled on this round");
  const board = pveBoards[round];
  return {
    seed: (game.seed + round * 131) >>> 0,
    kind: "pve",
    opponent: board.opponent,
    opponentLayout: null,
    towers: towerActivations(game, "polis"),
    fighters: [
      ...warband(game, "polis"),
      ...board.producers.flatMap(({ cell, count, ...stats }) => {
        const tile = origin(cell);
        // Use the existing port formation; source world transforms/NavMesh remain provisional.
        return Array.from({ length: count }, (_, index) => ({
          ...stats,
          side: "opponent" as const,
          origin: { side: "opponent" as const, tile: tile.id },
          x: 5.5 - (tile.q - start.q + (tile.r - start.r) / 2) * 0.5,
          y: (tile.r - start.r) * 0.85 + (index - (count - 1) / 2) * 0.35,
          damageStat: "attack" as const,
          piercing: false,
          criticalGrowth: 0,
        }));
      }),
    ],
    horns: [
      ...hornActivations(game, "polis"),
      ...board.horns.map((controller) => ({
        side: "opponent" as const,
        speed: controller.speed,
        duration: controller.duration,
        targets: controller.targets.map((cell) => origin(cell).id),
      })),
    ],
  };
}
