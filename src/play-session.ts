import { apiFetch } from "./api.ts";
import { crossOriginApi } from "./urls.ts";
import { accountToken } from "./api.ts";
import { z } from "zod";
import {
  gameSession,
  inspection,
  newGame,
  recreateGame,
  transaction,
} from "./game.ts";
import { selectedClan, clanId } from "./clans.ts";
import { freshRun, leaveRun, readRun, runKey } from "./run-storage.ts";
import { publicMap } from "./map.ts";
import { income, warband } from "./warband.ts";
import { resumeEntries } from "./item-entries.ts";
import {
  guestInput,
  publicGame,
  changesSchema,
  mapRows,
  armyRows,
  replaySchema,
  playState,
} from "./read-model.ts";
import type { PublicGame } from "./read-model.ts";

const guestSchema = z.object({ id: z.uuid(), name: z.string() }).strict();
const guestReply = z.object({ guest: guestSchema }).passthrough();
const outboxSchema = transaction
  .extend({
    requestId: z.uuid(),
    guest: z.uuid(),
    delivery: z.enum(["uncertain", "waiting"]),
    cancel: z.boolean(),
  })
  .strict();
const errorReply = z
  .object({
    r: z.number().int().nonnegative().optional(),
    error: z.string(),
    message: z.string().optional(),
  })
  .strict();
const extra = {
  map: mapRows.optional(),
  warband: armyRows.optional(),
  income: z.tuple([z.number(), z.number()]).optional(),
  queue: z.enum(["unranked", "ranked"]).optional(),
};
const stateReply = z.union([
  publicGame.extend(extra),
  changesSchema.extend(extra),
]);
type Outbox = z.infer<typeof outboxSchema>;
export async function guestRun(
  clan?: z.infer<typeof clanId>,
  name?: string,
  queue?: "unranked" | "ranked",
) {
  if (!navigator.locks)
    throw new Error("This browser needs Web Locks for safe async play.");
  return navigator.locks.request("greece.async.identity", async () => {
    if (crossOriginApi && !accountToken())
      throw new Error("Sign in from Account on the main menu to play online.");
    let reply = await apiFetch("/api/guest", { credentials: "same-origin" });
    if (reply.status === 401 && accountToken())
      throw new Error(
        "Your account session expired. Sign in again from Account on the main menu.",
      );
    if (reply.status === 401 && !crossOriginApi && clan && name)
      reply = await apiFetch("/api/guest", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...guestInput.parse({ clan, name }),
          ...(queue ? { queue } : {}),
        }),
      });
    if (!reply.ok)
      throw new Error(
        reply.status === 401
          ? "Choose a clan to create your guest polis."
          : "Async service is unavailable. Try again.",
      );
    return guestReply.parse(await reply.json()).guest;
  });
}

export async function createPlaySession(options: {
  network: boolean;
  tutorial: boolean;
  signal: AbortSignal;
}) {
  options.signal.throwIfAborted();
  let changed = () => {};
  let replay: z.infer<typeof replaySchema> | null = null;
  let state: PublicGame;
  let grid: z.infer<typeof mapRows> = [];
  let army: z.infer<typeof armyRows> = [];
  let earned: [number, number] = [0, 0];
  let queue: "unranked" | "ranked" = "unranked";
  const journal: z.infer<typeof changesSchema>["changes"] = [];
  let problem = "";
  let operations = 0;
  let pending: Outbox | null = null;
  const guest = options.network ? await guestRun() : null;
  const outboxKey = guest ? "greece-battleground.async.outbox." + guest.id : "";
  const lockName = guest ? "greece.async.guest." + guest.id : "";
  const key = runKey(options.tutorial ? "tutorial" : "practice");
  let savedBase: string | null = null;
  let local: ReturnType<typeof gameSession> | null = null;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let leftTutorial = false;
  function clearLocalTimer() {
    if (localTimer !== null) clearTimeout(localTimer);
    localTimer = null;
  }
  function scheduleLocal() {
    if (options.signal.aborted || !local?.pending || localTimer !== null)
      return;
    localTimer = setTimeout(() => {
      localTimer = null;
      try {
        local?.update(performance.now());
        scheduleLocal();
      } catch (error) {
        clearLocalTimer();
        problem =
          error instanceof Error ? error.message : "Income could not be saved.";
        changed();
      }
    }, 50);
  }
  function readPending() {
    const saved = localStorage.getItem(outboxKey);
    pending = saved ? outboxSchema.parse(JSON.parse(saved)) : null;
    if (pending && pending.guest !== guest?.id)
      throw new Error("This saved request belongs to another guest.");
    return pending;
  }
  function savePending(intent: Outbox | null) {
    if (intent) localStorage.setItem(outboxKey, JSON.stringify(intent));
    else localStorage.removeItem(outboxKey);
    pending = intent;
    changed();
  }
  async function request(path: string, body?: object) {
    options.signal.throwIfAborted();
    const abort = new AbortController();
    const stop = () => abort.abort();
    options.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, 10_000);
    try {
      const reply = await apiFetch(path, {
        credentials: "same-origin",
        signal: abort.signal,
        ...(body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const data: unknown = await reply.json();
      return { status: reply.status, data };
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", stop);
    }
  }
  function merge(reply: z.infer<typeof stateReply>) {
    if ("changes" in reply) {
      if (reply.r < state.r) return false;
      let next = state;
      for (const change of reply.changes) {
        if (change.r <= next.r) continue;
        if (change.r !== next.r + 1) return false;
        next = publicGame.parse({ ...next, ...change.delta, r: change.r });
        journal.push(change);
      }
      if (next.r !== reply.r) return false;
      state = next;
    } else {
      if (state && reply.r < state.r) return false;
      const {
        map: _map,
        warband: _army,
        income: _income,
        queue: _queue,
        ...snapshot
      } = reply;
      state = publicGame.parse(snapshot);
      journal.length = 0;
    }
    if (reply.map) grid = reply.map;
    if (reply.warband) army = reply.warband;
    if (reply.income) earned = reply.income;
    if (reply.queue) queue = reply.queue;
    if (journal.length > 32) journal.splice(0, journal.length - 32);
    return true;
  }
  async function sync(full = false) {
    const response = await request(
      "/api/game?map=1&own=1&guestId=" +
        guest?.id +
        (!full && state ? "&since=" + state.r : ""),
    );
    if (response.status !== 200)
      throw new Error(
        response.status === 401
          ? "Your guest session expired. Return to the menu; its old request stays with the old guest."
          : response.status === 409
            ? "Your browser guest identity changed. Return to the menu; the old request remains with its guest."
            : "Unable to refresh your polis. Retry connection.",
      );
    const parsed = stateReply.parse(response.data);
    if (!merge(parsed)) {
      if (full)
        throw new Error("Server returned an older polis. Retry connection.");
      await sync(true);
      return;
    }
    if (state.phase === "result" && replay?.battleId !== state.battleId) {
      try {
        const result = await request("/api/game/replay?guestId=" + guest?.id);
        if (result.status !== 200) throw new Error("Replay unavailable");
        const next = replaySchema.parse(result.data);
        if (next.battleId === state.battleId) replay = next;
        else throw new Error("Replay changed. Retry connection.");
      } catch {
        replay = null;
        problem =
          "Your result is saved. Replay could not load; retry connection to view it.";
      }
    } else if (state.phase !== "result") replay = null;
  }
  function localRead() {
    if (!local) throw new Error("Missing local run");
    const privateState = local.state;
    state = publicGame.parse(inspection(privateState));
    grid = mapRows.parse(publicMap(privateState.seed, privateState.owned));
    army = armyRows.parse(
      warband(privateState, "polis").map((u) => [
        u.name,
        u.health,
        u.armor,
        u.damage,
        u.speed,
        u.crit,
        u.burn,
        u.ward,
        u.regen,
      ]),
    );
    earned = income(privateState);
    if (privateState.phase.kind === "result") {
      if (replay?.battleId === privateState.phase.battleId)
        replay = { ...replay, r: privateState.revision };
      else
        replay = {
          r: privateState.revision,
          battleId: privateState.phase.battleId,
          rulesVersion: privateState.rulesVersion,
          encounter: privateState.phase.encounter,
          outcome: privateState.phase.outcome,
        };
    } else replay = null;
    scheduleLocal();
    changed();
  }
  if (guest) {
    readPending();
    await sync(true);
  } else {
    let initial = options.tutorial
      ? freshRun(selectedClan(), "tutorial")
      : newGame(42, selectedClan());
    const saved = readRun(options.tutorial ? "tutorial" : "practice");
    if (saved.issue) throw new Error(saved.issue);
    if (!saved.game && saved.archives.length)
      throw new Error(
        "Your previous-rules polis is preserved. Return to the menu to export it and choose a new run under the current rules.",
      );
    savedBase = saved.encoded;
    if (saved.game) initial = resumeEntries(recreateGame(saved.game));
    local = gameSession(
      initial,
      (next) => {
        if (localStorage.getItem(key) !== savedBase)
          throw new Error(
            "This polis changed in another tab. Reload before continuing.",
          );
        const encoded = JSON.stringify(next);
        localStorage.setItem(key, encoded);
        savedBase = encoded;
      },
      () => {
        if (local) localRead();
      },
      undefined,
      { now: performance.now() },
    );
    localRead();
    options.signal.addEventListener(
      "abort",
      () => {
        clearLocalTimer();
        if (!local) return;
        try {
          if (!leftTutorial) {
            local.pause(true, performance.now());
            local.saveAndExit();
          }
        } catch (error) {
          problem =
            error instanceof Error
              ? error.message
              : "Your exit could not be saved.";
        } finally {
          local.dispose();
        }
      },
      { once: true },
    );
  }
  function inspect(since?: number) {
    if (local) return local.inspect(since);
    if (since === state.r) return { r: state.r, changes: [] };
    if (
      since !== undefined &&
      since < state.r &&
      journal[0] &&
      since >= journal[0].r - 1
    )
      return { r: state.r, changes: journal.filter((c) => c.r > since) };
    return structuredClone(state);
  }
  async function send(intent: Outbox, acknowledge: () => void) {
    const identity = await request("/api/guest");
    if (
      identity.status !== 200 ||
      guestReply.parse(identity.data).guest.id !== intent.guest
    )
      throw new Error(
        "Guest identity changed. The old request is preserved and cannot be sent as a different guest.",
      );
    savePending({ ...intent, delivery: "uncertain" });
    const payload = {
      requestId: intent.requestId,
      guestId: intent.guest,
      revision: intent.revision,
      actions: intent.actions,
    };
    const reply = await request(
      intent.cancel ? "/api/game/cancel" : "/api/game/act",
      intent.cancel
        ? { requestId: intent.requestId, guestId: intent.guest }
        : payload,
    );
    if (reply.status === 202) {
      const waiting = errorReply.parse(reply.data);
      if (waiting.error !== "waiting")
        throw new Error("Unexpected waiting response");
      savePending({ ...intent, delivery: "waiting" });
      await sync();
      return {
        r: state.r,
        error: "waiting",
        message:
          "Waiting for another player's warband. Retry checks this same submitted request.",
      };
    }
    if (reply.status === 200) {
      const cancelled = z
        .object({
          cancelled: z.literal(true),
          r: z.number().int().nonnegative(),
        })
        .strict()
        .safeParse(reply.data);
      if (cancelled.success) {
        acknowledge();
        savePending(null);
        await sync();
        return { r: state.r, cancelled: true };
      }
      const receipt = changesSchema.parse(reply.data);
      acknowledge();
      if (!merge(receipt)) await sync(true);
      savePending(null);
      await sync();
      return receipt.r === state.r
        ? receipt
        : { r: state.r, state: structuredClone(state) };
    }
    if (reply.status === 401 || reply.status === 403)
      throw new Error(
        "Guest authorization changed. Your saved request remains with this guest; restore the connection before retrying.",
      );
    if ([400, 404, 409, 413, 415, 422].includes(reply.status)) {
      const rejected = errorReply.parse(reply.data);
      if (rejected.error === "guest-changed")
        throw new Error(
          "Guest identity changed. The old request remains preserved.",
        );
      // Definitive cancellation/rejection receipts cannot be executed later.
      savePending(null);
      await sync(true);
      return { ...rejected, r: state.r };
    }
    throw new Error(
      "Connection interrupted. Retry the saved request; it may already be committed.",
    );
  }
  async function locked(work: (acknowledge: () => void) => Promise<unknown>) {
    let acknowledged = false;
    operations++;
    try {
      changed();
      return await navigator.locks.request(
        lockName,
        { signal: options.signal },
        async () => {
          readPending();
          return work(() => {
            acknowledged = true;
          });
        },
      );
    } catch (error) {
      problem =
        error instanceof Error
          ? error.message
          : "Connection interrupted. Retry the saved request.";
      return {
        r: state.r,
        error: acknowledged
          ? "committed"
          : pending
            ? "uncertain"
            : "unavailable",
        message: problem,
      };
    } finally {
      operations--;
      try {
        changed();
      } catch (error) {
        problem =
          error instanceof Error
            ? error.message
            : "UI refresh failed. Your saved request can be recovered.";
      }
    }
  }
  async function act(input: unknown) {
    options.signal.throwIfAborted();
    if (leftTutorial) throw new Error("This tutorial run is closed");
    const parsed = transaction.safeParse(input);
    if (!parsed.success) return { r: state.r, error: "invalid" };
    const args = parsed.data;
    problem = "";
    if (local) {
      if (args.revision !== state.r) return { r: state.r, error: "stale" };
      let actionRevision: number | null = null;
      try {
        // Clock-only wallet changes between this validated intent and its action are local.
        local.update(performance.now());
        actionRevision = local.state.revision;
        return local.act({ ...args, revision: actionRevision });
      } catch (error) {
        return {
          r: state.r,
          error:
            actionRevision !== null && state.r > actionRevision
              ? "committed"
              : "rejected",
          message: error instanceof Error ? error.message : "Action failed",
        };
      }
    }
    const before = structuredClone({ state, grid, army, earned, queue });
    return locked(async (acknowledge) => {
      if (pending) {
        if (
          !pending.cancel &&
          pending.revision === args.revision &&
          JSON.stringify(pending.actions) === JSON.stringify(args.actions)
        )
          return send(pending, acknowledge);
        return {
          r: state.r,
          error: pending.delivery === "waiting" ? "waiting" : "uncertain",
          message: "Recover the saved request before another action.",
        };
      }
      if (args.revision !== before.state.r)
        return { r: state.r, error: "stale" };
      await sync();
      if (
        JSON.stringify({
          ...before,
          state: { ...before.state, r: state.r, balance: state.balance },
        }) !== JSON.stringify({ state, grid, army, earned, queue })
      )
        return { r: state.r, error: "stale" };
      if (!guest) throw new Error("Missing guest");
      const intent = {
        ...args,
        revision: state.r,
        requestId: crypto.randomUUID(),
        guest: guest.id,
        delivery: "uncertain" as const,
        cancel: false,
      };
      savePending(intent);
      return send(intent, acknowledge);
    });
  }
  async function recover(cancel = false) {
    if (!guest) return { r: state.r, error: "practice" };
    problem = "";
    return locked(async (acknowledge) => {
      if (pending) {
        if (cancel && pending.delivery !== "waiting")
          return {
            r: state.r,
            error: "uncertain",
            message: "Retry to confirm delivery before cancelling.",
          };
        return send(
          cancel ? { ...pending, cancel: true } : pending,
          acknowledge,
        );
      }
      await sync();
      return { r: state.r, recovered: true };
    });
  }
  if (guest) {
    const pollDelay = () => (document.hidden ? 4000 : 1000);
    const poll = async () => {
      if (options.signal.aborted) return;
      if (!document.hidden && operations === 0) await recover();
      if (!options.signal.aborted) timer = setTimeout(poll, pollDelay());
    };
    let timer = setTimeout(poll, pollDelay());
    options.signal.addEventListener("abort", () => clearTimeout(timer), {
      once: true,
    });
    addEventListener(
      "storage",
      (event) => {
        if (event.key === outboxKey) {
          try {
            readPending();
            changed();
          } catch {
            problem = "Saved recovery request could not be read.";
            changed();
          }
        }
      },
      { signal: options.signal },
    );
  }
  return {
    get state() {
      return playState(state, replay);
    },
    get map() {
      return grid.map(([id, q, r, terrain, feature]) => ({
        id,
        q,
        r,
        terrain,
        feature,
      }));
    },
    get own() {
      return { warband: structuredClone(army), income: [...earned] };
    },
    get connection() {
      return guest
        ? {
            guest: guest.name,
            queue,
            busy: operations > 0,
            pending: pending
              ? {
                  status: pending.cancel ? "cancelling" : pending.delivery,
                  revision: pending.revision,
                  recovery: "async_control(retry)",
                }
              : null,
            message: problem,
          }
        : null;
    },
    get message() {
      return problem;
    },
    inspect,
    async leaveTutorial() {
      const guide = local?.state.tutorial;
      if (
        leftTutorial ||
        !options.tutorial ||
        guest ||
        guide?.chapter?.origin !== "automatic" ||
        guide.chapter.id !== "ending"
      )
        throw new Error("No tutorial ending is active");
      leaveRun("tutorial", savedBase);
      leftTutorial = true;
      savedBase = null;
      clearLocalTimer();
      local?.dispose();
    },
    pause(paused: boolean) {
      if (!local || options.signal.aborted) return;
      local.pause(paused, performance.now());
      scheduleLocal();
    },
    act,
    recover,
    subscribe(fn: () => void) {
      changed = fn;
    },
  };
}
