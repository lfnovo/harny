import { listAllRuns } from "../harness/state/filesystem.js";
import { isPidAlive } from "../harness/pid.js";
import { reconcileStaleRun } from "../harness/reconcile.js";

function displayStatus(status: string, pid: number): string {
  if (status === "running" && !isPidAlive(pid)) return "running (stale)";
  return status;
}

export async function handleLs(
  cmd: { kind: "ls"; status?: string; cwd?: string; workflow?: string },
): Promise<void> {
  let runs = await listAllRuns();
  // Persist terminal state for runs whose process died untrapped, before
  // filtering — so `--status running` no longer surfaces dead runs and
  // `--status failed` correctly includes them.
  runs = await Promise.all(runs.map(reconcileStaleRun));
  if (cmd.status) runs = runs.filter((r) => r.lifecycle.status === cmd.status);
  if (cmd.cwd) runs = runs.filter((r) => r.environment.cwd === cmd.cwd);
  if (cmd.workflow) runs = runs.filter((r) => r.origin.workflow === cmd.workflow);
  if (runs.length === 0) { console.log("No runs found."); return; }
  const header = ["runId".padEnd(10), "workflow".padEnd(14), "status".padEnd(20), "started_at".padEnd(25), "branch"].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of runs) {
    console.log([
      r.run_id.slice(0, 8).padEnd(10),
      r.origin.workflow.padEnd(14),
      displayStatus(r.lifecycle.status, r.lifecycle.pid).padEnd(20),
      r.origin.started_at.padEnd(25),
      r.environment.branch,
    ].join(" | "));
  }
}
