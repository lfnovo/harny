import { listPointers, type RunPointer } from "../registry.js";
import { FilesystemStateStore } from "../filesystem.js";
import { FilesystemRunStoreV3 } from "./store.js";
import { normalizeV2Run, normalizeV3Run, type HistoricalRun } from "./reader.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { V3FeatureRunPersistence } from "../../workflow/persistence.js";
import { materializeHumanExpiry } from "../../workflow/runtime.js";
import { patchPointer } from "../registry.js";

async function load(pointer: RunPointer): Promise<HistoricalRun | null> {
  try {
    if (pointer.state_schema_version === 3) {
      const store = new FilesystemRunStoreV3(pointer.cwd, pointer.task_slug); let run = await store.load();
      if (run?.run.status === "paused" && run.pending_human && Date.now() >= Date.parse(run.pending_human.expires_at)) {
        const snapshot = await materializeHumanExpiry(new V3FeatureRunPersistence(store)); const now = new Date().toISOString();
        run = await store.mutate((state) => { state.pending_human = null; if (snapshot?.status === "running") { state.run.status = "paused"; state.run.pid = 0; state.run.ended_reason = "human input expired; fallback ready to resume"; } else { state.run.status = "failed"; state.run.ended_at = now; state.run.ended_reason = "human input expired"; state.workspace.reserved = false; } }, { type: "run.human_expired" });
        await patchPointer(run.run.id, { status: run.run.status, ended_at: run.run.ended_at });
      }
      return run ? normalizeV3Run(run) : null;
    }
    const run = await new FilesystemStateStore(pointer.cwd, pointer.task_slug).getState(); return run ? normalizeV2Run(run) : null;
  } catch { return null; }
}
export async function listHistoricalRuns(): Promise<HistoricalRun[]> { const runs = (await Promise.all((await listPointers()).map(load))).filter((run): run is HistoricalRun => Boolean(run)); return runs.sort((a, b) => b.started_at.localeCompare(a.started_at)); }
export async function findHistoricalRun(idOrSlug: string): Promise<HistoricalRun | null> {
  const pointers = await listPointers(); const matches = pointers.filter((pointer) => pointer.run_id === idOrSlug || (idOrSlug.length >= 8 && pointer.run_id.startsWith(idOrSlug)) || pointer.task_slug === idOrSlug);
  for (const pointer of matches) { const run = await load(pointer); if (run) return run; } return null;
}
export async function listV3RunsInCwd(cwd: string) {
  const root = join(cwd, ".harny"); let entries: import("node:fs").Dirent[]; try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const runs = []; for (const entry of entries) { if (!entry.isDirectory() || entry.name === "worktrees" || entry.name === "leases") continue; const run = await new FilesystemRunStoreV3(cwd, entry.name).load().catch(() => null); if (run) runs.push(run); } return runs;
}
