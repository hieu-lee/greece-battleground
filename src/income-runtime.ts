export type IncomeClock = {
  last: number;
  elapsed: number;
  paused: boolean;
};

export function createIncomeClock(nowMs: number): IncomeClock {
  return { last: nowMs, elapsed: 0, paused: false };
}

export function advanceIncomeClock(clock: IncomeClock, nowMs: number) {
  if (!clock.paused) clock.elapsed += Math.max(0, nowMs - clock.last);
  clock.last = Math.max(clock.last, nowMs);
  return Math.fround(clock.elapsed / 1000);
}

export type DelayedTask<T> = {
  value: T;
  start: number;
  delay: number;
};

export type DropQueue<T> = {
  active: DelayedTask<T>[];
  deferred: DelayedTask<T>[];
  running: boolean;
};

export function createDropQueue<T>(): DropQueue<T> {
  return { active: [], deferred: [], running: false };
}

export function queueTask<T>(queue: DropQueue<T>, task: DelayedTask<T>) {
  (queue.running ? queue.deferred : queue.active).push({
    value: task.value,
    start: Math.fround(task.start),
    delay: Math.fround(task.delay),
  });
}

export function assignDropDelays<T>(
  operands: readonly { value: T; amount: number }[],
  range: () => number,
) {
  const assigned: { value: T; delay: number }[] = [];
  let delay = 0;
  for (const operand of operands) {
    if (operand.amount === 0) continue;
    assigned.push({ value: operand.value, delay });
    delay = Math.fround(delay + Math.fround(range()));
  }
  return assigned;
}

export function runDropPass<T>(
  queue: DropQueue<T>,
  nowSeconds: number,
  onDue: (value: T) => void,
) {
  const now = Math.fround(nowSeconds);
  queue.running = true;
  try {
    let index = 0;
    while (true) {
      const task = queue.active[index];
      if (!task) break;
      if (Math.fround(now - task.start) >= task.delay) {
        onDue(task.value);
        const tail = queue.active.pop();
        // Run the tail in the emptied slot before visiting the next index.
        if (tail && index < queue.active.length) queue.active[index] = tail;
      } else index++;
    }
  } finally {
    queue.running = false;
    queue.active.push(...queue.deferred);
    queue.deferred.length = 0;
  }
}
