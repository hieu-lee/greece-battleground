import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { newGame, gameSession } from "./game.ts";
import { createPlaySession } from "./play-session.ts";
import { exportRunArchive, readRun, runKey, startRun } from "./run-storage.ts";

async function finishIncome(
  session: Awaited<ReturnType<typeof createPlaySession>>,
) {
  for (
    let pass = 0;
    pass < 200 && session.state.phase.kind === "income";
    pass++
  )
    await setTimeout(25);
}

test("previous preparation, tutorial and recorded outcomes remain byte-for-byte exportable while new runs use separate keys", async () => {
  const practice = "greece-battleground.preparation.v1";
  const practiceV2 = "greece-battleground.preparation.v2";
  const tutorialV2 = "greece-battleground.tutorial.v2";
  const practiceV3 = "greece-battleground.preparation.v3";
  const tutorialV3 = "greece-battleground.tutorial.v3";
  const practiceV4 = "greece-battleground.preparation.v4";
  const tutorialV4 = "greece-battleground.tutorial.v4";
  const practiceV5 = "greece-battleground.preparation.v5";
  const practiceV6 = "greece-battleground.preparation.v6";
  const practiceV20 = "greece-battleground.preparation.v20";
  const practiceV21 = "greece-battleground.preparation.v21";
  const practiceV27 = "greece-battleground.preparation.v27";
  const tutorialV27 = "greece-battleground.tutorial.v27";
  const practiceV28 = "greece-battleground.preparation.v28";
  const tutorialV28 = "greece-battleground.tutorial.v28";
  const priorV28 =
    ' \r\n{"version":28,"rulesVersion":"greece-118-v28","phase":{"kind":"result","outcome":{"insight":3}},"label":"Ω"}\t\n';
  const priorTutorialV28 =
    ' \r\n{"version":28,"rulesVersion":"greece-118-v28","mode":"tutorial","tutorial":{"stage":"fate"},"label":"π"}\t\n';
  const priorV27 =
    ' \r\n{"version":27,"rulesVersion":"greece-118-v27","phase":{"kind":"result","outcome":{"insight":3}},"label":"Ω"}\t\n';
  const priorTutorialV27 =
    ' \r\n{"version":27,"rulesVersion":"greece-118-v27","mode":"tutorial","tutorial":{"stage":"fate"},"label":"π"}\t\n';
  const practiceV26 = "greece-battleground.preparation.v26";
  const priorV26 =
    ' \r\n{"version":26,"rulesVersion":"greece-118-v26","phase":{"kind":"result","outcome":{"winner":"polis","ticks":912}},"label":"Ω •"}\t\n';
  const tutorialV26 = "greece-battleground.tutorial.v26";
  const priorTutorialV26 =
    ' \r\n{"version":26,"rulesVersion":"greece-118-v26","fate":["lost-wanderer","call-to-peace","padded-armor"],"label":"π"}\t\n';
  const practiceV25 = "greece-battleground.preparation.v25";
  const priorV25 =
    ' \r\n{"version":25,"rulesVersion":"greece-118-v25","featureRunes":[[23,"read-the-oracle"]],"phase":{"kind":"result"}}\t\n';
  const practiceV24 = "greece-battleground.preparation.v24";
  const priorV24 =
    ' \r\n{"version":24,"rulesVersion":"greece-118-v24","phase":{"kind":"result"},"itemEntries":{"slots":[6,null,23],"free":[1]}}\t\n';
  const practiceV23 = "greece-battleground.preparation.v23";
  const priorV23 =
    ' \r\n{"version":23,"rulesVersion":"greece-118-v23","phase":{"kind":"result"},"profiles":{"freeplayElo":17}}\t\n';
  const practiceV22 = "greece-battleground.preparation.v22";
  const priorV22 =
    ' \r\n{"version":22,"rulesVersion":"greece-118-v22","phase":{"kind":"result"},"towers":[]}\t\n';
  const priorV21 =
    ' \r\n{"version":21,"rulesVersion":"greece-118-v21","phase":{"kind":"result","encounter":{"kind":"pve"}}}\t\n';
  const priorV20 =
    ' \r\n{"version":20,"rulesVersion":"greece-118-v20","phase":{"kind":"result"},"horns":[]}\t\n';
  const priorV6 =
    '{"version":6,"rulesVersion":"greece-118-v7","runes":["well-fed"],"fate":["lost-wanderer","call-to-peace","burning-blades"]}\n';
  const priorV5 =
    '{"version":5,"rulesVersion":"greece-118-v5","shop":[{"id":"spear-camp","price":4}]}\n';
  const priorV4 =
    ' \r\n{"version":4,"rulesVersion":"greece-111-v4","name":"Ω •","fighters":[{"windupPercent":50}]}\t\r\n';
  const priorV3 =
    ' \r\n{"version":3,"rulesVersion":"greece-111-v3","recorded":{"winner":"polis","ticks":68,"fighters":[{"windup":0.375}]},"name":"Ω •"}\t\r\n';
  const priorV2 =
    ' \r\n{"version":2,"rulesVersion":"greece-111-v2","recorded":{"winner":"opponent","ticks":67}}\t\n';
  const tutorial = "greece-battleground.tutorial.v1";
  const old =
    JSON.stringify(
      {
        version: 1,
        paidShopRerolls: "unknown",
        phase: {
          kind: "result",
          outcome: { winner: "polis", ticks: 912 },
          encounter: { historical: true },
        },
        placements: [{ id: "archer-camp", rune: "flurry-of-blows" }],
      },
      null,
      2,
    ) + "\n";
  localStorage.clear();
  try {
    localStorage.setItem(practice, old);
    localStorage.setItem(practiceV2, priorV2);
    localStorage.setItem(practiceV3, priorV3);
    localStorage.setItem(practiceV4, priorV4);
    localStorage.setItem(practiceV5, priorV5);
    localStorage.setItem(practiceV6, priorV6);
    localStorage.setItem(practiceV20, priorV20);
    localStorage.setItem(practiceV21, priorV21);
    localStorage.setItem(practiceV27, priorV27);
    localStorage.setItem(tutorialV27, priorTutorialV27);
    localStorage.setItem(practiceV28, priorV28);
    localStorage.setItem(tutorialV28, priorTutorialV28);
    localStorage.setItem(practiceV26, priorV26);
    localStorage.setItem(tutorialV26, priorTutorialV26);
    localStorage.setItem(practiceV25, priorV25);
    localStorage.setItem(practiceV24, priorV24);
    localStorage.setItem(practiceV23, priorV23);
    localStorage.setItem(practiceV22, priorV22);
    localStorage.setItem(tutorialV4, "");
    localStorage.setItem(tutorialV2, "previous v2 tutorial bytes\n");
    localStorage.setItem(tutorialV3, "");
    localStorage.setItem("unrelated-account-token", "must never export");
    localStorage.setItem(tutorial, "previous tutorial bytes\n");
    assert.deepEqual(readRun("practice"), {
      encoded: null,
      game: null,
      archives: [
        { key: practiceV28, encoded: priorV28 },
        { key: practiceV27, encoded: priorV27 },
        { key: practiceV26, encoded: priorV26 },
        { key: practiceV25, encoded: priorV25 },
        { key: practiceV24, encoded: priorV24 },
        { key: practiceV23, encoded: priorV23 },
        { key: practiceV22, encoded: priorV22 },
        { key: practiceV21, encoded: priorV21 },
        { key: practiceV20, encoded: priorV20 },
        { key: practiceV6, encoded: priorV6 },
        { key: practiceV5, encoded: priorV5 },
        { key: practiceV4, encoded: priorV4 },
        { key: practiceV3, encoded: priorV3 },
        { key: practiceV2, encoded: priorV2 },
        { key: practice, encoded: old },
      ],
      issue: null,
    });
    assert.deepEqual(exportRunArchive("practice", practice), {
      filename: practice + ".json",
      type: "application/json",
      content: old,
    });
    await assert.rejects(
      createPlaySession({
        network: false,
        tutorial: false,
        signal: new AbortController().signal,
      }),
      /previous-rules polis is preserved/,
    );
    await assert.rejects(
      createPlaySession({
        network: false,
        tutorial: true,
        signal: new AbortController().signal,
      }),
      /previous-rules polis is preserved/,
    );
    assert.equal(localStorage.getItem(runKey("tutorial")), null);
    assert.equal(localStorage.getItem(runKey("practice")), null);
    const started = startRun("raven", "practice", null);
    assert.deepEqual(started, { path: "/play.html", r: 0 });
    assert.equal(readRun("practice").game?.version, 31);
    assert.equal(localStorage.getItem(practiceV28), priorV28);
    assert.equal(exportRunArchive("practice", practiceV28)?.content, priorV28);
    assert.equal(localStorage.getItem(tutorialV28), priorTutorialV28);
    assert.equal(
      exportRunArchive("tutorial", tutorialV28)?.content,
      priorTutorialV28,
    );
    assert.equal(localStorage.getItem(practiceV27), priorV27);
    assert.equal(exportRunArchive("practice", practiceV27)?.content, priorV27);
    assert.equal(localStorage.getItem(tutorialV27), priorTutorialV27);
    assert.equal(
      exportRunArchive("tutorial", tutorialV27)?.content,
      priorTutorialV27,
    );
    assert.equal(localStorage.getItem(practiceV26), priorV26);
    assert.equal(exportRunArchive("practice", practiceV26)?.content, priorV26);
    assert.equal(localStorage.getItem(tutorialV26), priorTutorialV26);
    assert.equal(
      exportRunArchive("tutorial", tutorialV26)?.content,
      priorTutorialV26,
    );
    assert.equal(localStorage.getItem(practiceV25), priorV25);
    assert.equal(exportRunArchive("practice", practiceV25)?.content, priorV25);
    assert.equal(localStorage.getItem(practiceV24), priorV24);
    assert.equal(exportRunArchive("practice", practiceV24)?.content, priorV24);
    assert.equal(localStorage.getItem(practiceV23), priorV23);
    assert.equal(exportRunArchive("practice", practiceV23)?.content, priorV23);
    assert.equal(localStorage.getItem(practiceV22), priorV22);
    assert.equal(exportRunArchive("practice", practiceV22)?.content, priorV22);
    assert.equal(localStorage.getItem(practiceV21), priorV21);
    assert.equal(exportRunArchive("practice", practiceV21)?.content, priorV21);
    assert.equal(exportRunArchive("practice", practiceV20)?.content, priorV20);
    assert.equal(exportRunArchive("practice", practiceV6)?.content, priorV6);
    assert.equal(exportRunArchive("practice", practiceV5)?.content, priorV5);
    assert.equal(localStorage.getItem(practiceV2), priorV2);
    assert.equal(exportRunArchive("practice", practiceV2)?.content, priorV2);
    assert.equal(exportRunArchive("practice", practiceV3)?.content, priorV3);
    assert.equal(exportRunArchive("tutorial", tutorialV3)?.content, "");
    assert.deepEqual(
      readRun("tutorial").archives.map((entry) => entry.key),
      [
        tutorialV28,
        tutorialV27,
        tutorialV26,
        tutorialV4,
        tutorialV3,
        tutorialV2,
        tutorial,
      ],
    );
    assert.equal(
      exportRunArchive("tutorial", tutorialV2)?.content,
      "previous v2 tutorial bytes\n",
    );
    for (const key of [
      runKey("practice"),
      tutorial,
      tutorialV2,
      tutorialV3,
      tutorialV4,
      tutorialV27,
      tutorialV28,
      tutorialV26,
      "unrelated-account-token",
      "previous",
      "incompatible",
    ])
      assert.equal(exportRunArchive("practice", key), null);
    assert.equal(readRun("practice").game?.clan, "raven");
    assert.equal(localStorage.getItem(practice), old);
    assert.deepEqual(startRun("stag", "tutorial", null), {
      path: "/play.html?tutorial=1",
      r: 0,
    });
    assert.equal(readRun("tutorial").game?.version, 31);
    const tutorialLifetime = new AbortController();
    try {
      const tutorialSession = await createPlaySession({
        network: false,
        tutorial: true,
        signal: tutorialLifetime.signal,
      });
      await tutorialSession.act({
        revision: tutorialSession.state.revision,
        actions: [{ op: "continue" }],
      });
      await finishIncome(tutorialSession);
      await tutorialSession.act({
        revision: tutorialSession.state.revision,
        actions: [{ op: "continue" }],
      });
      assert.deepEqual(readRun("tutorial").game?.fate, [
        "call-to-war",
        "ruins-of-delphi",
        null,
      ]);
    } finally {
      tutorialLifetime.abort();
    }
    assert.equal(localStorage.getItem(tutorialV26), priorTutorialV26);
    assert.equal(
      exportRunArchive("tutorial", tutorialV26)?.content,
      priorTutorialV26,
    );
    assert.equal(exportRunArchive("tutorial", tutorialV3)?.content, "");
    assert.equal(
      localStorage.getItem(tutorialV2),
      "previous v2 tutorial bytes\n",
    );
    assert.equal(localStorage.getItem(tutorial), "previous tutorial bytes\n");
    assert.equal(exportRunArchive("practice", practice)?.content, old);
    assert.equal(
      exportRunArchive("tutorial", tutorial)?.content,
      "previous tutorial bytes\n",
    );
    const saved = readRun("practice").encoded;
    assert.throws(() => startRun("stag", "practice", null), /changed/);
    assert.equal(readRun("practice").encoded, saved);
    const lifetime = new AbortController();
    const session = await createPlaySession({
      network: false,
      tutorial: false,
      signal: lifetime.signal,
    });
    assert.equal(session.state.rulesVersion, "greece-118-v31");
    lifetime.abort();
    const malformed = JSON.stringify({
      ...newGame(),
      paidFateRerolls: undefined,
    });
    localStorage.setItem(runKey("practice"), malformed);
    await assert.rejects(
      createPlaySession({
        network: false,
        tutorial: false,
        signal: new AbortController().signal,
      }),
      /bytes are preserved/,
    );
    assert.equal(
      exportRunArchive("practice", runKey("practice"))?.content,
      malformed,
    );
    assert.equal(exportRunArchive("practice", practice)?.content, old);
    assert.equal(exportRunArchive("practice", practiceV2)?.content, priorV2);
    assert.equal(exportRunArchive("practice", practiceV3)?.content, priorV3);
    assert.equal(exportRunArchive("tutorial", tutorialV3)?.content, "");
    assert.equal(exportRunArchive("practice", runKey("tutorial")), null);
    assert.equal(exportRunArchive("practice", "unrelated-account-token"), null);
    assert.equal(localStorage.getItem(practiceV2), priorV2);
    assert.equal(localStorage.getItem(practiceV3), priorV3);
    assert.equal(exportRunArchive("practice", practiceV4)?.content, priorV4);
    assert.equal(localStorage.getItem(practiceV4), priorV4);
    assert.equal(exportRunArchive("tutorial", tutorialV4)?.content, "");
    assert.equal(localStorage.getItem(tutorialV4), "");
    assert.equal(localStorage.getItem(runKey("practice")), malformed);
    assert.equal(localStorage.getItem(practice), old);
  } finally {
    localStorage.clear();
  }
});

test("resuming a current season decision grants its pending income once and preserves already credited v3 archive bytes", async () => {
  localStorage.clear();
  const previousKey = "greece-battleground.preparation.v3";
  const previous =
    ' \r\n{"version":3,"rulesVersion":"greece-111-v3","phase":{"kind":"season"},"alreadyCredited":[22,8],"label":"π"}\t\n';
  const lifetime = new AbortController();
  const secondLifetime = new AbortController();
  try {
    localStorage.setItem(previousKey, previous);
    const start = newGame(42, "raven");
    start.round = 4;
    const key = runKey("practice");
    const owner = gameSession(
      start,
      (next) => localStorage.setItem(key, JSON.stringify(next)),
      () => {},
    );
    owner.act({ revision: 0, actions: [{ op: "ready" }, { op: "continue" }] });
    const pending = localStorage.getItem(key);
    assert.equal(readRun("practice").game?.phase.kind, "season");
    assert.deepEqual(
      [readRun("practice").game?.drachmas, readRun("practice").game?.insight],
      [11, 4],
    );
    const restored = await createPlaySession({
      network: false,
      tutorial: false,
      signal: lifetime.signal,
    });
    assert.equal(
      localStorage.getItem(key),
      pending,
      "Loading the decision cannot grant income",
    );
    assert.equal(restored.state.rulesVersion, "greece-118-v31");
    await restored.act({
      revision: restored.state.revision,
      actions: [{ op: "upgrade", choice: "hall" }],
    });
    await finishIncome(restored);
    assert.equal(restored.state.phase.kind, "prepare");
    assert.deepEqual(
      [restored.state.drachmas, restored.state.insight],
      [24, 9],
    );
    const credited = localStorage.getItem(key);
    const rejected = await restored.act({
      revision: restored.state.revision,
      actions: [{ op: "upgrade", choice: "hall" }],
    });
    assert.ok(rejected && typeof rejected === "object" && "error" in rejected);
    assert.equal(localStorage.getItem(key), credited);
    const resumed = await createPlaySession({
      network: false,
      tutorial: false,
      signal: secondLifetime.signal,
    });
    assert.deepEqual([resumed.state.drachmas, resumed.state.insight], [24, 9]);
    assert.equal(localStorage.getItem(key), credited);
    assert.equal(localStorage.getItem(previousKey), previous);
    assert.equal(exportRunArchive("practice", previousKey)?.content, previous);
  } finally {
    lifetime.abort();
    secondLifetime.abort();
    localStorage.clear();
  }
});
