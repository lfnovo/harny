import { cleanRun } from "../harness/clean.js";
import { resolveAssistant } from "./context.js";
import type { RunnerContext } from "./context.js";

export async function handleClean(
  cmd: { kind: "clean"; slug: string; force?: boolean; kill?: boolean },
  ctx: RunnerContext,
): Promise<void> {
  const assistant = await resolveAssistant(ctx.assistantName);
  await cleanRun(assistant.cwd, cmd.slug, ctx.logMode === "verbose", {
    force: cmd.force ?? false,
    kill: cmd.kill ?? false,
  });
}
