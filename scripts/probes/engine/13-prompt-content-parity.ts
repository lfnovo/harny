/**
 * Probe: prompt content parity — asserts each bundled .md file equals the
 * corresponding DEFAULT_*.prompt constant character-for-character.
 *
 * RUN
 *   bun scripts/probes/engine/13-prompt-content-parity.ts
 */

import { DEFAULT_PLANNER, DEFAULT_DEVELOPER, DEFAULT_VALIDATOR } from '../../../src/harness/engine/workflows/featureDev/shared.ts';
import { resolvePrompt } from '../../../src/harness/engine/promptResolver.ts';

let failures = 0;

for (const [actor, constant] of [
  ['planner', DEFAULT_PLANNER],
  ['developer', DEFAULT_DEVELOPER],
  ['validator', DEFAULT_VALIDATOR],
] as const) {
  try {
    const fromFile = resolvePrompt('feature-dev', 'default', actor, '/nonexistent-cwd-parity');
    if (fromFile !== constant.prompt) {
      const diffIdx = [...fromFile].findIndex((c, i) => c !== constant.prompt[i]);
      throw new Error(
        `${actor}: content mismatch at char index ${diffIdx} — ` +
        `file[${diffIdx}]=${JSON.stringify(fromFile[diffIdx])} ` +
        `constant[${diffIdx}]=${JSON.stringify(constant.prompt[diffIdx])}`,
      );
    }
    console.log(`PASS ${actor}`);
  } catch (e: any) {
    console.log(`FAIL ${actor}: ${e.message}`);
    failures++;
  }
}

process.exit(failures > 0 ? 1 : 0);
