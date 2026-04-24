/**
 * Probe: committing phase recording — verifies that commitActor creates a first-class
 * committing PhaseEntry (appendPhase + updatePhase) and that no_op is set only when sha is null.
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

// Scenario (a): commitActor appends a committing PhaseEntry and updates it with no_op=true when sha is null
try {
  await Promise.race([
    (async () => {
      const name = 'noop-commit-sets-no_op-on-committing-phase';
      const repo = await tmpGitRepo();
      try {
        const capturedAppends: PhaseEntry[] = [];
        const capturedPatches: { name: string; attempt: number; patch: Partial<PhaseEntry> }[] = [];

        const mockStore: StateStore = {
          statePath: '/dev/null',
          createRun: async (_initial: State) => {},
          getState: async () => null,
          updateLifecycle: async () => {},
          appendPhase: async (phase: PhaseEntry) => {
            capturedAppends.push(phase);
          },
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
            input: { cwd: repo.path, message: 'test: probe commit', attempt: 2 },
          });
          actor.subscribe({
            next: (snapshot) => {
              if (snapshot.status === 'done' || snapshot.status === 'error') resolve();
            },
            error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
          });
          actor.start();
        });

        const appendedCommitting = capturedAppends.find((p) => p.name === 'committing');
        if (!appendedCommitting) {
          throw new Error(
            `expected appendPhase({ name: 'committing', ... }) — got: ${JSON.stringify(capturedAppends)}`,
          );
        }
        if (appendedCommitting.attempt !== 2) {
          throw new Error(`expected appendPhase attempt=2, got attempt=${appendedCommitting.attempt}`);
        }

        const noOpPatch = capturedPatches.find(
          (p) => p.name === 'committing' && p.attempt === 2 && p.patch.no_op === true,
        );
        if (!noOpPatch) {
          throw new Error(
            `expected updatePhase('committing', 2, { no_op: true, ... }) — got: ${JSON.stringify(capturedPatches)}`,
          );
        }
        if (noOpPatch.patch.status !== 'completed') {
          throw new Error(`expected status='completed' in no_op patch, got: ${noOpPatch.patch.status}`);
        }

        const validatorNoOpPatch = capturedPatches.find((p) => p.name === 'validator');
        if (validatorNoOpPatch) {
          throw new Error(
            `expected no updatePhase('validator', ...) — got: ${JSON.stringify(validatorNoOpPatch)}`,
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
  console.log(`FAIL noop-commit-sets-no_op-on-committing-phase: ${msg}`);
  failures++;
}

// Scenario (b): commitActor appends a committing PhaseEntry and updates with verdict=sha (no no_op) when sha is non-null
try {
  await Promise.race([
    (async () => {
      const name = 'non-null-sha-records-committing-phase';
      const repo = await tmpGitRepo();
      try {
        const capturedAppends: PhaseEntry[] = [];
        const capturedPatches: { name: string; attempt: number; patch: Partial<PhaseEntry> }[] = [];

        const mockStore: StateStore = {
          statePath: '/dev/null',
          createRun: async (_initial: State) => {},
          getState: async () => null,
          updateLifecycle: async () => {},
          appendPhase: async (phase: PhaseEntry) => {
            capturedAppends.push(phase);
          },
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
            input: { cwd: repo.path, message: 'test: probe commit', attempt: 1 },
          });
          actor.subscribe({
            next: (snapshot) => {
              if (snapshot.status === 'done' || snapshot.status === 'error') resolve();
            },
            error: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
          });
          actor.start();
        });

        const appendedCommitting = capturedAppends.find((p) => p.name === 'committing');
        if (!appendedCommitting) {
          throw new Error(
            `expected appendPhase({ name: 'committing', ... }) — got: ${JSON.stringify(capturedAppends)}`,
          );
        }

        const commitPatch = capturedPatches.find(
          (p) => p.name === 'committing' && p.patch.verdict === 'abc123',
        );
        if (!commitPatch) {
          throw new Error(
            `expected updatePhase('committing', ?, { verdict: 'abc123', ... }) — got: ${JSON.stringify(capturedPatches)}`,
          );
        }
        if (commitPatch.patch.status !== 'completed') {
          throw new Error(`expected status='completed', got: ${commitPatch.patch.status}`);
        }
        if ('no_op' in commitPatch.patch) {
          throw new Error(
            `expected no 'no_op' key in patch when sha is non-null — got: ${JSON.stringify(commitPatch.patch)}`,
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
  console.log(`FAIL non-null-sha-records-committing-phase: ${msg}`);
  failures++;
}

// Scenario (c): full machine cycle — sha=null causes committing PhaseEntry with no_op=true; validator has no no_op
try {
  await Promise.race([
    (async () => {
      const name = 'full-cycle-no_op-reaches-committing-phase';
      const repo = await tmpGitRepo();
      try {
        const capturedAppends: PhaseEntry[] = [];
        const capturedPatches: { name: string; attempt: number; patch: Partial<PhaseEntry> }[] = [];

        const mockStore: StateStore = {
          statePath: '/dev/null',
          createRun: async (_initial: State) => {},
          getState: async () => null,
          updateLifecycle: async () => {},
          appendPhase: async (phase: PhaseEntry) => {
            capturedAppends.push(phase);
          },
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

        const appendedCommitting = capturedAppends.find((p) => p.name === 'committing');
        if (!appendedCommitting) {
          throw new Error(
            `expected appendPhase({ name: 'committing', ... }) — got: ${JSON.stringify(capturedAppends)}`,
          );
        }

        const noOpPatch = capturedPatches.find(
          (p) => p.name === 'committing' && p.patch.no_op === true,
        );
        if (!noOpPatch) {
          throw new Error(
            `expected updatePhase('committing', ?, { no_op: true, ... }) — got: ${JSON.stringify(capturedPatches)}`,
          );
        }

        const validatorNoOpPatch = capturedPatches.find(
          (p) => p.name === 'validator' && p.patch.no_op !== undefined,
        );
        if (validatorNoOpPatch) {
          throw new Error(
            `validator phase must not carry no_op — got: ${JSON.stringify(validatorNoOpPatch)}`,
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
  console.log(`FAIL full-cycle-no_op-reaches-committing-phase: ${msg}`);
  failures++;
}

// Scenario (d): full machine cycle — sha='deadbeef' records committing PhaseEntry with verdict and no no_op key
try {
  await Promise.race([
    (async () => {
      const name = 'full-cycle-real-sha-records-committing-phase';
      const repo = await tmpGitRepo();
      try {
        const capturedAppends: PhaseEntry[] = [];
        const capturedPatches: { name: string; attempt: number; patch: Partial<PhaseEntry> }[] = [];

        const mockStore: StateStore = {
          statePath: '/dev/null',
          createRun: async (_initial: State) => {},
          getState: async () => null,
          updateLifecycle: async () => {},
          appendPhase: async (phase: PhaseEntry) => {
            capturedAppends.push(phase);
          },
          updatePhase: async (name: string, attempt: number, patch: Partial<PhaseEntry>) => {
            capturedPatches.push({ name, attempt, patch });
          },
          appendHistory: async (_entry: HistoryEntry) => {},
          setPendingQuestion: async (_q: PendingQuestion | null) => {},
          patchWorkflowState: async () => {},
          setPhoenix: async () => {},
        };

        const mockGitCommit = async () => ({ sha: 'deadbeef' });

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
              structuredOutput: { status: 'done', commit_message: 'feat: real commit' },
              resultSubtype: null,
              events: [],
            };
          }
          if (args.phase === 'validator') {
            return {
              sessionId: 'validator-session',
              status: 'completed' as const,
              error: null,
              structuredOutput: { verdict: 'pass', reasons: ['looks good'] },
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

        const appendedCommitting = capturedAppends.find((p) => p.name === 'committing');
        if (!appendedCommitting) {
          throw new Error(
            `expected appendPhase({ name: 'committing', ... }) — got: ${JSON.stringify(capturedAppends)}`,
          );
        }

        const commitPatch = capturedPatches.find(
          (p) => p.name === 'committing' && p.patch.verdict === 'deadbeef',
        );
        if (!commitPatch) {
          throw new Error(
            `expected updatePhase('committing', ?, { verdict: 'deadbeef', ... }) — got: ${JSON.stringify(capturedPatches)}`,
          );
        }
        if (commitPatch.patch.status !== 'completed') {
          throw new Error(`expected status='completed', got: ${commitPatch.patch.status}`);
        }
        if ('no_op' in commitPatch.patch) {
          throw new Error(
            `expected no 'no_op' key when sha is non-null — got: ${JSON.stringify(commitPatch.patch)}`,
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
  console.log(`FAIL full-cycle-real-sha-records-committing-phase: ${msg}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
