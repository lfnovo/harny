/**
 * Probe: auto workflow dry run — uses runEngineWorkflowDry with stub leafMachine
 * and cleanupActor. Asserts the machine reaches final 'done' state.
 * Zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/testing/04-auto-workflow-dry.ts
 */

import { fromPromise } from 'xstate';
import { runEngineWorkflowDry } from '../../../src/harness/testing/index.ts';
import autoWorkflow from '../../../src/harness/engine/workflows/auto.ts';

const DEADLINE_MS = 1500;

let failures = 0;

// Scenario: auto machine reaches 'done' with stub leafMachine and stub cleanupActor
try {
  await Promise.race([
    (async () => {
      const name = 'auto-workflow-dry';

      const snapshot = await runEngineWorkflowDry(
        autoWorkflow,
        { cwd: '/tmp', userPrompt: 'test prompt' },
        {
          leafMachine: fromPromise(async () => ({})),
          cleanupActor: fromPromise(async () => {}),
        },
      );

      if (snapshot.status !== 'done') {
        throw new Error(`expected snapshot.status 'done', got '${snapshot.status}'`);
      }

      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
    ),
  ]);
} catch (e: any) {
  console.log(`FAIL auto-workflow-dry: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
