/**
 * Probe: no-op phase recording — verifies that when gitCommit returns { sha: null },
 * commitActor calls store.updatePhase('validator', validatorAttempt, { no_op: true }).
 *
 * RUN
 *   bun scripts/probes/engine/20-noopphase.ts
 */

import { createActor } from 'xstate';
import { tmpGitRepo } from '../../../src/harness/testing/index.ts';
import { buildFeatureDevActors } from '../../../src/harness/engine/workflows/featureDevActors.ts';
import type { StateStore } from '../../../src/harness/state/store.ts';
import type { PhaseEntry, State, HistoryEntry, PendingQuestion } from '../../../src/harness/state/schema.ts';

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

process.exit(failures > 0 ? 1 : 0);
