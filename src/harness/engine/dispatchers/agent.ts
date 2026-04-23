// engine-design.md §8, §8.4, §9.1.1

import { fromPromise } from 'xstate';
import type { AgentRunOptions } from '../types.js';

// §8.4 convention: plain async fn for abort testing + fromPromise wrapper for XState.
// §9.1.1 idempotency seam: caller passes resumeSessionId from state.json on restart.
export async function runAgent(
  options: AgentRunOptions,
  signal: AbortSignal,
): Promise<{ output: unknown; session_id: string }> {
  if (signal.aborted) {
    throw new Error('agent aborted');
  }

  let abortReject!: (err: Error) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });

  const abortHandler = () => abortReject(new Error('agent aborted'));
  signal.addEventListener('abort', abortHandler);

  try {
    return await Promise.race([
      options.runPhase({
        phaseName: options.phaseName,
        prompt: options.prompt,
        schema: options.schema,
        allowedTools: options.allowedTools,
        resumeSessionId: options.resumeSessionId,
        signal,
      }),
      abortPromise,
    ]);
  } finally {
    signal.removeEventListener('abort', abortHandler);
  }
}

export const agentActor = fromPromise<
  { output: unknown; session_id: string },
  AgentRunOptions
>(({ input, signal }) => runAgent(input, signal));

// Actor logic — for setup({ actors }) composition in workflows.
export const agentActorLogic = agentActor;
