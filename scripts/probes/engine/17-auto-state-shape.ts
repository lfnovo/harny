/**
 * Probe: auto state shape — structural inspection of the auto machine config.
 * Asserts state topology without running the machine. Catches regressions cheaply.
 * Zero real Claude calls, zero async.
 *
 * RUN
 *   bun scripts/probes/engine/17-auto-state-shape.ts
 */

import autoWorkflow from '../../../src/harness/engine/workflows/auto.ts';

const DEADLINE_MS = 1500;

let failures = 0;

// Scenario: auto machine config has the required state topology
try {
  await Promise.race([
    (async () => {
      const name = 'auto-state-shape';

      const config = (autoWorkflow.machine as any).config;
      const states = config?.states ?? {};

      // 'invoking' must exist and have invoke config
      const invoking = states['invoking'];
      if (!invoking) throw new Error("'invoking' state not found in machine config");
      if (!invoking.invoke) throw new Error("'invoking' state missing 'invoke' config");

      // 'finalize' must exist as compound state with 'cleanup' child
      const finalize = states['finalize'];
      if (!finalize) throw new Error("'finalize' state not found in machine config");
      if (!finalize.initial) throw new Error("'finalize' state has no 'initial' (not compound)");
      if (!finalize.states?.['cleanup']) {
        throw new Error("'finalize' state missing 'cleanup' child state");
      }

      // 'done' must be final
      const done = states['done'];
      if (!done) throw new Error("'done' state not found in machine config");
      if (done.type !== 'final') throw new Error(`'done' state.type expected 'final', got '${done.type}'`);

      // 'failed' must be final
      const failed = states['failed'];
      if (!failed) throw new Error("'failed' state not found in machine config");
      if (failed.type !== 'final') throw new Error(`'failed' state.type expected 'final', got '${failed.type}'`);

      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
    ),
  ]);
} catch (e: any) {
  console.log(`FAIL auto-state-shape: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
