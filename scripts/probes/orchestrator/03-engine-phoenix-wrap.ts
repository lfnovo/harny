/**
 * Probe: engine-path-phoenix-wrap — 1 scenario, raced 1500ms, whole probe under 3s.
 *
 * Static analysis: verifies that orchestrator.ts wraps the engine path in
 * withRunSpan and setupPhoenix, mirroring the legacy path.
 *
 * RUN
 *   bun scripts/probes/orchestrator/03-engine-phoenix-wrap.ts
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let failures = 0;

async function main(): Promise<void> {
  const outerDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('outer 3s deadline exceeded')), 3_000),
  );

  await Promise.race([runProbes(), outerDeadline]);
}

async function runProbes(): Promise<void> {
  // Scenario: engine-path-phoenix-wrap
  {
    const name = 'engine-path-phoenix-wrap';
    try {
      await Promise.race([
        (async () => {
          const orchestratorPath = join(
            import.meta.dir,
            '../../../src/harness/orchestrator.ts',
          );
          const source = await readFile(orchestratorPath, 'utf8');

          const anchorIdx = source.indexOf('setupPhoenix({');
          if (anchorIdx === -1) {
            throw new Error('Could not find setupPhoenix({ in orchestrator.ts');
          }

          const window = source.slice(anchorIdx, anchorIdx + 2000);

          if (!window.includes('withRunSpan')) {
            throw new Error(
              'withRunSpan not found within 2000 chars after setupPhoenix({ in orchestrator.ts',
            );
          }
          if (!window.includes('runEngineWorkflow')) {
            throw new Error(
              'runEngineWorkflow not found within 2000 chars after setupPhoenix({ in orchestrator.ts',
            );
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('1500ms scenario deadline exceeded')), 1_500),
        ),
      ]);
      console.log(`PASS ${name}`);
    } catch (e: any) {
      console.log(`FAIL ${name}: ${e.message}`);
      failures++;
    }
  }
}

await main().catch((e: any) => {
  console.log(`FAIL outer: ${e.message}`);
  failures++;
});

process.exit(failures > 0 ? 1 : 0);
