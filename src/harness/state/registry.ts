/**
 * Cross-project run registry.
 *
 * Each harny run writes a tiny pointer file to `~/.harny/runs/<run_id>.json`
 * when it starts and updates the pointer on lifecycle transitions. The pointer
 * is an index entry, not a source of truth — full state still lives in
 * `<cwd>/.harny/<slug>/state.json`. The registry lets `harny ls`, `harny show`,
 * `harny answer`, and `harny ui` discover runs across projects without any
 * user-maintained `assistants.json`.
 *
 * Schema is intentionally small and stable: only fields needed to locate the
 * state.json on disk and decide whether to even bother loading it (status,
 * started_at for sorting).
 */

import { existsSync } from "node:fs";
import { readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { writeJsonAtomic } from "./atomic.js";
import type { State } from "./schema.js";

export const RunPointerSchema = z.object({
  schema_version: z.literal(1),
  state_schema_version: z.union([z.literal(2), z.literal(3)]).default(2),
  run_id: z.string(),
  cwd: z.string(),
  task_slug: z.string(),
  workflow: z.string(),
  started_at: z.string(),
  status: z.enum(["running", "waiting_human", "paused", "done", "failed", "cancelled"]),
  ended_at: z.string().nullable(),
});

export type RunPointer = z.infer<typeof RunPointerSchema>;

function defaultRegistryDir(): string {
  return join(homedir(), ".harny", "runs");
}

let registryDirOverride: string | null = null;

/** Test seam: redirect the registry to a tmp dir. Pass `null` to reset. */
export function setRegistryDirForTesting(dir: string | null): void {
  registryDirOverride = dir;
}

export function registryDir(): string {
  return registryDirOverride ?? defaultRegistryDir();
}

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error(
      `Invalid run_id ${JSON.stringify(runId)}: must match ${SAFE_RUN_ID}`,
    );
  }
}

export function pointerPath(runId: string): string {
  assertSafeRunId(runId);
  return join(registryDir(), `${runId}.json`);
}

export function pointerFromState(state: State): RunPointer {
  return {
    schema_version: 1,
    state_schema_version: 2,
    run_id: state.run_id,
    cwd: state.environment.cwd,
    task_slug: state.origin.task_slug,
    workflow: state.origin.workflow,
    started_at: state.origin.started_at,
    status: state.lifecycle.status,
    ended_at: state.lifecycle.ended_at,
  };
}

export async function writePointerV3(state: import("./v3/schema.js").RunV3): Promise<void> {
  const pointer: RunPointer = { schema_version: 1, state_schema_version: 3, run_id: state.run.id, cwd: state.workspace.primary_cwd, task_slug: state.run.task_slug, workflow: state.run.workflow, started_at: state.run.started_at, status: state.run.status, ended_at: state.run.ended_at };
  await writeJsonAtomic(pointerPath(state.run.id), pointer);
}

export async function writePointer(state: State): Promise<void> {
  await writeJsonAtomic(pointerPath(state.run_id), pointerFromState(state));
}

/**
 * Best-effort lifecycle update. Missing or malformed pointers are silently
 * ignored — the registry is an index, never the source of truth, so a corrupt
 * pointer must not crash a live run.
 */
export async function patchPointer(
  runId: string,
  patch: Partial<Pick<RunPointer, "status" | "ended_at">>,
): Promise<void> {
  const path = pointerPath(runId);
  if (!existsSync(path)) return;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = RunPointerSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return;
    const next: RunPointer = { ...parsed.data, ...patch };
    await writeJsonAtomic(path, next);
  } catch {
    // swallow — pointer drift is recoverable via `harny scan`
  }
}

export async function listPointers(): Promise<RunPointer[]> {
  const dir = registryDir();
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const out: RunPointer[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const parsed = RunPointerSchema.safeParse(JSON.parse(raw));
      if (parsed.success) out.push(parsed.data);
      // Malformed pointers are skipped silently; `harny scan` can rebuild.
    } catch {
      // unreadable; skip
    }
  }
  return out;
}

export async function deletePointer(runId: string): Promise<void> {
  const path = pointerPath(runId);
  if (existsSync(path)) await unlink(path);
}
