/**
 * Probe: agentActor — four scenarios with 1500ms hard deadline per scenario, whole probe under 8s.
 *
 * RUN
 *   bun scripts/probes/engine/02-agent-actor.ts
 */

import { runAgent } from '../../../src/harness/engine/dispatchers/agent.ts';
import type { AgentRunOptions } from '../../../src/harness/engine/types.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

function baseOptions(
  runPhase: AgentRunOptions['runPhase'],
  overrides?: Partial<AgentRunOptions>,
): AgentRunOptions {
  return {
    phaseName: 'test-phase',
    prompt: 'test prompt',
    schema: { type: 'object' },
    allowedTools: [],
    runPhase,
    ...overrides,
  };
}

let failures = 0;

// Scenario 1: success — inject runPhase that resolves with known output
{
  const name = 'success';
  try {
    const controller = new AbortController();
    const expected = { output: { ok: true }, session_id: 'sess-1' };
    const result = await Promise.race([
      runAgent(
        baseOptions(() => Promise.resolve(expected)),
        controller.signal,
      ),
      hardDeadline(),
    ]);
    if (
      (result as any).session_id === expected.session_id &&
      (result as any).output &&
      (result as any).output.ok === true
    ) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: unexpected result ${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

// Scenario 2: resume — inject runPhase that asserts it received resumeSessionId='prev-sess'
{
  const name = 'resume';
  try {
    const controller = new AbortController();
    let receivedResumeId: string | undefined;
    const runPhase: AgentRunOptions['runPhase'] = (args) => {
      receivedResumeId = args.resumeSessionId;
      return Promise.resolve({ output: { resumed: true }, session_id: 'sess-2' });
    };
    await Promise.race([
      runAgent(baseOptions(runPhase, { resumeSessionId: 'prev-sess' }), controller.signal),
      hardDeadline(),
    ]);
    if (receivedResumeId === 'prev-sess') {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected resumeSessionId='prev-sess', got ${JSON.stringify(receivedResumeId)}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

// Scenario 3: abort — inject runPhase that parks; abort after 50ms; assert rejection with 'aborted'
{
  const name = 'abort';
  const controller = new AbortController();
  const runPhase: AgentRunOptions['runPhase'] = ({ signal }) =>
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('inner aborted')));
    });
  setTimeout(() => controller.abort(), 50);
  try {
    await Promise.race([
      runAgent(baseOptions(runPhase), controller.signal),
      hardDeadline(),
    ]);
    console.log(`FAIL ${name}: should have thrown`);
    failures++;
  } catch (e: any) {
    if (e.message.includes('hard deadline')) {
      console.log(`FAIL ${name}: hard deadline exceeded`);
      failures++;
    } else if (e.message.includes('aborted')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: wrong error: ${e.message}`);
      failures++;
    }
  }
}

// Scenario 4: error — inject runPhase that rejects; assert rejection preserves original error
{
  const name = 'error';
  try {
    const controller = new AbortController();
    const runPhase: AgentRunOptions['runPhase'] = () => Promise.reject(new Error('SDK boom'));
    await Promise.race([
      runAgent(baseOptions(runPhase), controller.signal),
      hardDeadline(),
    ]);
    console.log(`FAIL ${name}: should have thrown`);
    failures++;
  } catch (e: any) {
    if (e.message.includes('hard deadline')) {
      console.log(`FAIL ${name}: hard deadline exceeded`);
      failures++;
    } else if (e.message.includes('SDK boom')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: wrong error: ${e.message}`);
      failures++;
    }
  }
}

process.exit(failures > 0 ? 1 : 0);
