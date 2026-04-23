/**
 * Probe: real-runphase-adapter — 3 scenarios, each raced 1500ms, whole probe under 5s.
 * Uses injected mock; never calls the real SDK.
 *
 * RUN
 *   bun scripts/probes/engine/08-real-runphase-adapter.ts
 */

import {
  adaptRunPhase,
  type AgentRunOptionsSubset,
} from '../../../src/harness/engine/runtime/runPhaseAdapter.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

const mockSessionId = 'mock-session-abc123';
const mockOutput = { result: 'success', value: 42 };

type CaptureBox = { args: Record<string, unknown> | null };

function makeMockRunPhase(capture?: CaptureBox) {
  return async (args: Record<string, unknown>) => {
    if (capture) {
      capture.args = args;
    }
    return {
      sessionId: mockSessionId,
      status: 'completed' as const,
      error: null,
      structuredOutput: mockOutput,
      resultSubtype: 'success',
      events: [],
    };
  };
}

const mockDeps = {
  cwd: '/tmp/test-cwd',
  workflowId: 'test-workflow',
  taskSlug: 'test-task',
  runId: 'run-001',
  phaseConfig: {
    prompt: 'test prompt',
    allowedTools: ['Read', 'Glob'],
    permissionMode: 'bypassPermissions' as const,
    maxTurns: 50,
    effort: 'high' as const,
    model: 'sonnet' as const,
    mcpServers: {},
  },
  mode: 'silent' as const,
  logMode: 'compact' as const,
};

const validEngineArgs: AgentRunOptionsSubset = {
  phaseName: 'developer',
  prompt: 'do the thing',
  schema: { type: 'object' },
  allowedTools: ['Bash', 'Read'],
};

let failures = 0;

// Scenario 1: shape — adaptRunPhase returns a function; calling it returns a resolving Promise
try {
  await Promise.race([
    (async () => {
      const name = 'shape';
      const fn = adaptRunPhase({ ...mockDeps, sessionRunPhase: makeMockRunPhase() });
      if (typeof fn !== 'function') {
        throw new Error(`adaptRunPhase returned ${typeof fn}, expected function`);
      }
      const promise = fn(validEngineArgs);
      if (typeof (promise as any)?.then !== 'function') {
        throw new Error('fn(engineArgs) did not return a Promise');
      }
      await promise;
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL shape: ${e.message}`);
  failures++;
}

// Scenario 2: mapping — returned fn calls sessionRunPhase with correct translated args
try {
  await Promise.race([
    (async () => {
      const name = 'mapping';
      const capture: CaptureBox = { args: null };
      const fn = adaptRunPhase({ ...mockDeps, sessionRunPhase: makeMockRunPhase(capture) as any });
      await fn(validEngineArgs);

      const a = capture.args;
      if (!a) throw new Error('sessionRunPhase was not called');

      const phaseConfig = a['phaseConfig'] as Record<string, unknown>;
      const checks: [string, unknown, unknown][] = [
        ['phase', a['phase'], validEngineArgs.phaseName],
        ['primaryCwd', a['primaryCwd'], mockDeps.cwd],
        ['phaseCwd', a['phaseCwd'], mockDeps.cwd],
        ['taskSlug', a['taskSlug'], mockDeps.taskSlug],
        ['workflowId', a['workflowId'], mockDeps.workflowId],
        ['prompt', a['prompt'], validEngineArgs.prompt],
        [
          'allowedTools',
          JSON.stringify(phaseConfig?.['allowedTools']),
          JSON.stringify(validEngineArgs.allowedTools),
        ],
        ['outputSchema', a['outputSchema'], validEngineArgs.schema],
      ];

      for (const [field, actual, expected] of checks) {
        if (actual !== expected) {
          throw new Error(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      }

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL mapping: ${e.message}`);
  failures++;
}

// Scenario 3: passthrough — output and session_id match what the mock returned
try {
  await Promise.race([
    (async () => {
      const name = 'passthrough';
      const fn = adaptRunPhase({ ...mockDeps, sessionRunPhase: makeMockRunPhase() });
      const result = await fn(validEngineArgs);

      if (result.session_id !== mockSessionId) {
        throw new Error(`session_id: expected ${mockSessionId}, got ${result.session_id}`);
      }
      if (JSON.stringify(result.output) !== JSON.stringify(mockOutput)) {
        throw new Error(
          `output: expected ${JSON.stringify(mockOutput)}, got ${JSON.stringify(result.output)}`,
        );
      }

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL passthrough: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
