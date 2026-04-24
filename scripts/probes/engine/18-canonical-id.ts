/**
 * Probe: canonical-id — verifies getWorkflow('feature-dev') returns the engine
 * WorkflowDefinition (has .machine, no .run), getWorkflow('feature-dev-engine') throws,
 * and getWorkflow('auto') / getWorkflow('echo-commit') are defined.
 *
 * RUN
 *   bun scripts/probes/engine/18-canonical-id.ts
 */

import { getWorkflow } from '../../../src/harness/workflows/index.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario (a): getWorkflow('feature-dev') returns engine shape
try {
  await Promise.race([
    (async () => {
      const name = 'feature-dev-is-engine';
      const wf = getWorkflow('feature-dev');
      // isEngineWorkflow removed from workflows/index.ts — check shape directly
      if (!('machine' in wf)) {
        throw new Error(`getWorkflow('feature-dev') has no .machine property`);
      }
      if ('run' in wf) {
        throw new Error(`getWorkflow('feature-dev') has a .run property — should be engine shape only`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL feature-dev-is-engine: ${e.message}`);
  failures++;
}

// Scenario (b): getWorkflow('feature-dev-engine') throws
try {
  await Promise.race([
    (async () => {
      const name = 'feature-dev-engine-unknown';
      let threw = false;
      try {
        getWorkflow('feature-dev-engine');
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error(`getWorkflow('feature-dev-engine') did not throw — old id should be gone`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL feature-dev-engine-unknown: ${e.message}`);
  failures++;
}

// Scenario (c): getWorkflow('auto') is defined
try {
  await Promise.race([
    (async () => {
      const name = 'auto-still-registered';
      const wf = getWorkflow('auto');
      if (!wf) {
        throw new Error(`getWorkflow('auto') returned undefined`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL auto-still-registered: ${e.message}`);
  failures++;
}

// Scenario (d): getWorkflow('echo-commit') is defined
try {
  await Promise.race([
    (async () => {
      const name = 'echo-commit-still-registered';
      const wf = getWorkflow('echo-commit');
      if (!wf) {
        throw new Error(`getWorkflow('echo-commit') returned undefined`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL echo-commit-still-registered: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
