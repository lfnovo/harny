/**
 * Probe: canonical-prompts — verifies resolvePrompt('feature-dev', 'default', actor, cwd)
 * returns a non-empty string for planner, developer, and validator.
 *
 * RUN
 *   bun scripts/probes/engine/20-canonical-prompts.ts
 */

import { resolvePrompt } from '../../../src/harness/engine/promptResolver.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

for (const actor of ['planner', 'developer', 'validator'] as const) {
  try {
    await Promise.race([
      (async () => {
        const name = `canonical-prompt-${actor}`;
        const result = resolvePrompt('feature-dev', 'default', actor, process.cwd());
        if (typeof result !== 'string' || result.length === 0) {
          throw new Error(`resolvePrompt returned empty or non-string for actor=${actor}`);
        }
        console.log(`PASS ${name}`);
      })(),
      hardDeadline(),
    ]);
  } catch (e: any) {
    console.log(`FAIL canonical-prompt-${actor}: ${e.message}`);
    failures++;
  }
}

process.exit(failures > 0 ? 1 : 0);
