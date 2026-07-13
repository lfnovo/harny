import { existsSync } from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "./atomic.js";
import type { RunSnapshot } from "./runSchema.js";

export const RunPointerSchema = z.object({
  schema_version: z.literal(2),
  run_id: z.string(), cwd: z.string(), task_slug: z.string(), workflow: z.string(), started_at: z.string(),
  status: z.enum(["running", "paused", "done", "failed", "cancelled"]), ended_at: z.string().nullable(),
});
export type RunPointer = z.infer<typeof RunPointerSchema>;

let registryDirOverride: string | null = null;
export function setRegistryDirForTesting(dir: string | null): void { registryDirOverride = dir; }
export function registryDir(): string { return registryDirOverride ?? join(homedir(), ".harny", "runs"); }

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;
export function pointerPath(runId: string): string { if (!SAFE_RUN_ID.test(runId)) throw new Error(`Invalid run_id ${JSON.stringify(runId)}: must match ${SAFE_RUN_ID}`); return join(registryDir(), `${runId}.json`); }
export function pointerFromRun(run: RunSnapshot): RunPointer { return { schema_version: 2, run_id: run.run.id, cwd: run.workspace.primary_cwd, task_slug: run.run.task_slug, workflow: run.run.workflow, started_at: run.run.started_at, status: run.execution.status, ended_at: run.run.ended_at }; }
export async function writePointer(run: RunSnapshot): Promise<void> { await writeJsonAtomic(pointerPath(run.run.id), pointerFromRun(run)); }

export async function patchPointer(runId: string, patch: Partial<Pick<RunPointer, "status" | "ended_at">>): Promise<void> {
  const path = pointerPath(runId); if (!existsSync(path)) return;
  try { const parsed = RunPointerSchema.safeParse(JSON.parse(await readFile(path, "utf8"))); if (parsed.success) await writeJsonAtomic(path, { ...parsed.data, ...patch }); } catch { /* registry is rebuildable */ }
}
export async function listPointers(): Promise<RunPointer[]> {
  const dir = registryDir(); if (!existsSync(dir)) return [];
  const pointers: RunPointer[] = [];
  for (const name of await readdir(dir)) { if (!name.endsWith(".json")) continue; try { const parsed = RunPointerSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8"))); if (parsed.success) pointers.push(parsed.data); } catch { /* skip stale entries */ } }
  return pointers;
}
export async function deletePointer(runId: string): Promise<void> { const path = pointerPath(runId); if (existsSync(path)) await unlink(path); }
