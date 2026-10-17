import { appUrl } from "./urls.ts";
import { z } from "zod";
import { effectId } from "./effects.ts";
import type { Command } from "./game.ts";
import type { PlayState } from "./read-model.ts";
import type { CombatEvent, EffectId } from "./effects.ts";
import { createEffectCursor, eventSounds } from "./effects.ts";
import { fates } from "./rules.ts";
import { preferences, audioSettings } from "./preferences.ts";

export const soundId = z.enum([
  ...effectId.options,
  "music",
  "arrow-release",
  "death-female",
  "fate-gift",
  "fate-blessing",
  "fate-rune",
  "fate-open",
  "fate-reveal",
  "worker-assign",
  "colonize",
  "battle-start",
  "buy-spear-camp",
  "buy-silver-mine",
  "buy-brewery",
  "buy-apollo-fountain",
  "ambience-spring",
  "ambience-summer",
  "ambience-autumn",
  "ambience-winter",
]);
type SoundId = z.infer<typeof soundId>;
export const warmSoundIds = soundId.options.filter(
  (id) => id !== "music" && !id.startsWith("ambience-"),
);
export const audioCacheBytes = 128 * 1024 * 1024;
const clip = z.object({
  path: z.string().regex(/^\/audio\/[a-z0-9-]+\.ogg$/),
  gain: z.number().min(0).max(1),
});
const manifest = z.array(
  z.object({
    id: soundId,
    mode: z.enum(["buffer", "stream"]),
    gain: z.number().min(0).max(1),
    loop: z.boolean(),
    startDelay: z.number().min(0).max(10),
    variants: z.array(clip).min(1),
  }),
);
type Cue = z.infer<typeof manifest>[number];
const feedback = new Set<SoundId>([
  "select",
  "purchase",
  "build",
  "upgrade",
  "fate",
  "fate-gift",
  "fate-blessing",
  "fate-rune",
  "fate-open",
  "fate-reveal",
  "worker-assign",
  "colonize",
  "battle-start",
  "victory",
  "defeat",
  "error",
  "reroll",
  "buy-spear-camp",
  "buy-silver-mine",
  "buy-brewery",
  "buy-apollo-fountain",
]);

export function createAudio() {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let effects: GainNode | null = null;
  let music: GainNode | null = null;
  let loading: Promise<void> | null = null;
  let resuming: Promise<void> | null = null;
  let failure: string | null = null;
  let settings = preferences();
  let season: "spring" | "summer" | "autumn" | "winter" = "spring";
  const cues = new Map<SoundId, Cue>();
  const buffers = new Map<string, AudioBuffer>();
  const pendingBuffers = new Map<string, Promise<AudioBuffer>>();
  let warming: Promise<void> | null = null;
  const selected = new Map<SoundId, number>();
  const voices = new Map<AudioBufferSourceNode, SoundId>();
  const lastPlayed = new Map<SoundId, { at: number }>();
  const cursor = createEffectCursor();
  const controller = new AbortController();
  let ambient: {
    id: SoundId;
    element: HTMLAudioElement;
    source: MediaElementAudioSourceNode;
    gain: GainNode;
    cleanup: () => void;
  } | null = null;
  let generation = 0;
  let disposed = false;
  let activated = false;

  function configure(next = preferences()) {
    settings = next;
    if (!context || !master || !effects || !music) return;
    master.gain.setTargetAtTime(
      settings.muted ? 0 : settings.master,
      context.currentTime,
      0.02,
    );
    effects.gain.setTargetAtTime(settings.effects, context.currentTime, 0.02);
    music.gain.setTargetAtTime(settings.music, context.currentTime, 0.02);
    if (settings.muted || settings.master === 0) silence(true);
    else {
      if (settings.effects === 0) {
        silence();
        stopAmbient();
      }
      if (settings.music === 0) {
        for (const [voice, id] of voices)
          if (id === "music") {
            voice.stop();
            voices.delete(voice);
          }
      }
      background();
    }
  }
  function stopAmbient() {
    if (!ambient) return;
    ambient.cleanup();
    ambient.element.pause();
    ambient.element.removeAttribute("src");
    ambient.element.load();
    ambient.source.disconnect();
    ambient.gain.disconnect();
    ambient = null;
  }
  function silence(all = false) {
    generation++;
    for (const [voice, id] of voices)
      if (all || id !== "music") {
        voice.stop();
        voices.delete(voice);
      }
    if (all) stopAmbient();
  }
  function allowed(id: SoundId) {
    return (
      activated &&
      !disposed &&
      !document.hidden &&
      !settings.muted &&
      settings.master > 0 &&
      (id === "music" ? settings.music : settings.effects) > 0
    );
  }
  function enabled(id: SoundId) {
    return allowed(id) && context?.state === "running";
  }
  function loadLibrary() {
    if (!loading) {
      loading = (async () => {
        const response = await fetch(appUrl("/audio/manifest.json"), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Sound library unavailable");
        const entries = manifest.parse(await response.json());
        if (
          entries.length !== soundId.options.length ||
          new Set(entries.map((e) => e.id)).size !== soundId.options.length
        )
          throw new Error("Incomplete sound library");
        if (!disposed) for (const entry of entries) cues.set(entry.id, entry);
      })().catch((error: unknown) => {
        loading = null;
        throw error;
      });
    }
    return loading;
  }
  function unavailable(error: unknown) {
    if (!disposed)
      failure = error instanceof Error ? error.message : "Audio unavailable";
  }
  void loadLibrary().catch(unavailable);
  function prepareContext() {
    if (context) return context;
    const next = new AudioContext({ sampleRate: 48000 });
    try {
      const masterGain = next.createGain();
      const effectsGain = next.createGain();
      const musicGain = next.createGain();
      const limiter = next.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 8;
      limiter.ratio.value = 5;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      effectsGain.connect(masterGain);
      musicGain.connect(masterGain);
      masterGain.connect(limiter).connect(next.destination);
      context = next;
      master = masterGain;
      effects = effectsGain;
      music = musicGain;
      configure();
      return next;
    } catch (error) {
      void next.close();
      context = null;
      master = effects = music = null;
      throw error;
    }
  }
  try {
    prepareContext();
  } catch (error) {
    unavailable(error);
  }
  async function unlock() {
    if (disposed || !activated) return;
    try {
      const audioContext = prepareContext();
      if (audioContext.state !== "running") {
        resuming ??= audioContext.resume().finally(() => {
          resuming = null;
        });
        await resuming;
      }
      await loadLibrary();
      if (!warming) {
        const warm = new Set<SoundId>(warmSoundIds);
        const paths = [
          ...new Set(
            [...cues.values()]
              .filter(
                (cue) => cue.mode === "buffer" && !cue.loop && warm.has(cue.id),
              )
              .flatMap((cue) => cue.variants.map((variant) => variant.path)),
          ),
        ];
        let index = 0;
        const errors: unknown[] = [];
        warming = Promise.all(
          Array.from({ length: 4 }, async () => {
            while (!disposed && index < paths.length) {
              const path = paths[index++];
              if (path)
                await loadBuffer(path, audioContext).catch((error: unknown) => {
                  errors.push(error);
                });
            }
          }),
        )
          .then(() => {
            warming = null;
            if (errors.length) throw errors[0];
          })
          .catch((error: unknown) => {
            warming = null;
            throw error;
          });
      }
      await warming;
      failure = null;
    } catch (error) {
      if (!disposed)
        failure = error instanceof Error ? error.message : "Audio unavailable";
    }
  }
  function loadBuffer(path: string, audioContext: AudioContext) {
    const loaded = buffers.get(path);
    if (loaded) {
      buffers.delete(path);
      buffers.set(path, loaded);
      return Promise.resolve(loaded);
    }
    let pending = pendingBuffers.get(path);
    if (!pending) {
      pending = fetch(appUrl(path), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Sound unavailable: " + path);
          const buffer = await audioContext.decodeAudioData(
            await response.arrayBuffer(),
          );
          if (!disposed) {
            const bytes = buffer.length * buffer.numberOfChannels * 4;
            let used = [...buffers.values()].reduce(
              (sum, b) => sum + b.length * b.numberOfChannels * 4,
              0,
            );
            const active = new Set(
              [...voices.keys()].map((voice) => voice.buffer),
            );
            for (const [oldPath, old] of buffers) {
              if (used + bytes <= audioCacheBytes) break;
              if (active.has(old)) continue;
              used -= old.length * old.numberOfChannels * 4;
              buffers.delete(oldPath);
            }
            if (used + bytes <= audioCacheBytes) buffers.set(path, buffer);
          }
          return buffer;
        })
        .finally(() => {
          pendingBuffers.delete(path);
        });
      pendingBuffers.set(path, pending);
    }
    return pending;
  }
  function play(
    id: SoundId,
    pan = 0,
    variation = 0,
    delay = 0,
    signal?: AbortSignal,
  ) {
    const audioContext = context,
      bus = id === "music" ? music : effects;
    if (!audioContext || !bus || !allowed(id) || signal?.aborted) return false;
    const request = generation;
    const requestedAt = performance.now();
    const requestedTime = audioContext.currentTime;
    const begin = () => {
      const cue = cues.get(id);
      if (!cue || request !== generation || !enabled(id) || signal?.aborted)
        return false;
      if (cue.mode === "stream") {
        if (ambient?.id === id) return false;
        stopAmbient();
        const variant = cue.variants[0];
        if (!variant) return false;
        const element = new Audio();
        element.preload = "none";
        element.loop = cue.loop;
        element.src = appUrl(variant.path);
        const source = audioContext.createMediaElementSource(element);
        const gain = audioContext.createGain();
        gain.gain.value = cue.gain * variant.gain;
        source.connect(gain).connect(bus);
        const cancel = () => {
          if (ambient?.element === element) stopAmbient();
        };
        signal?.addEventListener("abort", cancel, { once: true });
        ambient = {
          id,
          element,
          source,
          gain,
          cleanup: () => signal?.removeEventListener("abort", cancel),
        };
        element.addEventListener(
          "error",
          () => {
            if (!disposed && ambient?.element === element) {
              failure = "Season ambience unavailable";
              stopAmbient();
            }
          },
          { signal: controller.signal },
        );
        void element.play().catch((error: unknown) => {
          if (!disposed && ambient?.element === element) {
            failure =
              error instanceof Error
                ? error.message
                : "Season ambience unavailable";
            stopAmbient();
          }
        });
        return true;
      }
      if (cue.loop && [...voices.values()].includes(id)) return false;
      const now = audioContext.currentTime;
      const interval =
        id === "footstep" ? 0.06 : id === "heal" || id === "burn" ? 0.2 : 0.025;
      if (now - (lastPlayed.get(id)?.at ?? -Infinity) < interval) return false;
      const played = { at: now };
      lastPlayed.set(id, played);
      const all = cue.variants.map((variant, index) => ({ variant, index }));
      const choose = () => {
        const previous = selected.get(id);
        const alternatives = all.filter(({ index }) => index !== previous);
        const available = alternatives.length ? alternatives : all;
        const warm = available.filter(({ variant }) =>
          buffers.has(variant.path),
        );
        const choice = warm.length ? warm : available;
        return choice[Math.floor(Math.random() * choice.length)];
      };
      const first = choose();
      if (!first) return false;
      let picked = first;
      const at = requestedTime + delay + cue.startDelay;
      const immediate = delay === 0 && cue.startDelay === 0;
      // Feedback must arrive within 100 ms; combat gets at most one render quantum.
      const grace = immediate
        ? feedback.has(id)
          ? 0.1
          : 128 / audioContext.sampleRate
        : 0;
      const deadline = requestedAt + (delay + cue.startDelay + grace) * 1000;
      let scopedSource: AudioBufferSourceNode | null = null;
      const cancel = () => {
        if (lastPlayed.get(id) === played) lastPlayed.delete(id);
        if (scopedSource) {
          scopedSource.stop();
          voices.delete(scopedSource);
        }
      };
      const cleanup = () => signal?.removeEventListener("abort", cancel);
      signal?.addEventListener("abort", cancel, { once: true });
      const start = (buffer: AudioBuffer) => {
        if (request !== generation || !enabled(id) || signal?.aborted) {
          cleanup();
          return;
        }
        if (
          !cue.loop &&
          (performance.now() > deadline ||
            audioContext.currentTime > at + grace)
        ) {
          cleanup();
          return;
        }
        if (cue.loop && [...voices.values()].includes(id)) {
          cleanup();
          return;
        }
        if (
          !cue.loop &&
          [...voices.values()].filter((v) => v !== "music").length >= 24
        ) {
          cleanup();
          return;
        }
        if (all.length > 1 && picked.index === selected.get(id)) {
          const next = choose();
          if (next) {
            picked = next;
            load();
          }
          return;
        }
        const source = audioContext.createBufferSource();
        scopedSource = source;
        source.buffer = buffer;
        source.loop = cue.loop;
        source.playbackRate.value = cue.loop
          ? 1
          : 1 + Math.max(-0.08, Math.min(0.08, variation));
        const level = audioContext.createGain();
        level.gain.value = cue.gain * picked.variant.gain;
        const position = audioContext.createStereoPanner();
        position.pan.value = Math.max(-0.75, Math.min(0.75, pan));
        source.connect(level).connect(position).connect(bus);
        voices.set(source, id);
        source.addEventListener(
          "ended",
          () => {
            cleanup();
            scopedSource = null;
            voices.delete(source);
            source.disconnect();
            level.disconnect();
            position.disconnect();
          },
          { once: true },
        );
        source.start(Math.max(at, audioContext.currentTime));
        selected.set(id, picked.index);
      };
      const load = () => {
        const variant = picked.variant;
        const loaded = buffers.get(variant.path);
        if (loaded) {
          buffers.delete(variant.path);
          buffers.set(variant.path, loaded);
          start(loaded);
        } else
          void loadBuffer(variant.path, audioContext)
            .then(start)
            .catch((error: unknown) => {
              cleanup();
              if (!disposed)
                failure =
                  error instanceof Error ? error.message : "Audio unavailable";
            });
      };
      load();
      return true;
    };
    if (audioContext.state === "running" && cues.has(id)) return begin();
    void Promise.all([loadLibrary(), resuming]).then(begin).catch(unavailable);
    return true;
  }
  function consume(
    events: readonly CombatEvent[],
    units: readonly { id: number; sprite: string }[] = [],
  ) {
    for (const event of cursor.take(events)) {
      const pan = event.target.x / 12;
      if (
        (event.kind === "launch" ||
          (event.kind === "attack" && event.from === null)) &&
        event.effect === "arrow"
      )
        play("arrow-release", event.source.x / 12);
      for (const sound of eventSounds(event)) {
        const id =
          sound === "death" &&
          event.kind === "death" &&
          units.find((u) => u.id === event.unit)?.sprite === "atalanta"
            ? "death-female"
            : sound;
        play(id, pan, sound === "footstep" ? ((event.id % 7) - 3) * 0.02 : 0);
      }
    }
  }
  function background() {
    if (context?.state !== "running" || cues.size === 0) return;
    play(`ambience-${season}`);
    play("music");
  }
  function setSeason(next: typeof season) {
    if (next === season) return;
    season = next;
    stopAmbient();
    background();
  }
  function reset() {
    silence();
    cursor.reset();
    lastPlayed.clear();
  }
  function dispose() {
    disposed = true;
    controller.abort();
    silence(true);
    void context?.close();
    buffers.clear();
    pendingBuffers.clear();
    cues.clear();
  }
  for (const type of ["pointerdown", "keydown"])
    document.addEventListener(
      type,
      (event) => {
        if (event.isTrusted) {
          activated = true;
          void unlock().then(background);
        }
      },
      { signal: controller.signal, capture: true },
    );
  for (const type of ["storage", "preferenceschange"])
    addEventListener(type, () => configure(), { signal: controller.signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) silence(true);
      else background();
    },
    { signal: controller.signal },
  );
  addEventListener(
    "pagehide",
    (event) => {
      silence(true);
      if (!event.persisted) dispose();
    },
    { signal: controller.signal },
  );
  addEventListener(
    "pageshow",
    () => {
      configure();
      background();
    },
    { signal: controller.signal },
  );
  return {
    play,
    consume,
    background,
    silence,
    reset,
    dispose,
    setSeason,
    restore: () => configure(),
    setLevels: (input: unknown) =>
      configure({ ...settings, ...audioSettings.parse(input) }),
    get status() {
      return {
        unlocked: activated && context?.state === "running",
        loaded: buffers.size,
        cachedBytes: [...buffers.values()].reduce(
          (sum, b) => sum + b.length * b.numberOfChannels * 4,
          0,
        ),
        cues: cues.size,
        voices: voices.size,
        streaming: ambient?.id ?? null,
        muted: settings.muted,
        failure,
        levels: [settings.master, settings.effects, settings.music],
      };
    },
  };
}

export function actionSound(op: Command["op"]): EffectId {
  switch (op) {
    case "buy":
      return "build";
    case "villager":
    case "sell":
      return "purchase";
    case "upgrade":
      return "upgrade";
    case "fate":
      return "fate";
    case "reroll-shop":
    case "reroll-fate":
      return "reroll";
    default:
      return "select";
  }
}
export function actionSounds(
  action: Command,
  before: Pick<PlayState, "shop" | "placements" | "fate">,
): SoundId[] {
  switch (action.op) {
    case "buy": {
      if (before.placements.some((p) => p.tile === action.tile))
        return ["upgrade"];
      const id = before.shop[action.slot]?.id;
      switch (id) {
        case "spear-camp":
          return ["build", "buy-spear-camp"];
        case "silver-mine":
          return ["build", "buy-silver-mine"];
        case "brewery":
          return ["build", "buy-brewery"];
        case "apollo-fountain":
          return ["build", "buy-apollo-fountain"];
        default:
          return ["build"];
      }
    }
    case "fate": {
      const id = before.fate[action.slot];
      // A Charm is attached as it is bought.
      return id
        ? [
            (
              {
                gift: "fate-gift",
                blessing: "fate-blessing",
                rune: "fate-rune",
                spell: "fate-reveal",
              } as const
            )[fates[id].kind],
          ]
        : [];
    }
    case "assign":
      return ["worker-assign"];
    case "colonize":
      return ["colonize"];
    case "ready":
      return [];
    case "continue":
      return [];
    default:
      return [actionSound(action.op)];
  }
}
