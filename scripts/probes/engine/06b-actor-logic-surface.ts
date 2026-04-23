/**
 * Probe: actor-logic-surface — 6 assertions that each *Logic export is a non-null object.
 * Each assertion raced 500ms, whole probe under 2s.
 *
 * RUN
 *   bun scripts/probes/engine/06b-actor-logic-surface.ts
 */

import { commandActorLogic } from '../../../src/harness/engine/dispatchers/command.ts';
import { agentActorLogic } from '../../../src/harness/engine/dispatchers/agent.ts';
import { humanReviewActorLogic } from '../../../src/harness/engine/dispatchers/humanReview.ts';
import {
  commitLogic,
  resetTreeLogic,
  cleanUntrackedLogic,
} from '../../../src/harness/engine/harnyActions.ts';

const DEADLINE_MS = 500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

function assertLogic(name: string, value: unknown): void {
  if (value === null || value === undefined || typeof value !== 'object') {
    throw new Error(`${name} is not a non-null object (got ${value === null ? 'null' : typeof value})`);
  }
}

let failures = 0;

const cases: [string, unknown][] = [
  ['commandActorLogic', commandActorLogic],
  ['agentActorLogic', agentActorLogic],
  ['humanReviewActorLogic', humanReviewActorLogic],
  ['commitLogic', commitLogic],
  ['resetTreeLogic', resetTreeLogic],
  ['cleanUntrackedLogic', cleanUntrackedLogic],
];

for (const [name, value] of cases) {
  try {
    await Promise.race([
      (async () => {
        assertLogic(name, value);
        console.log(`PASS ${name}`);
      })(),
      hardDeadline(),
    ]);
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

process.exit(failures > 0 ? 1 : 0);
