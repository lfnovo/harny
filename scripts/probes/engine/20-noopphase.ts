/**
 * Probe: no-op phase recording — verifies that when gitCommit returns { sha: null },
 * commitActor calls store.updatePhase('validator', validatorAttempt, { no_op: true }).
 *
 * RUN
 *   bun scripts/probes/engine/20-noopphase.ts
 */

import { createActor, fromPromise } from 'xstate';
import { tmpGitRepo } from '../../../src/harness/testing/index.ts';
import { buildFeatureDevActors } from '../../../src/harness/engine/workflows/featureDevActors.ts';
import type { StateStore } from '../../../src/harness/state/store.ts';
import type { PhaseEntry, State, HistoryEntry, PendingQuestion } from '../../../src/harness/state/schema.ts';
import featureDevWorkflow from '../../../src/harness/engine/workflows/featureDev.ts';
import type { SessionRunPhase } from '../../../src/harness/engine/runtime/runPhaseAdapter.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario (a): commitActor sets no_op=true on the validator phase when sha is null
try {
  await Promise.race([
    (async () => {
      const name = 'noop-commit-sets-no_op-on-validator-phase';
      const repo = await tmpGitRepo();
      try {
        const capturedPatches: { name: string; attempt: number; patch: Partial<PhaseEntry> }[] = [];

        const mockStore: StateStore = {
          statePath: '/dev/null',
          createRun: async (_initial: State) => {},
          getState: async () => null,
          updateLifecycle: async () => {},
          appendPhase: async (_phase: PhaseEntry) => {},
          updatePhase: async (name: string, attempt: number, patch: Partial<PhaseEntry>) => {
            capturedPatches.push({ name, attempt, patch });
          },
          appendHistory: async (_entry: HistoryEntry) => {},
          setPendingQuestion: async (_q: PendingQuestion | null) => {},
          patchWorkflowState: async () => {},
          setPhoenix: async () => {},
        };

        const mockGitCommit = async () => ({ sha: null });

        const actors = buildFeatureDevActors({
          cwd: repo.path,
          variant: 'default',
          taskSlug: 'probe',
          runId: 'probe',
          gitCommit: mockGitCommit,
          store: mockStore,
        });

        await new Promise<void>((resolve, reject) => {
          const actor = createActor(actors.commitActor, {
            input: { cwd: repo.path, message: 'test: probe commit', validatorAttempt: 2 },
          });
          actor.subscribe({
            next: (snapshot) => {
              if (snapshot.status === 'done' || snapshot.status === 'error') resolve();
            },
            error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
          });
          actor.start();
        });

        const noOpPatch = capturedPatches.find(
          (p) => p.name === 'validator' && p.patch.no_op === true,
        );
        if (!noOpPatch) {
          throw new Error(
            `expected updatePhase('validator', ?, { no_op: true }) — got: ${JSON.stringify(capturedPatches)}`,
          );
        }
        if (noOpPatch.attempt !== 2) {
          throw new Error(`expected attempt=2, got attempt=${noOpPatch.attempt}`);
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`FAIL noop-commit-sets-no_op-on-validator-phase: ${msg}`);
  failures++;
}

// Scenario (b): commitActor does NOT call updatePhase when sha is non-null
try {
  await Promise.race([
    (async () => {
      const name = 'non-null-sha-skips-no_op';
      const repo = await tmpGitRepo();
      try {
        const capturedPatches: { name: string; attempt: number; patch: Partial<PhaseEntry> }[] = [];

        const mockStore: StateStore = {
          statePath: '/dev/null',
          createRun: async (_initial: State) => {},
          getState: async () => null,
          updateLifecycle: async () => {},
          appendPhase: async (_phase: PhaseEntry) => {},
          updatePhase: async (name: string, attempt: number, patch: Partial<PhaseEntry>) => {
            capturedPatches.push({ name, attempt, patch });
          },
          appendHistory: async (_entry: HistoryEntry) => {},
          setPendingQuestion: async (_q: PendingQuestion | null) => {},
          patchWorkflowState: async () => {},
          setPhoenix: async () => {},
        };

        const mockGitCommit = async () => ({ sha: 'abc123' });

        const actors = buildFeatureDevActors({
          cwd: repo.path,
          variant: 'default',
          taskSlug: 'probe',
          runId: 'probe',
          gitCommit: mockGitCommit,
          store: mockStore,
        });

        await new Promise<void>((resolve, reject) => {
          const actor = createActor(actors.commitActor, {
            input: { cwd: repo.path, message: 'test: probe commit', validatorAttempt: 1 },
          });
          actor.subscribe({
            next: (snapshot) => {
              if (snapshot.status === 'done' || snapshot.status === 'error') resolve();
            },
            error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
          });
          actor.start();
        });

        const noOpPatch = capturedPatches.find((p) => p.patch.no_op === true);
        if (noOpPatch) {
          throw new Error(
            `expected no no_op patch when sha is non-null — got: ${JSON.stringify(capturedPatches)}`,
          );
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`FAIL non-null-sha-skips-no_op: ${msg}`);
  failures++;
}

// Scenario (c): full machine cycle — verifies { sha: null } from gitCommit causes
// store.updatePhase('validator', 1, { no_op: true }) via the real feature-dev XState machine
try {
  await Promise.race([
    (async () => {
      const name = 'full-cycle-no_op-reaches-validator-phase';
      const repo = await tmpGitRepo();
      try {
        const capturedPatches: { name: string; attempt: number; patch: Partial<PhaseEntry> }[] = [];

        const mockStore: StateStore = {
          statePath: '/dev/null',
          createRun: async (_initial: State) => {},
          getState: async () => null,
          updateLifecycle: async () => {},
          appendPhase: async (_phase: PhaseEntry) => {},
          updatePhase: async (name: string, attempt: number, patch: Partial<PhaseEntry>) => {
            capturedPatches.push({ name, attempt, patch });
          },
          appendHistory: async (_entry: HistoryEntry) => {},
          setPendingQuestion: async (_q: PendingQuestion | null) => {},
          patchWorkflowState: async () => {},
          setPhoenix: async () => {},
        };

        const mockGitCommit = async () => ({ sha: null as null });

        const mockSessionRunPhase: SessionRunPhase = async (args) => {
          if (args.phase === 'planner') {
            return {
              sessionId: 'planner-session',
              status: 'completed' as const,
              error: null,
              structuredOutput: {
                summary: 'probe plan',
                tasks: [{ id: 't1', title: 'probe task', description: 'probe', acceptance: ['check it'] }],
              },
              resultSubtype: null,
              events: [],
            };
          }
          if (args.phase === 'developer') {
            return {
              sessionId: 'dev-session',
              status: 'completed' as const,
              error: null,
              structuredOutput: { status: 'done', commit_message: 'test: probe commit' },
              resultSubtype: null,
              events: [],
            };
          }
          if (args.phase === 'validator') {
            return {
              sessionId: 'validator-session',
              status: 'completed' as const,
              error: null,
              structuredOutput: { verdict: 'pass', reasons: ['all good'] },
              resultSubtype: null,
              events: [],
            };
          }
          throw new Error('unexpected phase: ' + args.phase);
        };

        const actors = buildFeatureDevActors({
          cwd: repo.path,
          variant: 'default',
          taskSlug: 'probe',
          runId: 'probe',
          sessionRunPhase: mockSessionRunPhase,
          gitCommit: mockGitCommit,
          store: mockStore,
        });

        const providedMachine = featureDevWorkflow.machine.provide({
          actors: { ...actors, persistPlanActor: fromPromise(async () => {}) },
        });

        await new Promise<void>((resolve, reject) => {
          const actor = createActor(providedMachine, {
            input: { cwd: repo.path, userPrompt: 'probe', taskSlug: 'probe', maxRetries: 0 },
          });
          actor.subscribe({
            next: (snapshot) => {
              if (snapshot.status === 'done') {
                if (snapshot.context.error) {
                  reject(new Error(`machine reached failed: ${snapshot.context.error}`));
                } else {
                  resolve();
                }
              }
            },
            error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
          });
          actor.start();
        });

        const hasNoOpPatch = capturedPatches.some(
          (p) => p.name === 'validator' && p.attempt === 1 && p.patch.no_op === true,
        );
        if (!hasNoOpPatch) {
          throw new Error(
            `expected updatePhase('validator', 1, { no_op: true }) — got: ${JSON.stringify(capturedPatches)}`,
          );
        }
        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`FAIL full-cycle-no_op-reaches-validator-phase: ${msg}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
