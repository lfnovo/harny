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
    await this.mutate((s) => {
      Object.assign(s.lifecycle, patch);
    });
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
      if (parsed.success) states.push(parsed.data);
    } catch {
      // skip malformed silently — diagnostic surface lives in viewer
    }
  }
  return states;
}

/**
 * Aggregate runs across many cwds, sorted by started_at descending.
 */
export async function listAllRuns(cwds: string[]): Promise<State[]> {
  const all: State[] = [];
  for (const cwd of cwds) {
    all.push(...(await listRunsInCwd(cwd)));
  }
  all.sort((a, b) => b.origin.started_at.localeCompare(a.origin.started_at));
  return all;
}

/**
 * Find a single run by run_id (full or prefix ≥8 chars) across many cwds.
 * First match wins; on ambiguous prefix, returns the first match (acceptable
 * for v1 — collisions in the first 8 hex chars of UUIDv4 are vanishingly rare).
 * If `runIdOrSlug` matches no run_id, falls back to matching task_slug.
 */
export async function findRun(
  cwds: string[],
  runIdOrSlug: string,
): Promise<State | null> {
  const isPrefix = runIdOrSlug.length >= 8 && runIdOrSlug.length < 36;
  for (const cwd of cwds) {
    const states = await listRunsInCwd(cwd);
    const byId = states.find((s) =>
      isPrefix ? s.run_id.startsWith(runIdOrSlug) : s.run_id === runIdOrSlug,
    );
    if (byId) return byId;
  }
  for (const cwd of cwds) {
    const states = await listRunsInCwd(cwd);
    const bySlug = states.find((s) => s.origin.task_slug === runIdOrSlug);
    if (bySlug) return bySlug;
  }
  return null;
}
