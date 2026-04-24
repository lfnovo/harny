/**
 * Probe: engine state writes dry — full feature-dev-engine machine run with all
 * actors wired via buildFeatureDevActors + capturing StateStore. Asserts the
 * machine reaches 'done' and phases[] / history[] are populated correctly.
 * Zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/testing/03-engine-state-writes-dry.ts
 */

import { runEngineWorkflowDry } from '../../../src/harness/testing/index.ts';
import { buildFeatureDevActors } from '../../../src/harness/engine/workflows/featureDevActors.ts';
import featureDevWorkflow from '../../../src/harness/engine/workflows/featureDev.ts';
import type { StateStore } from '../../../src/harness/state/store.ts';
import type { PhaseEntry, HistoryEntry } from '../../../src/harness/state/schema.ts';

let failures = 0;

// Scenario: full engine run — phases and history populated by adaptRunPhase store writes
try {
  await Promise.race([
    (async () => {
      const name = 'engine-state-writes-dry';

      const capturedPhases: PhaseEntry[] = [];
      const capturedHistory: HistoryEntry[] = [];

      const fakeStore: StateStore = {
        statePath: '/tmp/fake-state.json',
        createRun: async () => {},
        getState: async () => null,
        updateLifecycle: async () => {},
        appendPhase: async (phase) => {
          if (phase.name !== 'committing') capturedPhases.push({ ...phase });
        },
        updatePhase: async (phaseName, attempt, patch) => {
          const entry = capturedPhases.find(
            (p) => p.name === phaseName && p.attempt === attempt,
          );
          if (!entry) return;
          Object.assign(entry, patch);
        },
        appendHistory: async (entry) => {
          capturedHistory.push(entry);
        },
        setPendingQuestion: async () => {},
        patchWorkflowState: async () => {},
        setPhoenix: async () => {},
      };

      let callCount = 0;
      const mockSessionRunPhase = async (_args: unknown) => {
        callCount++;
        if (callCount === 1) {
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
        } else if (callCount === 2) {
          return {
            status: 'completed' as const,
            structuredOutput: { status: 'done', commit_message: 'feat: x' },
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
        cwd: '/tmp',
        taskSlug: 'probe',
        runId: 'probe-run-id',
        sessionRunPhase: mockSessionRunPhase as any,
        gitCommit: async () => ({ sha: 'mock-sha' }),
        mode: 'silent' as const,
        logMode: 'compact' as const,
        store: fakeStore,
        variant: 'default',
      });

      const snapshot = await runEngineWorkflowDry(
        featureDevWorkflow,
        { cwd: '/tmp', taskSlug: 'probe', userPrompt: 'test' },
        actors,
      );

      if (snapshot.status !== 'done') {
        throw new Error(`expected snapshot.status 'done', got '${snapshot.status}'`);
      }

      if (capturedPhases.length !== 3) {
        throw new Error(`expected phases.length === 3, got ${capturedPhases.length}`);
      }

      const phaseEndEvents = capturedHistory.filter(
        (e: any) => e.event === 'phase_end' && e.phase !== 'planner',
      );
      if (phaseEndEvents.length !== 2) {
        throw new Error(
          `expected === 2 phase_end history events, got ${phaseEndEvents.length}`,
        );
      }

      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('hard deadline exceeded')), 5000),
    ),
  ]);
} catch (e: any) {
  console.log(`FAIL engine-state-writes-dry: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
