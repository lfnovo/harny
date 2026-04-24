import type { SessionRunPhase } from "../engine/runtime/runPhaseAdapter.js";
import type { PhaseRunResult } from "../sessionRecorder.js";
import type { PhaseName } from "../types.js";

export type Script =
  | PhaseRunResult<unknown>[]
  | Partial<Record<PhaseName, PhaseRunResult<unknown>[]>>;

/**
 * Builds a SessionRunPhase that returns canned PhaseRunResults in order.
 *
 *  - Array form: pops one result per call, regardless of phase. Exhaustion
 *    throws unless wrapAround=true (then the last entry repeats).
 *  - Record form: queues per phase name (SessionRunPhase receives args.phase,
 *    not phaseName — adaptRunPhase translates the engine-side phaseName).
 *    Exhaustion for any phase throws.
 *
 * Throwing on exhaustion is intentional — silent wrap-around by default would
 * mask off-by-one bugs in the test script.
 */
export function fakeSessionRunner(
  script: Script,
  opts: { wrapAround?: boolean } = {},
): SessionRunPhase {
  if (Array.isArray(script)) {
    const queue = [...script];
    const last = script[script.length - 1];
    return async () => {
      const next = queue.shift();
      if (next) return next;
      if (opts.wrapAround && last) return last;
      throw new Error("fakeSessionRunner: script exhausted");
    };
  }

  const queues: Partial<Record<PhaseName, PhaseRunResult<unknown>[]>> = {};
  for (const [k, v] of Object.entries(script) as [
    PhaseName,
    PhaseRunResult<unknown>[],
  ][]) {
    queues[k] = [...v];
  }

  return async (args) => {
    const q = queues[args.phase];
    if (!q || q.length === 0) {
      throw new Error(
        `fakeSessionRunner: no script entry for phase "${args.phase}"`,
      );
    }
    return q.shift()!;
  };
}
