import { listHistoricalRuns } from "../harness/state/v3/discovery.js";

export async function handleLs(
  cmd: { kind: "ls"; status?: string; cwd?: string; workflow?: string },
): Promise<void> {
  let runs = await listHistoricalRuns();
  if (cmd.status) runs = runs.filter((r) => r.status === cmd.status);
  if (cmd.cwd) runs = runs.filter((r) => r.cwd === cmd.cwd);
  if (cmd.workflow) runs = runs.filter((r) => r.workflow === cmd.workflow);
  if (runs.length === 0) { console.log("No runs found."); return; }
  const header = ["runId".padEnd(10), "workflow".padEnd(14), "status".padEnd(14), "started_at".padEnd(25), "branch"].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of runs) {
    console.log([
      r.id.slice(0, 8).padEnd(10),
      r.workflow.padEnd(14),
      r.status.padEnd(14),
      r.started_at.padEnd(25),
      r.branch,
    ].join(" | "));
  }
}
