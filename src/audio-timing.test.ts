import assert from "node:assert/strict";
import { test } from "node:test";
import { createAudio, soundId } from "./audio.ts";
import { tileId } from "./map.ts";

// This controls the browser API clock/decodes. It is not evidence of browser playback.
test("warming excludes streams; expired or cancelled effects never become late voices", async () => {
  const original = new Map(
    [
      "document",
      "AudioContext",
      "Audio",
      "addEventListener",
      "fetch",
      "performance",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const random = Math.random;
  Math.random = () => 0;
  const held = new Map<string, () => void>();
  const started: { path: string; at: number; stopped: boolean }[] = [];
  const fetched: string[] = [];
  const positions: { value: number }[] = [];
  const failedWarmPaths = new Set(
    [
      "select",
      "select-alt",
      "fate-open",
      "fate-open-alt",
      "fate-rune",
      "fate",
      "fate-gift",
      "fate-blessing",
      "fate-reveal",
      "fate-reveal-alt",
      "buy-brewery",
      "buy-apollo-fountain",
      "buy-silver-mine",
    ].map((id) => `/audio/${id}.ogg`),
  );
  let initialWarming = true;
  let delayed = "/audio/buy-spear-camp.ogg";
  let wall = 0;
  let manifestReady: (() => void) | undefined;
  let resumeReady: (() => void) | undefined;
  class Node extends EventTarget {
    connect(node: Node) {
      return node;
    }
    disconnect() {}
  }
  class Context {
    currentTime = 0;
    state = "suspended";
    sampleRate = 48000;
    destination = new Node();
    createGain() {
      return Object.assign(new Node(), {
        gain: { value: 1, setTargetAtTime() {} },
      });
    }
    createStereoPanner() {
      const pan = { value: 0 };
      positions.push(pan);
      return Object.assign(new Node(), { pan });
    }
    createDynamicsCompressor() {
      return Object.assign(
        new Node(),
        Object.fromEntries(
          ["threshold", "knee", "ratio", "attack", "release"].map((key) => [
            key,
            { value: 0 },
          ]),
        ),
      );
    }
    createBufferSource() {
      let voice: (typeof started)[number] | undefined;
      const node = Object.assign(new Node(), {
        buffer: { path: "", length: 100, numberOfChannels: 1 },
        loop: false,
        playbackRate: { value: 1 },
        start(at: number) {
          voice = { path: node.buffer.path, at, stopped: false };
          started.push(voice);
        },
        stop() {
          if (voice) voice.stopped = true;
          node.dispatchEvent(new Event("ended"));
        },
      });
      return node;
    }
    async decodeAudioData(bytes: ArrayBuffer) {
      const path = new TextDecoder().decode(bytes);
      if (path === delayed)
        await new Promise<void>((resolve) => held.set(path, resolve));
      return { path, length: 100, numberOfChannels: 1 };
    }
    async resume() {
      await new Promise<void>((resolve) => {
        resumeReady = resolve;
      });
      this.state = "running";
    }
    createMediaElementSource() {
      return new Node();
    }
    async close() {
      this.state = "closed";
    }
  }
  const context = new Context();
  const document = Object.assign(new EventTarget(), { hidden: false });
  const window = new EventTarget();
  const manifest = soundId.options.map((id) => ({
    id,
    mode: id.startsWith("ambience-") ? "stream" : "buffer",
    loop: id === "music" || id.startsWith("ambience-"),
    gain: 0.5,
    startDelay: 0,
    variants: [{ path: `/audio/${id}.ogg`, gain: 1 }],
  }));
  const select = manifest.find((cue) => cue.id === "select");
  select?.variants.push({ path: "/audio/select-alt.ogg", gain: 1 });
  const fateOpen = manifest.find((cue) => cue.id === "fate-open");
  fateOpen?.variants.push({ path: "/audio/fate-open-alt.ogg", gain: 1 });
  const fateReveal = manifest.find((cue) => cue.id === "fate-reveal");
  fateReveal?.variants.push({ path: "/audio/fate-reveal-alt.ogg", gain: 1 });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class {
      constructor() {
        return context;
      }
    },
  });
  Object.defineProperty(globalThis, "addEventListener", {
    configurable: true,
    value: window.addEventListener.bind(window),
  });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { now: () => wall },
  });
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: class extends EventTarget {
      preload = "";
      loop = false;
      src = "";
      async play() {}
      pause() {}
      removeAttribute() {}
      load() {}
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (path: string) => {
      fetched.push(path);
      if (path === "/audio/manifest.json")
        await new Promise<void>((resolve) => {
          manifestReady = resolve;
        });
      if (initialWarming && failedWarmPaths.has(path))
        return new Response("temporarily unavailable", { status: 503 });
      return new Response(
        path === "/audio/manifest.json" ? JSON.stringify(manifest) : path,
      );
    },
  });
  const audio = createAudio();
  try {
    assert.equal(audio.status.unlocked, false);
    assert.equal(audio.play("buy-spear-camp"), false);
    audio.setLevels({ music: 0 });
    document.dispatchEvent(new Event("keydown"));
    assert.equal(typeof resumeReady, "undefined");
    assert.deepEqual(fetched, ["/audio/manifest.json"]);
    const gesture = new Event("keydown");
    Object.defineProperty(gesture, "isTrusted", { value: true });
    document.dispatchEvent(gesture);
    assert.equal(audio.play("buy-spear-camp"), true);
    const beforeManifest = new AbortController();
    audio.play("select", 0, 0, 0, beforeManifest.signal);
    beforeManifest.abort();
    wall = 10;
    manifestReady?.();
    wall = 20;
    resumeReady?.();
    await new Promise((resolve) => setImmediate(resolve));
    wall = 50;
    context.currentTime = 0.05;
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      started,
      [{ path: "/audio/buy-spear-camp.ogg", at: 0.05, stopped: false }],
      "the first action waits for manifest/resume and starts before its 100 ms deadline",
    );
    initialWarming = false;
    assert.ok(audio.status.failure?.startsWith("Sound unavailable:"));
    assert.ok(fetched.includes("/audio/arrow-release.ogg"));
    assert.ok(fetched.includes("/audio/death-female.ogg"));
    assert.ok(
      fetched.includes("/audio/battle-start.ogg"),
      "failed clips do not stop warming later effects",
    );
    assert.equal(
      fetched.some((path) => path.includes("ambience-")),
      false,
    );
    assert.equal(fetched.includes("/audio/music.ogg"), false);
    assert.equal(
      started.length,
      1,
      "warming itself produces no additional sound",
    );
    audio.reset();

    audio.play("arrow-release", 0, 0, 0.375);
    assert.deepEqual(
      started.map((v) => [v.path, v.at]),
      [
        ["/audio/buy-spear-camp.ogg", 0.05],
        ["/audio/arrow-release.ogg", 0.425],
      ],
    );
    audio.reset();
    assert.equal(started[1]?.stopped, true);
    assert.equal(audio.status.voices, 0);

    Math.random = () => {
      context.currentTime += 0.001;
      wall += 1;
      return 0;
    };
    audio.play("spear");
    assert.equal(
      started.at(-1)?.path,
      "/audio/spear.ogg",
      "warm combat can start after a sub-quantum clock advance",
    );
    audio.reset();
    Math.random = () => {
      context.currentTime += 0.004;
      wall += 4;
      return 0;
    };
    audio.play("kopis");
    assert.equal(
      started.some((voice) => voice.path === "/audio/kopis.ogg"),
      false,
      "immediate combat cannot use the 100 ms UI feedback allowance",
    );
    Math.random = () => 0;

    delayed = "/audio/fate-open.ogg";
    audio.play("fate-open");
    await new Promise((resolve) => setImmediate(resolve));
    wall += 400;
    // A suspended audio clock cannot extend the real feedback deadline.
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.length,
      3,
      "a 400 ms cold decode cannot replay an expired UI event even if the audio clock stalls",
    );

    Math.random = () => 0.99;
    const openingScope = new AbortController();
    context.currentTime += 0.1;
    wall += 100;
    audio.play("fate-open", 0, 0, 0, openingScope.signal);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.at(-1)?.path,
      "/audio/fate-open.ogg",
      "a dropped request does not count as the last played variant",
    );
    context.currentTime += 0.1;
    wall += 100;
    delayed = "/audio/fate-open-alt.ogg";
    const beforeScopedOpen = started.length;
    audio.play("fate-open", 0, 0, 0, openingScope.signal);
    await new Promise((resolve) => setImmediate(resolve));
    openingScope.abort();
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.length,
      beforeScopedOpen,
      "aborting the scope drops a pending opening before its unchanged 100 ms deadline",
    );
    assert.ok(
      started
        .filter((voice) => voice.path === "/audio/fate-open.ogg")
        .every((voice) => voice.stopped),
      "aborting the scope also stops its active opening cue",
    );
    audio.play("fate-open");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.at(-1)?.path,
      "/audio/fate-open-alt.ogg",
      "a fresh immediate opening works without advancing variants for the cancelled request",
    );
    openingScope.abort();
    assert.equal(
      started.at(-1)?.stopped,
      false,
      "an old scope cannot cancel a fresh unscoped cue",
    );
    audio.reset();
    Math.random = () => 0;
    delayed = "/audio/select.ogg";
    const beforeOverlap = started.length;
    context.currentTime += 0.1;
    wall += 100;
    assert.equal(audio.play("select"), true);
    await new Promise((resolve) => setImmediate(resolve));
    context.currentTime += 0.03;
    wall += 30;
    assert.equal(audio.play("select"), true);
    await new Promise((resolve) => setImmediate(resolve));
    context.currentTime += 0.06;
    wall += 60;
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      started.slice(beforeOverlap).map((voice) => voice.path),
      ["/audio/select.ogg", "/audio/select-alt.ogg"],
      "two accepted cold requests retain both acknowledgements without repeating adjacent started variants",
    );
    const beforeCancelled = started.length;

    delayed = "/audio/fate-rune.ogg";
    audio.play("fate-rune", 0, 0, 1);
    await new Promise((resolve) => setImmediate(resolve));
    audio.reset();
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.length,
      beforeCancelled,
      "reset cancels a pending future effect even before its deadline",
    );

    delayed = "/audio/music.ogg";
    audio.setLevels({ music: 0.3 });
    audio.play("music");
    await new Promise((resolve) => setImmediate(resolve));
    wall += 2000;
    context.currentTime += 2;
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      started.at(-1),
      {
        path: "/audio/music.ogg",
        at: context.currentTime,
        stopped: false,
      },
      "loop music may begin after a cold decode",
    );

    delayed = "/audio/fate.ogg";
    context.currentTime += 0.1;
    wall += 100;
    audio.play("spear");
    audio.play("fate", 0, 0, 0.2);
    await new Promise((resolve) => setImmediate(resolve));
    audio.setLevels({ effects: 0 });
    assert.equal(
      started.some(
        (voice) => !voice.stopped && voice.path !== "/audio/music.ogg",
      ),
      false,
      "zero effects volume stops active SFX while leaving music running",
    );
    assert.ok(
      started.some(
        (voice) => !voice.stopped && voice.path === "/audio/music.ogg",
      ),
    );
    audio.setLevels({ effects: 0.8 });
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.some((voice) => voice.path === delayed),
      false,
      "restoring effects volume cannot revive a pending cue before its deadline",
    );

    const cancellations = [
      ["fate-gift", () => audio.reset()],
      ["fate-blessing", () => audio.silence()],
      [
        "buy-brewery",
        () => {
          document.hidden = true;
          document.dispatchEvent(new Event("visibilitychange"));
          document.hidden = false;
          document.dispatchEvent(new Event("visibilitychange"));
        },
      ],
      [
        "buy-apollo-fountain",
        () => {
          audio.setLevels({ muted: true });
          audio.setLevels({ muted: false });
        },
      ],
    ] satisfies [Parameters<typeof audio.play>[0], () => void][];
    for (const [id, cancel] of cancellations) {
      delayed = `/audio/${id}.ogg`;
      context.currentTime += 0.1;
      wall += 100;
      audio.play(id);
      await new Promise((resolve) => setImmediate(resolve));
      cancel();
      held.get(delayed)?.();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        started.some((voice) => voice.path === delayed),
        false,
        `${id} cannot start after cancellation even before its deadline`,
      );
    }

    Math.random = () => 0;
    delayed = "/audio/fate-reveal.ogg";
    audio.play("fate-reveal", 0, 0, 0.2);
    await new Promise((resolve) => setImmediate(resolve));
    wall += 210;
    context.currentTime += 0.21;
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.some((voice) => voice.path === delayed),
      false,
      "delayed effects receive no feedback grace after their scheduled deadline",
    );

    audio.play("purchase");
    audio.play("fate-blessing");
    audio.play("fate-reveal");
    const committedReveal = started.at(-1);
    assert.equal(committedReveal?.path, "/audio/fate-reveal.ogg");
    context.currentTime += 0.03;
    wall += 30;
    delayed = "/audio/fate-reveal-alt.ogg";
    const pendingRevealScope = new AbortController();
    audio.play("fate-reveal", 0, 0, 0.2, pendingRevealScope.signal);
    await new Promise((resolve) => setImmediate(resolve));
    context.currentTime += 0.03;
    wall += 30;
    const beforeRevealDelivery = started.length;
    audio.play("fate-reveal");
    pendingRevealScope.abort();
    assert.equal(
      audio.play("fate-reveal"),
      false,
      "aborting an old scope cannot clear the newer unscoped request's cooldown",
    );
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.length,
      beforeRevealDelivery + 1,
      "only the newer unscoped Reveal survives pending delivery before both original deadlines",
    );
    const newerCommittedReveal = started.at(-1);
    assert.equal(newerCommittedReveal?.path, "/audio/fate-reveal-alt.ogg");
    assert.equal(newerCommittedReveal?.stopped, false);
    assert.equal(
      committedReveal?.stopped,
      false,
      "cancelling a preview cannot stop an earlier committed cue sharing the same sound ID",
    );

    context.currentTime += 0.03;
    wall += 30;
    const scheduledRevealScope = new AbortController();
    audio.play("fate-reveal", 0, 0, 0.2, scheduledRevealScope.signal);
    const scheduledReveal = started.at(-1);
    assert.equal(scheduledReveal?.path, "/audio/fate-reveal.ogg");
    assert.equal(scheduledReveal?.at, context.currentTime + 0.2);
    scheduledRevealScope.abort();
    assert.equal(
      scheduledReveal?.stopped,
      true,
      "aborting a scope stops its already scheduled future source",
    );
    assert.equal(
      committedReveal?.stopped,
      false,
      "only the scoped source stops, even when an earlier committed voice uses the identical recording",
    );
    assert.equal(newerCommittedReveal?.stopped, false);
    for (const path of [
      "/audio/purchase.ogg",
      "/audio/fate-blessing.ogg",
      "/audio/music.ogg",
    ])
      assert.ok(
        started.some((voice) => voice.path === path && !voice.stopped),
        "preview cancellation preserves unrelated committed or music cue: " +
          path,
      );
    audio.play("fate-reveal");
    assert.equal(
      started.at(-1)?.path,
      "/audio/fate-reveal-alt.ogg",
      "a fresh same-ID acknowledgement can play immediately after preview cancellation",
    );
    scheduledRevealScope.abort();
    pendingRevealScope.abort();
    assert.equal(
      started.at(-1)?.stopped,
      false,
      "aborting old scopes again cannot stop a fresh committed acknowledgement",
    );
    assert.equal(
      audio.play("fate-reveal"),
      false,
      "aborting old scopes again cannot clear the fresh acknowledgement's cooldown",
    );

    audio.reset();
    const beforeDenseEffects = started.length;
    for (let index = 0; index < 26; index++) {
      context.currentTime += 0.03;
      wall += 30;
      audio.play("spear");
    }
    assert.equal(
      started.length - beforeDenseEffects,
      24,
      "dense effects admit only 24 active voices; original music does not use an effects slot",
    );
    assert.equal(audio.status.voices, 25);
    audio.reset();
    assert.equal(audio.status.voices, 1);

    const beforeAim = started.length;
    audio.consume([
      {
        id: 0,
        tick: 1,
        kind: "attack",
        from: 0,
        to: 1,
        effect: "arrow",
        projectile: true,
        source: { x: -6, y: 0 },
        target: { x: 6, y: 0 },
        windup: 0.375,
      },
    ]);
    assert.equal(started.length, beforeAim);
    audio.consume([
      {
        id: 1,
        tick: 9,
        kind: "launch",
        from: 0,
        to: 1,
        projectileId: 0,
        effect: "arrow",
        source: { x: -6, y: 0 },
        target: { x: 6, y: 0 },
      },
    ]);
    assert.equal(started.at(-1)?.path, "/audio/arrow-release.ogg");
    assert.equal(
      positions.at(-1)?.value,
      -0.5,
      "bow release belongs to the shooter",
    );
    audio.consume([
      {
        id: 2,
        tick: 14,
        kind: "impact",
        from: 0,
        to: 1,
        effect: "arrow",
        source: { x: -6, y: 0 },
        target: { x: 6, y: 0 },
        damage: 3,
        armorDamage: 0,
        critical: false,
        blocked: false,
        burnApplied: 0,
      },
    ]);
    assert.equal(started.at(-1)?.path, "/audio/arrow.ogg");
    assert.equal(
      positions.at(-1)?.value,
      0.5,
      "arrow impact belongs to the target",
    );
    audio.reset();

    context.currentTime += 1;
    wall += 1000;
    const launch = {
      kind: "attack" as const,
      id: 0,
      tick: 0,
      from: 0,
      to: 1,
      effect: "arrow" as const,
      projectile: true,
      source: { x: -2, y: 0 },
      target: { x: 2, y: 0 },
      windup: 0.75,
    };
    const beforeSecondAim = started.length;
    audio.consume([launch]);
    assert.equal(started.length, beforeSecondAim);
    audio.consume([
      {
        kind: "launch",
        id: 1,
        tick: 15,
        from: 0,
        to: 1,
        projectileId: 0,
        effect: "arrow",
        source: launch.source,
        target: launch.target,
      },
    ]);
    assert.equal(started.at(-1)?.path, "/audio/arrow-release.ogg");
    assert.equal(started.at(-1)?.at, context.currentTime);
    audio.reset();
    audio.consume([
      {
        ...launch,
        from: null,
        tower: {
          item: "defense-tower",
          side: "polis",
          tile: tileId.parse(37),
        },
        projectileId: 0,
      },
    ]);
    assert.equal(started.at(-1)?.path, "/audio/arrow-release.ogg");
    assert.equal(
      started.at(-1)?.at,
      context.currentTime,
      "A controller launch releases now; its travel estimate must not delay the release cue",
    );

    delayed = "/audio/music.ogg";
    assert.ok(started.some((voice) => voice.path === "/audio/music.ogg"));
    delayed = "/audio/buy-silver-mine.ogg";
    audio.play("buy-silver-mine");
    await new Promise((resolve) => setImmediate(resolve));
    audio.dispose();
    held.get(delayed)?.();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      started.some((voice) => voice.path === delayed),
      false,
    );
    assert.equal(audio.status.voices, 0);
  } finally {
    audio.dispose();
    Math.random = random;
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
