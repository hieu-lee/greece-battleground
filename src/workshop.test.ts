import { test } from "node:test";
import assert from "node:assert/strict";
import { newLayout, parseLayout, session } from "./workshop.ts";

test("revision-checked batch placement is atomic and preserves occupied structures", () => {
  let saved: unknown;
  const game = session(
    newLayout(),
    (value) => {
      saved = value;
    },
    () => {},
  );
  const before = structuredClone(game.layout);
  assert.throws(
    () =>
      game.act({
        revision: 0,
        actions: [
          { op: "place", tile: 0, structure: "farm" },
          { op: "place", tile: 18, structure: "farm" },
        ],
      }),
    /occupied/,
  );
  assert.deepEqual(game.layout, before);
  assert.equal(saved, undefined);
  assert.deepEqual(
    game.act({
      revision: 0,
      actions: [{ op: "place", tile: 0, structure: "farm" }],
    }),
    { r: 1, changes: [{ op: "place", tile: 0, structure: "farm" }] },
  );
  assert.throws(
    () => game.act({ revision: 0, actions: [{ op: "remove", tile: 0 }] }),
    /Stale/,
  );
  assert.equal(game.layout.placements.length, 4);
  assert.deepEqual(parseLayout(saved), game.layout);
});

test("move/remove/delta and serialized resume preserve the edited layout", () => {
  const game = session(
    newLayout(),
    () => {},
    () => {},
  );
  game.act({
    revision: 0,
    actions: [
      { op: "move", from: 19, to: 20 },
      { op: "season", value: "winter" },
    ],
  });
  game.act({ revision: 1, actions: [{ op: "remove", tile: 11 }] });
  assert.equal(game.layout.season, "winter");
  assert.deepEqual(
    game.layout.placements.map((p) => [p.tile, p.structure]),
    [
      [18, "banner-hall"],
      [20, "farm"],
    ],
  );
  assert.deepEqual(game.inspect(1), {
    r: 2,
    changes: [{ revision: 2, actions: [{ op: "remove", tile: 11 }] }],
  });
  const resumed = session(
    parseLayout(JSON.parse(JSON.stringify(game.layout))),
    () => {},
    () => {},
  );
  assert.deepEqual(resumed.layout, game.layout);
});

test("boundary rejects malformed, duplicate and out-of-range saves or commands", () => {
  const game = session(
    newLayout(),
    () => {},
    () => {},
  );
  for (const input of [
    { revision: 0, actions: [] },
    { revision: 0, actions: [{ op: "place", tile: 37, structure: "farm" }] },
    { revision: 0, actions: [{ op: "season", value: "nonsense" }] },
  ])
    assert.throws(() => game.act(input));
  const layout = newLayout();
  assert.throws(
    () =>
      parseLayout({
        ...layout,
        placements: [...layout.placements, ...layout.placements],
      }),
    /Duplicate/,
  );
  assert.throws(() => parseLayout({ ...layout, version: 2 }));
  assert.equal(game.layout.placements.length, 3);
});

test("storage failure leaves the action revision and state unchanged", () => {
  const game = session(
    newLayout(),
    () => {
      throw new Error("Storage full");
    },
    () => {},
  );
  assert.throws(
    () =>
      game.act({ revision: 0, actions: [{ op: "season", value: "winter" }] }),
    /Storage full/,
  );
  assert.equal(game.layout.season, "spring");
  assert.deepEqual(game.inspect(0), { r: 0, changes: [] });
});

test("resuming preserves the revision and refuses commands from before reload", () => {
  const game = session(
    newLayout(),
    () => {},
    () => {},
  );
  game.act({ revision: 0, actions: [{ op: "season", value: "winter" }] });
  const resumed = session(
    parseLayout(JSON.parse(JSON.stringify(game.layout))),
    () => {},
    () => {},
  );
  assert.equal(resumed.inspect().r, 1);
  assert.throws(
    () => resumed.act({ revision: 0, actions: [{ op: "remove", tile: 18 }] }),
    /Stale/,
  );
  assert.deepEqual(resumed.inspect(1), { r: 1, changes: [] });
  assert.equal(resumed.layout.placements.length, 3);
});

test("expired deltas return a complete snapshot that includes all edits", () => {
  const game = session(
    newLayout(),
    () => {},
    () => {},
  );
  for (let i = 0; i < 33; i++)
    game.act({
      revision: i,
      actions: [{ op: "season", value: i % 2 ? "autumn" : "winter" }],
    });
  const snapshot = game.inspect(0);
  assert.equal(snapshot.r, 33);
  assert.equal(snapshot.mode, "layout-workshop");
  assert.equal(snapshot.season, "winter");
  assert.equal(snapshot.tiles?.length, 37);
  assert.deepEqual(snapshot.placed, [
    [18, "banner-hall"],
    [11, "warrior-camp"],
    [19, "farm"],
  ]);
  assert.deepEqual(game.inspect(33), { r: 33, changes: [] });
});
