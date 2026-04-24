/**
 * Probe: engine uses resolver — proves the system prompt (phaseConfig.prompt)
 * threaded to adaptRunPhase for each actor equals resolvePrompt(...) output.
 * Zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/testing/02-engine-uses-resolver.ts
 */

import { createActor } from 'xstate';
import { tmpGitRepo } from '../../../src/harness/testing/index.ts';
import { buildFeatureDevActors } from '../../../src/harness/engine/workflows/featureDevActors.ts';
import { resolvePrompt } from '../../../src/harness/engine/promptResolver.ts';
import featureDevWorkflow from '../../../src/harness/engine/workflows/featureDev.ts';

const DEADLINE_MS = 3000;

let failures = 0;

try {
  await Promise.race([
    (async () => {
      const name = 'engine-uses-resolver';
      const repo = await tmpGitRepo();
      try {
        const capturedSystemPrompts: Record<string, string> = {};

        const mockSessionRunPhase = async (args: {
          phase: string;
          phaseConfig: { prompt: string };
          [key: string]: unknown;
        }) => {
          capturedSystemPrompts[args.phase] = args.phaseConfig.prompt;

          if (args.phase === 'planner') {
            return {
              status: 'completed' as const,
              structuredOutput: {
                summary: 'stub plan',
                tasks: [{ id: 't1', title: 'Task', description: 'test', acceptance: ['AC1'] }],
              },
              sessionId: 'plan-sess',
              error: null,
              resultSubtype: null,
              events: [],
            };
          } else if (args.phase === 'developer') {
            return {
              status: 'completed' as const,
              structuredOutput: { status: 'done', commit_message: 'feat: probe' },
              sessionId: 'dev-sess',
              error: null,
              resultSubtype: null,
              events: [],
            };
          } else {
            return {
              status: 'completed' as const,
              structuredOutput: { verdict: 'pass', reasons: [] },
              sessionId: 'val-sess',
              error: null,
              resultSubtype: null,
              events: [],
            };
          }
        };

        const actors = buildFeatureDevActors({
          cwd: repo.path,
          taskSlug: 'probe',
          runId: 'probe-id',
          sessionRunPhase: mockSessionRunPhase as any,
          gitCommit: async () => ({ sha: 'mock-sha' }),
          mode: 'silent' as const,
          logMode: 'compact' as const,
          variant: 'default',
        });

        const { machine } = featureDevWorkflow;
        const provided = machine.provide({ actors } as any);

        const snapshot = await new Promise<any>((resolve, reject) => {
          const actor = createActor(provided, { input: { cwd: repo.path, taskSlug: 'probe', userPrompt: 'test', maxRetries: 3 } });
          actor.subscribe({
            next: (s) => { if (s.status === 'done' || s.status === 'error') resolve(s); },
            error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
          });
          actor.start();
        });

        if (snapshot.status === 'error') {
          throw new Error(`machine errored: ${String(snapshot.error)}`);
        }
        if (snapshot.value !== 'done') {
          throw new Error(`expected machine state 'done', got '${JSON.stringify(snapshot.value)}'`);
        }

        for (const actor of ['planner', 'developer', 'validator'] as const) {
          const expected = resolvePrompt('feature-dev', 'default', actor, repo.path);
          const actual = capturedSystemPrompts[actor];
          if (actual === undefined) {
            throw new Error(`${actor}: sessionRunPhase was never called for this phase`);
          }
          if (actual !== expected) {
            const diffIdx = [...actual].findIndex((c, i) => c !== expected[i]);
            throw new Error(
              `${actor}: system prompt mismatch at char ${diffIdx} — ` +
              `got ${JSON.stringify(actual.slice(0, 40))} ` +
              `expected ${JSON.stringify(expected.slice(0, 40))}`,
            );
          }
        }

        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
    ),
  ]);
} catch (e: any) {
  console.log(`FAIL engine-uses-resolver: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
