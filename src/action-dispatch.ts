import { transaction } from "./game.ts";
import { actionSounds } from "./audio.ts";
import type { createAudio } from "./audio.ts";
import type { createPlaySession } from "./play-session.ts";

export function createActionDispatch(
  game: Pick<Awaited<ReturnType<typeof createPlaySession>>, "state" | "act">,
  audio: Pick<ReturnType<typeof createAudio>, "play">,
) {
  let acknowledged = game.state.revision;
  return async (input: unknown) => {
    const before = game.state;
    const request = transaction.safeParse(input);
    const first = request.success ? request.data.actions[0] : undefined;
    const sounds =
      first && request.success && request.data.revision === before.revision
        ? actionSounds(first, before)
        : [];
    const reply = await game.act(input);
    if (
      reply &&
      typeof reply === "object" &&
      "r" in reply &&
      typeof reply.r === "number" &&
      reply.r > before.revision &&
      reply.r > acknowledged &&
      (!("error" in reply) || reply.error === "committed")
    ) {
      acknowledged = reply.r;
      for (const sound of sounds) audio.play(sound);
    }
    return reply;
  };
}
