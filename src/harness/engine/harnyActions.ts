// engine-design.md §8.2

import { assign } from 'xstate';

// Effect actions (commit/resetTree/cleanUntracked) are placeholders overridden by the
// harny runtime via machine.provide(). Pure-state actions (advanceTask/bumpAttempts/etc)
// are the real implementation and use XState assign.
export const harnyActions = {
  commit: (): void => {
    throw new Error('harny runtime not provided');
  },
  resetTree: (): void => {
    throw new Error('harny runtime not provided');
  },
  cleanUntracked: (): void => {
    throw new Error('harny runtime not provided');
  },
  advanceTask: assign(({ context }: { context: any; event: any }) => ({
    currentTaskIdx: (context.currentTaskIdx as number) + 1,
  })),
  bumpAttempts: assign(({ context }: { context: any; event: any }) => ({
    attempts: (context.attempts as number) + 1,
  })),
  stashValidator: assign((_args: { context: any; event: any }) => ({
    validatorResult: null as unknown,
  })),
  stashDevSession: assign((_args: { context: any; event: any }) => ({
    devSession: null as unknown,
  })),
};
