/**
 * Probe: humanReviewActor — four scenarios with 1500ms hard deadline per scenario, whole probe under 6s.
 *
 * RUN
 *   bun scripts/probes/engine/04-human-review-actor.ts
 */

import { runHumanReview } from '../../../src/harness/engine/dispatchers/humanReview.ts';
import type { HumanReviewRunOptions, HumanReviewOutput } from '../../../src/harness/engine/types.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario 1: text-answer — askProvider resolves with { kind: 'text', value: 'looks good' }
{
  const name = 'text-answer';
  try {
    const controller = new AbortController();
    const expected: HumanReviewOutput = { kind: 'text', value: 'looks good' };
    const opts: HumanReviewRunOptions = {
      message: 'Please review',
      askProvider: () => Promise.resolve(expected),
    };
    const result = await Promise.race([
      runHumanReview(opts, controller.signal),
      hardDeadline(),
    ]);
    if (result.kind === 'text' && result.value === 'looks good') {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: unexpected result ${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

// Scenario 2: option-pick — askProvider resolves with { kind: 'option', value: 'option_b' }
{
  const name = 'option-pick';
  try {
    const controller = new AbortController();
    const expected: HumanReviewOutput = { kind: 'option', value: 'option_b' };
    const opts: HumanReviewRunOptions = {
      message: 'Pick an option',
      options: [
        { value: 'option_a', label: 'Option A' },
        { value: 'option_b', label: 'Option B' },
      ],
      askProvider: () => Promise.resolve(expected),
    };
    const result = await Promise.race([
      runHumanReview(opts, controller.signal),
      hardDeadline(),
    ]);
    if (result.kind === 'option' && result.value === 'option_b') {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: unexpected result ${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

// Scenario 3: abort — askProvider parks; abort after 50ms; assert rejection with 'aborted'
{
  const name = 'abort';
  const controller = new AbortController();
  const opts: HumanReviewRunOptions = {
    message: 'Waiting forever',
    askProvider: ({ signal }) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('inner aborted')));
      }),
  };
  setTimeout(() => controller.abort(), 50);
  try {
    await Promise.race([
      runHumanReview(opts, controller.signal),
      hardDeadline(),
    ]);
    console.log(`FAIL ${name}: should have thrown`);
    failures++;
  } catch (e: any) {
    if (e.message.includes('hard deadline')) {
      console.log(`FAIL ${name}: hard deadline exceeded`);
      failures++;
    } else if (e.message.includes('aborted')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: wrong error: ${e.message}`);
      failures++;
    }
  }
}

// Scenario 4: provider-error — askProvider rejects; assert rejection preserves original error
{
  const name = 'provider-error';
  try {
    const controller = new AbortController();
    const opts: HumanReviewRunOptions = {
      message: 'Will fail',
      askProvider: () => Promise.reject(new Error('provider boom')),
    };
    await Promise.race([
      runHumanReview(opts, controller.signal),
      hardDeadline(),
    ]);
    console.log(`FAIL ${name}: should have thrown`);
    failures++;
  } catch (e: any) {
    if (e.message.includes('hard deadline')) {
      console.log(`FAIL ${name}: hard deadline exceeded`);
      failures++;
    } else if (e.message.includes('provider boom')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: wrong error: ${e.message}`);
      failures++;
    }
  }
}

process.exit(failures > 0 ? 1 : 0);
