import { listRuns } from "../harness/state/runDiscovery.js";

export async function handleLs(cmd: { kind: "ls"; status?: string; cwd?: string; workflow?: string }): Promise<void> {
  let runs = await listRuns();
  if (cmd.status) runs = runs.filter((run) => run.execution.status === cmd.status);
  if (cmd.cwd) runs = runs.filter((run) => run.workspace.primary_cwd === cmd.cwd);
  if (cmd.workflow) runs = runs.filter((run) => run.run.workflow === cmd.workflow);
  if (!runs.length) { console.log("No runs found."); return; }
  const header = ["runId".padEnd(10), "workflow".padEnd(14), "status".padEnd(14), "started_at".padEnd(25), "branch"].join(" | "); console.log(header); console.log("-".repeat(header.length));
  for (const run of runs) console.log([run.run.id.slice(0, 8).padEnd(10), run.run.workflow.padEnd(14), run.execution.status.padEnd(14), run.run.started_at.padEnd(25), run.workspace.branch].join(" | "));
}
