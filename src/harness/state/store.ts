import type {
  State,
  PhaseEntry,
  HistoryEntry,
  PendingQuestion,
} from "./schema.js";

/**
 * StateStore is bound to a single run directory (cwd + task slug). All
 * mutations are read-modify-write atomic against the underlying state.json.
 *
 * Cross-run discovery (list/find by id across many cwds) lives as module-level
 * helpers in `./filesystem.ts` — not on this interface — because those reads
 * span multiple runs and don't conceptually belong to "the store of one run".
 */
export interface StateStore {
  /** Absolute path of the backing state.json. Useful for diagnostics/tests. */
  readonly statePath: string;

  /**
   * Initialize a new run. Throws if state.json already exists at this path —
   * runs are append-only; rerunning a slug requires `harny clean` first.
   */
  createRun(initial: State): Promise<void>;

  /** Read current state. Returns null if no state.json yet. */
  getState(): Promise<State | null>;

  /** Patch lifecycle fields (status, current_phase, ended_at, ended_reason, pid). */
  updateLifecycle(patch: Partial<State["lifecycle"]>): Promise<void>;

  /** Append a new phase entry. Use for phase_start. */
  appendPhase(phase: PhaseEntry): Promise<void>;

  /**
   * Update an existing phase entry by (name, attempt). Use for phase_end and
   * for setting verdict/session_id once known. Throws if not found.
   */
  updatePhase(
    name: string,
    attempt: number,
    patch: Partial<PhaseEntry>,
  ): Promise<void>;

  /** Append an event to the history log. Mirrors the old audit.jsonl semantics. */
  appendHistory(entry: HistoryEntry): Promise<void>;

  /** Set or clear the parked question. Pass null to clear after answering. */
  setPendingQuestion(q: PendingQuestion | null): Promise<void>;

  /** Merge keys into workflow_state (escape hatch for per-workflow data). */
  patchWorkflowState(patch: Record<string, unknown>): Promise<void>;

  /** Set the top-level Phoenix link (project + trace_id). Idempotent overwrite. */
  setPhoenix(ref: { project: string; trace_id: string }): Promise<void>;
}
