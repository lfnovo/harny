/**
 * Probe: actions-contract — static analysis: registry coverage + no-unimplemented-refs.
 * Two scenarios, each raced against 1500ms deadline, whole probe under 5s.
 *
 * RUN
 *   bun scripts/probes/engine/07-actions-contract.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harnyActions } from '../../../src/harness/engine/harnyActions.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

const workflowsDir = join(import.meta.dir, '../../../src/harness/engine/workflows');
const registryKeys = new Set(Object.keys(harnyActions));

let failures = 0;

// Scenario 1: coverage — every registry key appears in at least one workflow file
try {
  await Promise.race([
    (async () => {
      const name = 'coverage';
      const files = readdirSync(workflowsDir).filter(f => f.endsWith('.ts'));
      const combinedSource = files.map(f => readFileSync(join(workflowsDir, f), 'utf8')).join('\n');
      const uncovered: string[] = [];
      for (const key of registryKeys) {
        if (!new RegExp(`\\b${key}\\b`).test(combinedSource)) {
          uncovered.push(key);
        }
      }
      if (uncovered.length > 0) {
        console.log(`WARN ${name}: keys ${uncovered.join(', ')} lack coverage in any workflow`);
      } else {
        console.log(`PASS ${name}`);
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL coverage: ${e.message}`);
  failures++;
}

// Scenario 2: no-unimplemented-refs — no workflow references a key absent from the registry
try {
  await Promise.race([
    (async () => {
      const name = 'no-unimplemented-refs';
      const files = readdirSync(workflowsDir).filter(f => f.endsWith('.ts'));
      const badRefs: string[] = [];
      for (const f of files) {
        const src = readFileSync(join(workflowsDir, f), 'utf8');
        for (const m of src.matchAll(/(?<!\/)harnyActions\.(\w+)/g)) {
          const key = m[1];
          if (!registryKeys.has(key)) {
            badRefs.push(`${f}: harnyActions.${key}`);
          }
        }
      }
      if (badRefs.length > 0) {
        console.log(`FAIL ${name}: unimplemented refs — ${badRefs.join(', ')}`);
        failures++;
      } else {
        console.log(`PASS ${name}`);
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL no-unimplemented-refs: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
