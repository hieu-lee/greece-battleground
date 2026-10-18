import { z } from "zod";
import { transaction } from "./game.ts";
import { catalogTool } from "./play-catalog.ts";
import type { Tool } from "./webmcp.ts";
import type { createPlaySession } from "./play-session.ts";

// Native WebMCP tools for the play screen. Semantics are owned by the engine; the UI only supplies media/guide status.
export async function registerPlayTools(options: {
  game: Awaited<ReturnType<typeof createPlaySession>>;
  network: boolean;
  signal: AbortSignal;
  abort(): void;
  guide(): unknown;
  media(): unknown;
  /** The shared action dispatcher (src/action-dispatch.ts), also used by the human controls. */
  dispatch(input: unknown): Promise<unknown>;
}) {
  const { game, network } = options;
  const inspect = z
    .object({
      since: z.number().int().nonnegative().optional(),
      map: z.boolean().optional(),
      warband: z.boolean().optional(),
      media: z.boolean().optional(),
      guide: z.boolean().optional(),
    })
    .strict();
  const tools: Tool[] = [
    {
      name: "inspect_game",
      description:
        "Public state. Read once; since=r returns changes:[{r,delta}] or a full snapshot after reload/history expiry. Apply each delta with Object.assign(state,delta,{r}). balance=[Drachmas,Insight], placements=[tile,id,level,workers,charm,growth?], where only Farm/Offering Well have growth (Farm accrued Health base; Well count of normal round grants, absent/0 means none), shop=[id,cost], fate=3 nullable offer IDs; fateChosen marks a purchase, while an empty unchosen roll can be rerolled. map=true adds [tile,q,r,terrain,feature]; hidden tiles have null terrain/feature, so re-read after colonizing or restart. fog[tile] is unlocked|unlockable|hidden|out-of-bounds. warband=true adds [name,HP,Armor,Damage,AS,Crit,Burn,Ward,Regen] and an ordinary income forecast excluding Gather and delayed Memory/Stag drops. media=true adds replay/audio; guide=true adds the persisted source tutorial stage/chapter. Some source mechanics remain partial.",
      inputSchema: z.toJSONSchema(inspect),
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const args = inspect.parse(input);
        return {
          ...game.inspect(args.since),
          ...(args.guide ? { tutorial: options.guide() } : {}),
          ...(args.media ? { media: options.media() } : {}),
          ...(args.map
            ? {
                map: game.map.map((t) => [
                  t.id,
                  t.q,
                  t.r,
                  t.terrain,
                  t.feature,
                ]),
              }
            : {}),
          ...(args.warband ? game.own : {}),
          ...(network ? { connection: game.connection } : {}),
        };
      },
    },
    {
      name: "act",
      description:
        "Up to 16 atomic actions at revision=r. Success returns {r,changes:[{r,delta}]} or {r,state} after a newer server refresh: merge deltas or replace cached state. {r,error,message?}: rejected commands make no changes, but observed r may advance after server refresh; inspect since cached r when it differs. committed means saved but UI refresh failed. Practice/tutorial: recover committed/stale with inspect_game. Async: delivery uncertainty requires async_control retry of the persisted exact UUID; inspect alone is insufficient. Async reroll-shop/reroll-fate/ready/continue/upgrade/restart/give-up must end their batches; save preparation before ready, because waiting rolls back a preparation prefix. sell{tile}: preparation-only owned non-Hall structure; returns ceil(base rarity cost/2) times level and assigned workers beyond its initial workers; removes its Charm, not its territory. Athena’s Apprentices adds equal Insight. fate{slot,tile?}: Charms and spells need tile; one purchase spends the round. ready resolves battle and settles wins/lives and War Lessons Insight; continue acknowledges its result once without repaying it. In tutorial preparation, continue advances Welcome/Shop/Fate stages without requiring purchases; tutorial-close acknowledges a chapter only; tutorial-chapter{chapter} browses a chapter without advancing. Blocking or manually opened chapters must close before Ready/advance. Ending Continue keeps the same campaign and stage. upgrade chooses a season improvement; restart(clan) requires finished. give-up ends an unfinished campaign as defeat and settles online abandonment using committed results; cancel confirmed waiting first. Uses human rules/save owner.",
      inputSchema: z.toJSONSchema(transaction),
      annotations: { readOnlyHint: false },
      execute: (input) => options.dispatch(input),
    },
    // The engine's shared native catalogue (src/play-catalog.ts), as on the classic page.
    catalogTool,
  ];
  if (network) {
    const recovery = z.object({ op: z.enum(["retry", "cancel"]) }).strict();
    tools.push({
      name: "async_control",
      description:
        "Retry the exact saved request or refresh connection. cancel only cancels confirmed waiting; uncertain delivery must first be retried. Server serializes cancellation with receipt commitment. A {r,recovered:true} acknowledgment may advance r without deltas when polling already consumed the receipt; inspect_game({since:cached_r}) before further decisions.",
      inputSchema: z.toJSONSchema(recovery),
      annotations: { readOnlyHint: false },
      execute: (input) => game.recover(recovery.parse(input).op === "cancel"),
    });
  }
  if (document.modelContext) {
    try {
      for (const tool of tools)
        await document.modelContext.registerTool(tool, {
          signal: options.signal,
        });
    } catch {
      options.abort();
    }
  }
}
