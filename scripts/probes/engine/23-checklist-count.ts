/**
 * Probe: checklist-count constraint — verifies that a prompt containing
 * markdown checklist items gets the soft constraint paragraph appended,
 * and that prompts without checklist items pass through unchanged.
 *
 * RUN
 *   bun scripts/probes/engine/23-checklist-count.ts
 */

import { createActor } from 'xstate';
import { tmpGitRepo } from '../../../src/harness/testing/index.ts';
import { buildFeatureDevActors } from '../../../src/harness/engine/workflows/featureDevActors.ts';
import type { SessionRunPhase } from '../../../src/harness/engine/runtime/runPhaseAdapter.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

async function runPlannerAndCapturePrompt(
  userPrompt: string,
): Promise<string | undefined> {
  const repo = await tmpGitRepo();
  try {
    let capturedPrompt: string | undefined;
    const capturingFn: SessionRunPhase = async (args) => {
      capturedPrompt = args.prompt;
      throw new Error('capture-abort');
    };

    const actors = buildFeatureDevActors({
      cwd: repo.path,
      variant: 'default',
      taskSlug: 'probe',
      runId: 'probe',
      sessionRunPhase: capturingFn,
    });

    await new Promise<void>((resolve) => {
      const actor = createActor(actors.plannerActor, {
        input: { prompt: userPrompt, cwd: repo.path },
      });
      actor.subscribe({
        next: (snapshot) => {
          if (snapshot.status !== 'active') resolve();
        },
        error: () => resolve(),
      });
      actor.start();
    });

    return capturedPrompt;
  } finally {
    await repo.cleanup();
  }
}

// Scenario (a): 3 `- [ ]` items → captured prompt contains "3 checklist items"
try {
  await Promise.race([
    (async () => {
      const name = 'three-unchecked-items-inject-count';
      const userPrompt = [
        'Do the following:',
        '- [ ] First task',
        '- [ ] Second task',
        '- [ ] Third task',
      ].join('\n');

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (!captured.includes('3 checklist item')) {
        throw new Error(
          `expected '3 checklist item' in prompt, got: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL three-unchecked-items-inject-count: ${e.message}`);
  failures++;
}

// Scenario (b): 0 checklist items → captured prompt does NOT contain "checklist item"
try {
  await Promise.race([
    (async () => {
      const name = 'no-checklist-items-no-constraint';
      const userPrompt = 'Build a simple hello world program.';

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (captured.includes('checklist item')) {
        throw new Error(
          `expected no checklist constraint, but found it in: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL no-checklist-items-no-constraint: ${e.message}`);
  failures++;
}

// Scenario (c): mixed `- [ ]` and `- [x]` items → both counted together
try {
  await Promise.race([
    (async () => {
      const name = 'mixed-checked-unchecked-counted-together';
      const userPrompt = [
        'Complete these items:',
        '- [x] Already done task',
        '- [ ] Pending task one',
        '- [x] Another done task',
        '- [ ] Pending task two',
      ].join('\n');

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (!captured.includes('4 checklist item')) {
        throw new Error(
          `expected '4 checklist item' in prompt, got: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL mixed-checked-unchecked-counted-together: ${e.message}`);
  failures++;
}

// Scenario (d): 2-space indented bullet → counts as 1
try {
  await Promise.race([
    (async () => {
      const name = 'indented-bullet';
      const userPrompt = '  - [ ] indented task';

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (!captured.includes('1 checklist item')) {
        throw new Error(
          `expected '1 checklist item' in prompt, got: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL indented-bullet: ${e.message}`);
  failures++;
}

// Scenario (e): capital-X marker → counts as 1
try {
  await Promise.race([
    (async () => {
      const name = 'capital-X';
      const userPrompt = '- [X] Done';

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (!captured.includes('1 checklist item')) {
        throw new Error(
          `expected '1 checklist item' in prompt, got: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL capital-X: ${e.message}`);
  failures++;
}

// Scenario (f): asterisk bullet marker → counts as 1
try {
  await Promise.race([
    (async () => {
      const name = 'asterisk-marker';
      const userPrompt = '* [ ] Star task';

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (!captured.includes('1 checklist item')) {
        throw new Error(
          `expected '1 checklist item' in prompt, got: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL asterisk-marker: ${e.message}`);
  failures++;
}

// Scenario (g): plus bullet marker → counts as 1
try {
  await Promise.race([
    (async () => {
      const name = 'plus-marker';
      const userPrompt = '+ [ ] Plus task';

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (!captured.includes('1 checklist item')) {
        throw new Error(
          `expected '1 checklist item' in prompt, got: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL plus-marker: ${e.message}`);
  failures++;
}

// Scenario (h): checklist inside fenced code block is ignored; only the real item outside is counted
try {
  await Promise.race([
    (async () => {
      const name = 'fenced-code-block-ignored';
      const userPrompt = [
        '- [ ] real task',
        '```',
        '- [ ] inside fence',
        '```',
      ].join('\n');

      const captured = await runPlannerAndCapturePrompt(userPrompt);

      if (!captured) {
        throw new Error('no prompt captured');
      }
      if (!captured.includes('1 checklist item')) {
        throw new Error(
          `expected '1 checklist item' in prompt (fence should not be counted), got: ${captured.slice(0, 200)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL fenced-code-block-ignored: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
