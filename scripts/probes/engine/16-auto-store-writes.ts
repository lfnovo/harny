/**
 * Probe: auto boundary store writes — verifies that phases[] entries from the leaf
 * workflow (planner, developer, validator) land in the same StateStore when the store
 * is threaded through auto.buildActors → buildFeatureDevActors. Zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/engine/16-auto-store-writes.ts
 */

import { createActor } from 'xstate';
import { buildAutoActors } from '../../../src/harness/engine/workflows/auto.ts';
import autoWorkflow from '../../../src/harness/engine/workflows/auto.ts';
import type { StateStore } from '../../../src/harness/state/store.ts';
import type { PhaseEntry, HistoryEntry } from '../../../src/harness/state/schema.ts';

const DEADLINE_MS = 1500;

let failures = 0;

// Scenario: leaf planner + developer + validator phases written through auto boundary store
try {
  await Promise.race([
    (async () => {
      const name = 'auto-store-writes';

      const capturedPhases: PhaseEntry[] = [];
      const capturedHistory: HistoryEntry[] = [];

      const fakeStore: StateStore = {
        statePath: '/tmp/fake-auto-state.json',
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

      let callCount = 0;
      const mockSessionRunPhase = async (_args: unknown) => {
        callCount++;
        if (callCount === 1) {
          // Planner
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
          // Developer
          return {
            status: 'completed' as const,
            structuredOutput: { status: 'done', commit_message: 'feat: x' },
            sessionId: 'dev-sess',
            error: null,
            resultSubtype: null,
            events: [],
          };
        } else {
          // Validator
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

      const actors = buildAutoActors({
        cwd: '/tmp',
        taskSlug: 'probe-auto',
        runId: 'probe-auto-run-id',
        sessionRunPhase: mockSessionRunPhase as any,
        gitCommit: async () => ({ sha: 'mock-sha' }),
        mode: 'silent' as const,
        logMode: 'quiet' as const,
        store: fakeStore,
        variant: 'default',
      });

      const machineWithActors = autoWorkflow.machine.provide({ actors });

      await new Promise<void>((resolve, reject) => {
        const actor = createActor(machineWithActors, {
          input: { cwd: '/tmp', userPrompt: 'test' },
        });

        actor.subscribe({
          next: (snapshot) => {
            if (snapshot.status === 'done') {
              if (snapshot.value === 'failed') {
                reject(new Error('machine reached failed state'));
              } else {
                resolve();
              }
            }
          },
          error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
        });

        actor.start();
      });

      const phaseNames = capturedPhases.map((p) => p.name);

      if (!phaseNames.includes('planner')) {
        throw new Error(`phases should include 'planner', got: ${JSON.stringify(phaseNames)}`);
      }
      if (!phaseNames.includes('developer')) {
        throw new Error(`phases should include 'developer', got: ${JSON.stringify(phaseNames)}`);
      }
      if (!phaseNames.includes('validator')) {
        throw new Error(`phases should include 'validator', got: ${JSON.stringify(phaseNames)}`);
      }

      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
    ),
  ]);
} catch (e: any) {
  console.log(`FAIL auto-store-writes: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
