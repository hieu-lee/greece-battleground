import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceIncomeClock,
  assignDropDelays,
  createDropQueue,
  createIncomeClock,
  queueTask,
  runDropPass,
} from "./income-runtime.ts";

test("drop assignment skips zero operands and draws after every retained operand, including the last", () => {
  const samples = [0.1, 0.2, 0.49];
  let draws = 0;
  const assigned = assignDropDelays(
    [
      { value: "first coins", amount: 2 },
      { value: "zero lore", amount: 0 },
      { value: "signed lore", amount: -1 },
      { value: "last coins", amount: 1 },
    ],
    () => {
      const sample = samples[draws++];
      assert.notEqual(sample, undefined, "unexpected extra stagger draw");
      return sample ?? 0;
    },
  );
  assert.equal(draws, 3);
  assert.deepEqual(assigned, [
    { value: "first coins", delay: 0 },
    { value: "signed lore", delay: 0.10000000149011612 },
    { value: "last coins", delay: 0.30000001192092896 },
  ]);
  assert.deepEqual(
    assignDropDelays([{ value: "zero", amount: 0 }], () => {
      assert.fail("zero operands cannot consume a stagger draw");
    }),
    [],
  );
});

test("zero delay is deferred to an Update pass and a completed task never pays twice", () => {
  const queue = createDropQueue<string>();
  const paid: string[] = [];
  queueTask(queue, { value: "zero", start: 0, delay: 0 });
  assert.deepEqual<string[]>(paid, []);
  runDropPass(queue, 0, (value) => paid.push(value));
  runDropPass(queue, 0, (value) => paid.push(value));
  assert.deepEqual(paid, ["zero"]);
});

test("due checks round Time.time, captured start and elapsed subtraction to binary32", () => {
  const queue = createDropQueue<string>();
  const paid: string[] = [];
  queueTask(queue, {
    value: "rounded start",
    start: 16_777_217,
    delay: 0.5,
  });
  runDropPass(queue, 16_777_217, (value) => paid.push(value));
  assert.deepEqual<string[]>(paid, []);
  runDropPass(queue, 16_777_218, (value) => paid.push(value));
  assert.deepEqual(paid, ["rounded start"]);

  queueTask(queue, { value: "rounded subtraction", start: 1, delay: 33_554_432 });
  runDropPass(queue, 33_554_432, (value) => paid.push(value));
  assert.deepEqual(paid, ["rounded start", "rounded subtraction"]);

  queueTask(queue, { value: "rounded delay", start: 0, delay: 0.100000001 });
  runDropPass(queue, 0.1, (value) => paid.push(value));
  assert.deepEqual(paid, [
    "rounded start",
    "rounded subtraction",
    "rounded delay",
  ]);
});

test("the runner evaluates the tail into a completed head's hole instead of keeping insertion order", () => {
  const queue = createDropQueue<string>();
  const paid: string[] = [];
  for (const value of ["A", "B", "C"])
    queueTask(queue, { value, start: 0, delay: 0 });
  runDropPass(queue, 0, (value) => paid.push(value));
  assert.deepEqual(paid, ["A", "C", "B"]);

  for (const [value, delay] of [
    ["first due", 0],
    ["middle pending", 5],
    ["middle due", 0],
    ["tail due", 0],
    ["tail pending", 5],
  ] satisfies [string, number][])
    queueTask(queue, { value, start: 0, delay });
  paid.length = 0;
  runDropPass(queue, 0, (value) => paid.push(value));
  assert.deepEqual(paid, ["first due", "middle due", "tail due"]);
  runDropPass(queue, 5, (value) => paid.push(value));
  assert.deepEqual(paid, [
    "first due",
    "middle due",
    "tail due",
    "tail pending",
    "middle pending",
  ]);
});

test("income continuations add to the deferred list until the current runner pass finishes", () => {
  const queue = createDropQueue<string>();
  const paid: string[] = [];
  queueTask(queue, { value: "ordinary wait", start: 0, delay: 0.5 });
  runDropPass(queue, 0.5, (value) => {
    paid.push(value);
    queueTask(queue, { value: "new drop", start: 0.5, delay: 0 });
    queueTask(queue, { value: "next ordinary wait", start: 0.5, delay: 0.5 });
  });
  assert.deepEqual(paid, ["ordinary wait"]);
  runDropPass(queue, 0.5, (value) => paid.push(value));
  assert.deepEqual(paid, ["ordinary wait", "new drop"]);
  runDropPass(queue, 1, (value) => paid.push(value));
  assert.deepEqual(paid, [
    "ordinary wait",
    "new drop",
    "next ordinary wait",
  ]);
});

test("pause freezes scaled time while Update can complete already due tasks without catch-up", () => {
  const clock = createIncomeClock(1_000);
  const queue = createDropQueue<string>();
  const paid: string[] = [];
  queueTask(queue, { value: "already due", start: 0, delay: 0 });
  queueTask(queue, { value: "half second", start: 0, delay: 0.5 });
  clock.paused = true;
  runDropPass(queue, advanceIncomeClock(clock, 5_000), (value) => paid.push(value));
  runDropPass(queue, advanceIncomeClock(clock, 5_500), (value) => paid.push(value));
  assert.deepEqual(paid, ["already due"]);
  clock.paused = false;
  runDropPass(queue, advanceIncomeClock(clock, 5_750), (value) => paid.push(value));
  assert.deepEqual(paid, ["already due"]);
  runDropPass(queue, advanceIncomeClock(clock, 6_000), (value) => paid.push(value));
  assert.deepEqual(paid, ["already due", "half second"]);
  assert.equal(clock.elapsed, 500);
});

test("trusted milliseconds accumulate before the public scaled-time read is rounded", () => {
  const clock = createIncomeClock(0);
  for (let now = 1; now < 100; now++) advanceIncomeClock(clock, now);
  assert.equal(advanceIncomeClock(clock, 100), 0.10000000149011612);
  assert.equal(clock.last, 100);
  assert.equal(clock.elapsed, 100);
});

test("data-only live runtime clones advance independently for atomic command previews", () => {
  const original = {
    clock: createIncomeClock(10_000),
    queue: createDropQueue<{ currency: string; amount: number }>(),
  };
  queueTask(original.queue, {
    value: { currency: "insight", amount: 2 },
    start: 0,
    delay: 0.5,
  });
  const preview = structuredClone(original);
  let previewWallet = 0;
  runDropPass(
    preview.queue,
    advanceIncomeClock(preview.clock, 10_500),
    ({ amount }) => (previewWallet += amount),
  );
  assert.equal(previewWallet, 2);
  assert.equal(original.clock.elapsed, 0);
  let committedWallet = 0;
  runDropPass(original.queue, 0, ({ amount }) => (committedWallet += amount));
  assert.equal(committedWallet, 0);
  runDropPass(
    original.queue,
    advanceIncomeClock(original.clock, 10_500),
    ({ amount }) => (committedWallet += amount),
  );
  assert.equal(committedWallet, 2);
});
