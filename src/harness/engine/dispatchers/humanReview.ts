// engine-design.md §7, §8

import { fromPromise } from 'xstate';
import type { HumanReviewActorOptions } from '../types.js';

// Wraps the harny parking mechanism as an XState fromPromise actor.
// interactive: TTY readline. silent: throws SilentModeError. async: persists pending_question
// + XState snapshot and exits with status waiting_human (§7.3).
// When previousAnswer is provided (resume path), resolves immediately (§7, §9.3).
export function humanReviewActor(options: HumanReviewActorOptions): ReturnType<typeof fromPromise> {
  throw new Error('not implemented');
}
