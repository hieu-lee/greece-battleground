import type { Battle, Fighter, Tower } from "./combat.ts";
import { grid, start } from "./map.ts";
import { tutorialBoards } from "./tutorial-opponents-data.ts";

function origin(cell: readonly [number, number, number]) {
  const tile = grid.find(
    (candidate) => candidate.q === -cell[2] && candidate.r === -cell[1],
  );
  if (!tile) throw new Error("Tutorial source cell is outside the board");
  return tile;
}
function position(tile: ReturnType<typeof origin>) {
  // Existing port formation; native Transform/NavMesh geometry remains provisional.
  return {
    x: 5.5 - (tile.q - start.q + (tile.r - start.r) / 2) * 0.5,
    y: (tile.r - start.r) * 0.85,
  };
}

export function tutorialOpponent(
  round: number,
): Pick<Battle, "opponent" | "fighters" | "horns" | "towers"> {
  const board = tutorialBoards.find((candidate) => candidate.round === round);
  if (!board)
    throw new Error("No authored tutorial opponent exists on this round");
  const fighters: Fighter[] = board.producers.flatMap(
    ({ cell, count, ...stats }) => {
      const tile = origin(cell);
      const centre = position(tile);
      return Array.from({ length: count }, (_, index) => ({
        ...stats,
        attackStat: { ...stats.attackStat },
        armorStat: { ...stats.armorStat },
        speedStat: { ...stats.speedStat },
        side: "opponent",
        origin: { side: "opponent", tile: tile.id },
        x: centre.x,
        y: centre.y + (index - (count - 1) / 2) * 0.35,
        damageStat: "attack",
        criticalGrowth: 0,
      }));
    },
  );
  const horns: NonNullable<Battle["horns"]> = board.horns.map((controller) => ({
    side: "opponent",
    speed: controller.speed,
    duration: controller.duration,
    targets: controller.targets.map((cell) => origin(cell).id),
  }));
  const towers: Tower[] = board.towers.map(({ cell, ...stats }) => {
    const tile = origin(cell);
    return {
      ...stats,
      side: "opponent",
      origin: { side: "opponent", tile: tile.id },
      ...position(tile),
    };
  });
  return { opponent: board.opponent, fighters, horns, towers };
}
