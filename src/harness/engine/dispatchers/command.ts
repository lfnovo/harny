// engine-design.md §8, §4.4, §9.1.1

import { fromPromise } from 'xstate';
import type { CommandActorOptions } from '../types.js';

// Wraps Bun.spawn as an XState fromPromise actor.
// advisory: true causes onError to be caught internally so post-nodes don't fail the run (§4.4).
// idempotent: false causes the runtime to refuse re-invocation after snapshot restore (§9.1.1).
export function commandActor(options: CommandActorOptions): ReturnType<typeof fromPromise> {
  throw new Error('not implemented');
}
