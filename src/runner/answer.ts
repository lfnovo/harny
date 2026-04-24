import { findRun } from "../harness/state/filesystem.js";
import type { RunnerContext } from "./context.js";

export async function handleAnswer(
  cmd: { kind: "answer"; runId: string },
  ctx: RunnerContext,
): Promise<void> {
  const run = await findRun(ctx.searchCwds, cmd.runId);
  if (!run) { console.error(`Run not found: ${cmd.runId}`); process.exit(1); }
  console.error(
    `harny answer is not yet supported — engine workflows cannot be resumed from a parked question.\n` +
      `To discard this run: harny clean ${run.origin.task_slug}`,
  );
  process.exit(1);
}
