import { fromPromise } from 'xstate';
import type { HumanReviewOutput, HumanReviewRunOptions } from '../types.js';

export async function runHumanReview(
  opts: HumanReviewRunOptions,
  signal: AbortSignal,
): Promise<HumanReviewOutput> {
  if (signal.aborted) {
    throw new Error('humanReview aborted');
  }

  let abortReject!: (err: Error) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    abortReject = reject;
  });

  const abortHandler = () => abortReject(new Error('humanReview aborted'));
  signal.addEventListener('abort', abortHandler);

  try {
    return await Promise.race([
      opts.askProvider({ message: opts.message, options: opts.options, signal }),
      abortPromise,
    ]);
  } finally {
    signal.removeEventListener('abort', abortHandler);
  }
}

export const humanReviewActor = fromPromise<HumanReviewOutput, HumanReviewRunOptions>(
  ({ input, signal }) => runHumanReview(input, signal),
);

// Actor logic — for setup({ actors }) composition in workflows.
export const humanReviewActorLogic = humanReviewActor;
