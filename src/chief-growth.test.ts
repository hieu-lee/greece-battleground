import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gameSession, newGame, parseGame, type Game } from "./game.ts";
import { warband } from "./warband.ts";

function finishIncome(game: ReturnType<typeof gameSession>) {
  for (let pass = 0; pass < 100 && game.state.phase.kind === "income"; pass++)
    game.update(game.runtime.clock.last + 500);
}

for (const [clan, expected] of [
  [
    "stag",
    [
      [240, 10, 40, 0],
      [290, 15, 50, 0],
      [340, 20, 60, 0],
    ],
  ],
  [
    "raven",
    [
      [200, 8, 0, 15],
      [250, 13, 0, 18],
      [300, 18, 0, 21],
    ],
  ],
] as const) {
  test(`${clan} chief grows once per claimed battle after a persisted reload`, () => {
    const directory = mkdtempSync(
      join(homedir(), ".cache/task-tmp/greece-chief-growth-"),
    );
    const save = join(directory, "game.json");
    const persist = (game: Game) => writeFileSync(save, JSON.stringify(game));
    const reload = () =>
      gameSession(
        parseGame(JSON.parse(readFileSync(save, "utf8"))),
        persist,
        () => {},
      );
    try {
      persist(newGame(42, clan));
      let game = reload();
      for (const [claimed, stats] of expected.entries()) {
        const chief = warband(game.state, "polis")[0];
        assert.ok(chief);
        assert.deepEqual(
          [chief.health, chief.damage, chief.armor, chief.crit],
          stats,
        );
        assert.equal(game.state.chiefBattles, claimed);
        assert.deepEqual(
          [chief.speed, chief.movement],
          [Math.fround(clan === "stag" ? 0.65 : 0.9), 3.5],
        );
        if (claimed === 2) break;
        game.act({ revision: game.state.revision, actions: [{ op: "ready" }] });
        assert.equal(game.state.chiefBattles, claimed);
        game = reload();
        assert.equal(game.state.phase.kind, "result");
        assert.equal(game.state.chiefBattles, claimed);
        game.act({
          revision: game.state.revision,
          actions: [{ op: "continue" }],
        });
        assert.equal(game.state.chiefBattles, claimed + 1);
        const saved = readFileSync(save, "utf8");
        assert.throws(
          () =>
            game.act({
              revision: game.state.revision,
              actions: [{ op: "continue" }],
            }),
          /No battle result to continue/,
        );
        assert.equal(readFileSync(save, "utf8"), saved);
        finishIncome(game);
        game = reload();
      }
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
}
