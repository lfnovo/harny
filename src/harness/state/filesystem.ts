import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  StateSchema,
  type State,
  type PhaseEntry,
  type HistoryEntry,
  type PendingQuestion,
} from "./schema.js";
import type { StateStore } from "./store.js";
import { writeJsonAtomic } from "./atomic.js";
import {
  listPointers,
  patchPointer,
  writePointer,
  type RunPointer,
} from "./registry.js";

export function statePathFor(cwd: string, taskSlug: string): string {
  return join(cwd, ".harny", taskSlug, "state.json");
}

export class FilesystemStateStore implements StateStore {
  readonly statePath: string;

  constructor(cwd: string, taskSlug: string) {
    this.statePath = statePathFor(cwd, taskSlug);
  }

  async getState(): Promise<State | null> {
    if (!existsSync(this.statePath)) return null;
    const raw = await readFile(this.statePath, "utf8");
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `state.json at ${this.statePath} failed schema validation (schema_version mismatch or corrupt). ` +
          `Delete the run dir ${dirname(this.statePath)} or re-run with a new task slug. ` +
          `Details: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async createRun(initial: State): Promise<void> {
    if (existsSync(this.statePath)) {
      throw new Error(
        `state.json already exists at ${this.statePath}; refusing to overwrite`,
      );
    }
    StateSchema.parse(initial);
    await writeJsonAtomic(this.statePath, initial);
    // Best-effort: register in the cross-project pointer index. Failures here
    // must never abort a run — the state.json on disk is the source of truth.
    try {
      await writePointer(initial);
    } catch (err) {
      console.warn(`[harny] could not write run pointer: ${(err as Error).message}`);
    }
  }

  private async mutate(mutator: (s: State) => void): Promise<void> {
    const current = await this.getState();
    if (!current) {
      throw new Error(
        `No state.json at ${this.statePath}; createRun must be called first`,
      );
    }
    mutator(current);
    await writeJsonAtomic(this.statePath, current);
  }

  async updateLifecycle(patch: Partial<State["lifecycle"]>): Promise<void> {
    let runId: string | null = null;
    let nextStatus: State["lifecycle"]["status"] | undefined;
    let nextEndedAt: string | null | undefined;
    await this.mutate((s) => {
      Object.assign(s.lifecycle, patch);
      runId = s.run_id;
      nextStatus = s.lifecycle.status;
      nextEndedAt = s.lifecycle.ended_at;
    });
    if (runId && (patch.status !== undefined || patch.ended_at !== undefined)) {
      await patchPointer(runId, {
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        ...(nextEndedAt !== undefined ? { ended_at: nextEndedAt } : {}),
      });
    }
  }

  async appendPhase(phase: PhaseEntry): Promise<void> {
    await this.mutate((s) => {
      s.phases.push(phase);
    });
  }

  async updatePhase(
    name: string,
    attempt: number,
    patch: Partial<PhaseEntry>,
  ): Promise<void> {
    await this.mutate((s) => {
      for (let i = s.phases.length - 1; i >= 0; i--) {
        const p = s.phases[i]!;
        if (p.name === name && p.attempt === attempt) {
          Object.assign(p, patch);
          return;
        }
      }
      throw new Error(
        `No phase entry name="${name}" attempt=${attempt} found in ${this.statePath}`,
      );
    });
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    await this.mutate((s) => {
      s.history.push(entry);
    });
  }

  async setPendingQuestion(q: PendingQuestion | null): Promise<void> {
    await this.mutate((s) => {
      s.pending_question = q;
    });
  }

  async patchWorkflowState(patch: Record<string, unknown>): Promise<void> {
    await this.mutate((s) => {
      Object.assign(s.workflow_state, patch);
    });
  }

  async setPhoenix(ref: { project: string; trace_id: string }): Promise<void> {
    await this.mutate((s) => {
      s.phoenix = ref;
    });
  }
}

// --- Cross-run discovery (used by `harny ls`, `harny show`, viewer) --------

/**
 * Scan a single cwd for all run state.json files. Skips reserved subdirs
 * (`.harny/worktrees/`, dotfiles) and any malformed state.json.
 *
 * Used during migration (`harny scan`) and as the fallback when the pointer
 * registry is empty. Once a run is registered, discovery routes via the
 * registry without scanning the cwd.
 */
export async function listRunsInCwd(cwd: string): Promise<State[]> {
  const harnyDir = join(cwd, ".harny");
  if (!existsSync(harnyDir)) return [];
  const entries = await readdir(harnyDir, { withFileTypes: true });
  const states: State[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "worktrees") continue;
    const statePath = join(harnyDir, entry.name, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = StateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        states.push(parsed.data);
      } else {
        console.warn(`[harny] skipping malformed state (schema): ${statePath}`);
      }
    } catch {
      console.warn(`[harny] skipping malformed state (parse error): ${statePath}`);
    }
  }
  return states;
}

async function loadStateFromPointer(p: RunPointer): Promise<State | null> {
  const statePath = statePathFor(p.cwd, p.task_slug);
  if (!existsSync(statePath)) return null;
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * List all known runs via the cross-project pointer registry, sorted by
 * `started_at` descending. Pointers whose state.json is unreachable (project
 * deleted, manually removed) are silently skipped — run `harny clean` or
 * `harny scan` to prune them.
 */
export async function listAllRuns(): Promise<State[]> {
  const pointers = await listPointers();
  const states: State[] = [];
  for (const p of pointers) {
    const s = await loadStateFromPointer(p);
    if (s) states.push(s);
  }
  states.sort((a, b) => b.origin.started_at.localeCompare(a.origin.started_at));
  return states;
}

/**
 * Find a single run by run_id (full or ≥8-char prefix) or by task_slug. Reads
 * the pointer registry; first matching pointer wins and its state.json is
 * loaded. On ambiguous prefix collisions (vanishingly rare for UUIDv4), the
 * first match wins.
 */
export async function findRun(runIdOrSlug: string): Promise<State | null> {
  const pointers = await listPointers();
  const isPrefix = runIdOrSlug.length >= 8 && runIdOrSlug.length < 36;
  // Keep scanning if a matching pointer's state.json is unreachable — prefix
  // collisions or stale pointers must not mask a still-valid match further on.
  for (const p of pointers) {
    const idMatch = isPrefix
      ? p.run_id.startsWith(runIdOrSlug)
      : p.run_id === runIdOrSlug;
    if (!idMatch) continue;
    const s = await loadStateFromPointer(p);
    if (s) return s;
  }
  for (const p of pointers) {
    if (p.task_slug !== runIdOrSlug) continue;
    const s = await loadStateFromPointer(p);
    if (s) return s;
  }
  return null;
}
