import { z } from "zod";
import { actionSchema, definitions, structureId } from "./workshop.ts";
import type { session } from "./workshop.ts";

export type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: unknown) => unknown;
};
declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: Tool,
        options: { signal: AbortSignal },
      ) => Promise<void>;
    };
  }
}

export async function register(
  game: ReturnType<typeof session>,
  signal: AbortSignal,
) {
  const context = document.modelContext;
  if (!context) return false;
  const inspect = z
    .object({ since: z.number().int().nonnegative().optional() })
    .strict();
  const act = z
    .object({
      revision: z.number().int().nonnegative(),
      actions: z.array(actionSchema).min(1).max(16),
    })
    .strict();
  const catalog = z.object({ id: structureId.optional() }).strict();
  const tools: Tool[] = [
    {
      name: "inspect_game",
      description:
        "Compact workshop state. Tile rows [id,q,r,terrain]; placements [tile,structure]. since=r returns only changes. No combat or economy in this development workshop.",
      inputSchema: z.toJSONSchema(inspect),
      annotations: { readOnlyHint: true },
      execute: (input) => game.inspect(inspect.parse(input).since),
    },
    {
      name: "act",
      description:
        "Atomically apply up to16 place/move/remove/season workshop actions at the inspected revision. Returns only r and changes. Stale revisions reject without mutation.",
      inputSchema: z.toJSONSchema(act),
      annotations: { readOnlyHint: false },
      execute: (input) => game.act(input),
    },
    {
      name: "catalog",
      description:
        "Structure IDs/names; request id for one definition. These workshop entries do not claim complete source-game rules.",
      inputSchema: z.toJSONSchema(catalog),
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const { id } = catalog.parse(input);
        return id
          ? { id, ...definitions[id] }
          : Object.entries(definitions).map(([key, def]) => [key, def.name]);
      },
    },
  ];
  for (const tool of tools) await context.registerTool(tool, { signal });
  return true;
}
