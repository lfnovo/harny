/**
 * Probe: adapter store writes — verifies adaptRunPhase writes phases[] and
 * history[] entries when a StateStore is injected via runPhaseWithFixture.
 * Zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/engine/14-adapter-store-writes.ts
 */

import { tmpGitRepo, runPhaseWithFixture } from '../../../src/harness/testing/index.ts';
import type { StateStore } from '../../../src/harness/state/store.ts';
import type { PhaseEntry, HistoryEntry } from '../../../src/harness/state/schema.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario: adapter writes phases[] and history[] when store is provided
try {
  await Promise.race([
    (async () => {
      const name = 'adapter-store-writes';
      const repo = await tmpGitRepo();

      try {
        const capturedPhases: PhaseEntry[] = [];
        const capturedHistory: HistoryEntry[] = [];

        const fakeStore: StateStore = {
          statePath: '/tmp/fake-state.json',
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

        const fixture = {
          sessionId: 's1',
          status: 'completed' as const,
          error: null,
          structuredOutput: {},
          resultSubtype: 'success',
          events: [],
        };

        const phaseConfig = {
          prompt: 'test',
          allowedTools: [] as string[],
          permissionMode: 'bypassPermissions' as const,
          maxTurns: 1,
          effort: 'low' as const,
          model: 'sonnet' as const,
          mcpServers: {},
        };

        const runner = runPhaseWithFixture(phaseConfig, fixture, fakeStore);
        await runner({
          phaseName: 'planner',
          prompt: 'test prompt',
          schema: { type: 'object' } as any,
          allowedTools: [],
        });

        if (!Array.isArray(capturedPhases) || capturedPhases.length !== 1) {
          throw new Error(`expected phases.length === 1, got ${capturedPhases.length}`);
        }
        const phase0 = capturedPhases[0]!;
        if (phase0.status !== 'completed') {
          throw new Error(`expected phases[0].status === 'completed', got '${phase0.status}'`);
        }
        if (phase0.session_id !== 's1') {
          throw new Error(`expected phases[0].session_id === 's1', got '${phase0.session_id}'`);
        }
        if (capturedHistory.length !== 2) {
          throw new Error(`expected history.length === 2, got ${capturedHistory.length}`);
        }

        console.log(`PASS ${name}`);
      } finally {
        await repo.cleanup();
      }
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL adapter-store-writes: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
