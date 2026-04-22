// engine-design.md §8, §9.1.1

import { fromPromise } from 'xstate';
import type { AgentActorOptions } from '../types.js';

// Wraps runPhase (Anthropic SDK) as an XState fromPromise actor.
// On snapshot restore, reads prior session_id from state.json and passes resumeSessionId
// to the SDK so the session continues without re-burning tokens (§9.1.1).
export function agentActor(options: AgentActorOptions): ReturnType<typeof fromPromise> {
  throw new Error('not implemented');
}
