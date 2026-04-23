/**
 * Probe: variant reaches resolver — verifies that variant='just-bugs' flows
 * through buildFeatureDevActors into the resolvePrompt call, so the planner
 * actor receives the project-variant prompt (sentinel string).
 *
 * RUN
 *   bun scripts/probes/engine/22-variant-reaches-resolver.ts
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

const SENTINEL = 'JUST-BUGS-PLANNER-SENTINEL-PROBE-22';

// Scenario (a): variant='just-bugs' resolves the sentinel prompt via phaseConfig.prompt
try {
  await Promise.race([
    (async () => {
      const name = 'variant-prompt-reaches-session';
      const repo = await tmpGitRepo();
      try {
        const promptDir = join(repo.path, '.harny', 'prompts', 'feature-dev', 'just-bugs');
        await mkdir(promptDir, { recursive: true });
        await writeFile(join(promptDir, 'planner.md'), SENTINEL, 'utf8');
        await writeFile(join(promptDir, 'developer.md'), 'SENTINEL-DEV', 'utf8');
        await writeFile(join(promptDir, 'validator.md'), 'SENTINEL-VALIDATOR', 'utf8');

        let capturedPrompt: string | undefined;
        const capturingFn: SessionRunPhase = async (args) => {
          capturedPrompt = args.phaseConfig.prompt;
          throw new Error('capture-abort');
        };

        const actors = buildFeatureDevActors({
          cwd: repo.path,
          variant: 'just-bugs',
          taskSlug: 'probe',
          runId: 'probe',
          sessionRunPhase: capturingFn,
        });

        await new Promise<void>((resolve) => {
          const actor = createActor(actors.plannerActor, { input: { prompt: 'x', cwd: repo.path } });
          actor.subscribe({
            next: (snapshot) => {
              if (snapshot.status !== 'active') resolve();
            },
            error: () => resolve(),
          });
          actor.start();
        });

        if (capturedPrompt !== SENTINEL) {
          throw new Error(`expected sentinel, got: ${capturedPrompt?.slice(0, 80) ?? '(undefined)'}`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL variant-prompt-reaches-session: ${e.message}`);
  failures++;
}

// Scenario (b): variant='default' resolves the bundled default (non-empty, differs from sentinel)
try {
  await Promise.race([
    (async () => {
      const name = 'default-variant-resolves-bundled';
      const repo = await tmpGitRepo();
      try {
        let capturedPrompt: string | undefined;
        const capturingFn: SessionRunPhase = async (args) => {
          capturedPrompt = args.phaseConfig.prompt;
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
          const actor = createActor(actors.plannerActor, { input: { prompt: 'x', cwd: repo.path } });
          actor.subscribe({
            next: (snapshot) => {
              if (snapshot.status !== 'active') resolve();
            },
            error: () => resolve(),
          });
          actor.start();
        });

        if (!capturedPrompt || capturedPrompt.length === 0) {
          throw new Error(`expected non-empty bundled prompt, got: '${capturedPrompt}'`);
        }
        if (capturedPrompt === SENTINEL) {
          throw new Error(`default variant must not return sentinel`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL default-variant-resolves-bundled: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
