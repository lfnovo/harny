import { FilesystemStateStore } from "./state/filesystem.js";
import type { State } from "./state/schema.js";
import type { StateStore } from "./state/store.js";
import { isPidAlive } from "./pid.js";

/**
 * Idempotently write terminal state. No-ops if lifecycle is already terminal.
 * Exported for testing and reused by the orchestrator exit handlers.
 */
export async function applyTerminalState(store: StateStore, reason: string): Promise<void> {
  const current = await store.getState();
  if (!current) return;
  const { status } = current.lifecycle;
  if (status === "done" || status === "failed" || status === "waiting_human") return;
  await store.updateLifecycle({
    status: "failed",
    ended_at: new Date().toISOString(),
    ended_reason: reason,
    current_phase: null,
  });
}

/**
 * Lazily reconcile a run whose process died without writing terminal state.
 *
 * SIGKILL (and other untrappable deaths, e.g. the orchestrator being reaped
 * before the planner ever returns a session_id) can never run the in-process
 * exit handlers, so state.json is stranded at status=running. The in-process
 * handlers cover graceful/signal death; this covers the rest. Any later
 * observer (ls/show/status/viewer) calls this to persist the terminal
 * transition once the pid is confirmed dead — the only place the write can
 * happen, since the dying process is gone.
 *
 * Persisting (not merely displaying "running (stale)") also syncs the
 * cross-run pointer registry via updateLifecycle, so a dead run stops
 * masquerading as running everywhere. Returns the possibly-updated state.
 */
export async function reconcileStaleRun(run: State): Promise<State> {
  if (run.lifecycle.status !== "running" || isPidAlive(run.lifecycle.pid)) {
    return run;
  }
  const store = new FilesystemStateStore(run.environment.cwd, run.origin.task_slug);
  await applyTerminalState(store, "process_died_untrapped");
  return (await store.getState()) ?? run;
}
