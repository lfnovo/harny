import { listAllRuns } from "../harness/state/filesystem.js";
import type { RunnerContext } from "./context.js";

export async function handleLs(
  cmd: { kind: "ls"; status?: string; cwd?: string; workflow?: string },
  ctx: RunnerContext,
): Promise<void> {
  let runs = await listAllRuns(ctx.searchCwds);
  if (cmd.status) runs = runs.filter((r) => r.lifecycle.status === cmd.status);
  if (cmd.cwd) runs = runs.filter((r) => r.environment.cwd === cmd.cwd);
  if (cmd.workflow) runs = runs.filter((r) => r.origin.workflow === cmd.workflow);
  if (runs.length === 0) { console.log("No runs found."); return; }
  const header = ["runId".padEnd(10), "workflow".padEnd(14), "status".padEnd(14), "started_at".padEnd(25), "branch"].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of runs) {
    console.log([
      r.run_id.slice(0, 8).padEnd(10),
      r.origin.workflow.padEnd(14),
      r.lifecycle.status.padEnd(14),
      r.origin.started_at.padEnd(25),
      r.environment.branch,
    ].join(" | "));
  }
}
