import { cleanRun, pruneRegistry } from "../harness/clean.js";
import { resolveAssistant } from "./context.js";
import type { RunnerContext } from "./context.js";

export async function handleClean(
  cmd: { kind: "clean"; slug: string | null; force?: boolean; kill?: boolean; prune?: boolean },
  ctx: RunnerContext,
): Promise<void> {
  if (cmd.prune) {
    const removed = await pruneRegistry(ctx.logMode === "verbose");
    console.log(`[harny] pruned ${removed} unreachable pointer${removed === 1 ? "" : "s"}`);
    return;
  }
  if (!cmd.slug) {
    console.error("clean requires a slug or --prune");
    process.exit(1);
  }
  const assistant = await resolveAssistant(ctx.assistantName);
  await cleanRun(assistant.cwd, cmd.slug, ctx.logMode === "verbose", {
    force: cmd.force ?? false,
    kill: cmd.kill ?? false,
  });
}
