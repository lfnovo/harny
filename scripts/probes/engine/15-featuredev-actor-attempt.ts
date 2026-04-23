/**
 * Probe: featureDev actor attempt wiring — verifies that developerActor writes
 * distinct phases[] rows for attempt=1 and attempt=2 when driven with different
 * attempt values. Simulates the validator-fail retry path. Zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/engine/15-featuredev-actor-attempt.ts
 */

import { createActor } from 'xstate';
import { buildFeatureDevActors } from '../../../src/harness/engine/workflows/featureDevActors.ts';
import type { StateStore } from '../../../src/harness/state/store.ts';
import type { PhaseEntry, HistoryEntry } from '../../../src/harness/state/schema.ts';
import type { PlanTask } from '../../../src/harness/types.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario: developerActor writes distinct phases[] rows for attempt=1 and attempt=2
try {
  await Promise.race([
    (async () => {
      const name = 'featuredev-actor-attempt';

      const capturedPhases: PhaseEntry[] = [];
      const capturedHistory: HistoryEntry[] = [];

      const fakeStore: StateStore = {
        statePath: '/tmp/fake-featuredev-attempt.json',
        createRun: async () => {},
        getState: async () => null,
        updateLifecycle: async () => {},
        appendPhase: async (phase) => {
          capturedPhases.push({ ...phase });
        },
        updatePhase: async (phaseName, attempt, patch) => {
          const entry = capturedPhases.find(
            (p) => p.name === phaseName && p.attempt === attempt,
          );
          if (!entry) throw new Error(`phase not found: ${phaseName}/${attempt}`);
          Object.assign(entry, patch);
        },
        appendHistory: async (entry) => {
          capturedHistory.push(entry);
        },
        setPendingQuestion: async () => {},
        patchWorkflowState: async () => {},
        setPhoenix: async () => {},
      };

      const mockSessionRunPhase = async (_args: unknown) => ({
        status: 'completed' as const,
        structuredOutput: { status: 'done', commit_message: 'feat: stub' },
        sessionId: 'dev-sess',
        error: null,
        resultSubtype: null,
        events: [],
      });

      const actors = buildFeatureDevActors({
        cwd: '/tmp',
        taskSlug: 'probe-featuredev-attempt',
        runId: 'probe-featuredev-attempt-run',
        sessionRunPhase: mockSessionRunPhase as any,
        gitCommit: async () => ({ sha: 'stub-sha' }),
        mode: 'silent' as const,
        logMode: 'quiet' as const,
        store: fakeStore,
        variant: 'default',
      });

      const stubTask: PlanTask = {
        id: 't1',
        title: 'Stub Task',
        description: 'stub',
        acceptance: ['AC1'],
        status: 'pending',
        attempts: 0,
        commit_sha: null,
        history: [],
      };

      // Drive developerActor with attempt=1
      await new Promise<void>((resolve, reject) => {
        const actor = createActor(actors.developerActor, {
          input: { task: stubTask, cwd: '/tmp', attempt: 1 },
        });
        actor.subscribe({
          next: (snapshot) => {
            if (snapshot.status === 'done') resolve();
          },
          error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
        });
        actor.start();
      });

      // Drive developerActor with attempt=2 (simulates retry after validator fail + bumpAttempts)
      await new Promise<void>((resolve, reject) => {
        const actor = createActor(actors.developerActor, {
          input: { task: stubTask, cwd: '/tmp', attempt: 2 },
        });
        actor.subscribe({
          next: (snapshot) => {
            if (snapshot.status === 'done') resolve();
          },
          error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
        });
        actor.start();
      });

      if (capturedPhases.length !== 2) {
        throw new Error(`expected phases.length === 2, got ${capturedPhases.length}`);
      }

      const p0 = capturedPhases[0]!;
      const p1 = capturedPhases[1]!;

      if (p0.name !== 'developer') {
        throw new Error(`expected phases[0].name === 'developer', got '${p0.name}'`);
      }
      if (p0.attempt !== 1) {
        throw new Error(`expected phases[0].attempt === 1, got ${p0.attempt}`);
      }
      if (p1.name !== 'developer') {
        throw new Error(`expected phases[1].name === 'developer', got '${p1.name}'`);
      }
      if (p1.attempt !== 2) {
        throw new Error(`expected phases[1].attempt === 2, got ${p1.attempt}`);
      }

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL featuredev-actor-attempt: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
