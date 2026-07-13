import { readdir } from "node:fs/promises";
import { listPointers, patchPointer, type RunPointer } from "./registry.js";
import { RunStore } from "./runStore.js";
import type { RunSnapshot } from "./runSchema.js";
import { RunWorkflowPersistence } from "../workflow/persistence.js";
import { materializeHumanExpiry } from "../workflow/runtime.js";

async function load(pointer: RunPointer): Promise<RunSnapshot | null> {
  const store = new RunStore(pointer.cwd, pointer.task_slug);
  let run = await store.load();
  const pending = run?.execution.pendingHuman;
  const expiredFallback = pending?.fallback && Date.now() >= Date.parse(pending.expiresAt);
  if (run?.execution.status === "paused" && !expiredFallback) {
    const execution = await materializeHumanExpiry(new RunWorkflowPersistence(store));
    if (execution?.status === "failed") { const ended = new Date().toISOString(); run = await store.mutate((value) => { value.run.ended_at = ended; value.run.ended_reason = "human input expired"; value.workspace.reserved = false; }, { type: "run.human_expired" }); await patchPointer(run.run.id, { status: "failed", ended_at: ended }); }
  }
  return run;
}
export async function listRuns(): Promise<RunSnapshot[]> { const runs = (await Promise.all((await listPointers()).map(load))).filter((run): run is RunSnapshot => Boolean(run)); return runs.sort((a, b) => b.run.started_at.localeCompare(a.run.started_at)); }
export async function findRun(idOrSlug: string): Promise<RunSnapshot | null> { for (const pointer of await listPointers()) if (pointer.run_id === idOrSlug || pointer.run_id.startsWith(idOrSlug) || pointer.task_slug === idOrSlug) { const run = await load(pointer); if (run) return run; } return null; }
export async function listRunsInCwd(cwd: string): Promise<RunSnapshot[]> { const root = `${cwd}/.harny`; let entries; try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; } const runs: RunSnapshot[] = []; for (const entry of entries) { if (!entry.isDirectory() || entry.name === "worktrees" || entry.name === "leases") continue; const run = await new RunStore(cwd, entry.name).load().catch(() => null); if (run) runs.push(run); } return runs; }
