// engine-design.md §8, §11 — feature-dev workflow as XState v5 machine (Epic B.1)

import { assign, fromPromise, setup } from 'xstate';
import { defineWorkflow } from '../defineWorkflow.js';
import { harnyActions } from '../harnyActions.js';
import type { Plan, PlanTask } from '../../types.js';

interface FeatureDevContext {
  cwd: string;
  userPrompt: string;
  maxRetries: number;
  plan: Plan | null;
  currentTaskIdx: number;
  attempts: number;
  iterationsThisTask: number;
  iterationsGlobal: number;
  validatorSession?: string;
  devSession?: string;
  lastValidatorVerdict?: 'pass' | 'fail' | 'blocked';
}

const machine = setup({
  types: {} as {
    context: FeatureDevContext;
    input: { cwd: string; userPrompt: string; maxRetries?: number };
  },
  actors: {
    plannerActor: fromPromise<Plan, { prompt: string; cwd: string }>(
      async () => { throw new Error('not wired'); },
    ),
    developerActor: fromPromise<{ session_id?: string }, { task: PlanTask; cwd: string; resumeSessionId?: string }>(
      async () => { throw new Error('not wired'); },
    ),
    validatorActor: fromPromise<
      { verdict: 'pass' | 'fail' | 'blocked'; session_id?: string },
      { task: PlanTask; cwd: string; resumeSessionId?: string }
    >(
      async () => { throw new Error('not wired'); },
    ),
  },
  actions: {
    // TODO: remove casts when PlanDrivenContext.plan becomes Plan | null
    advanceTask: harnyActions.advanceTask as any,
    bumpAttempts: harnyActions.bumpAttempts as any,
    stashValidator: harnyActions.stashValidator as any,
    stashDevSession: harnyActions.stashDevSession as any,
    assignLastVerdict: assign(({ event }: { context: FeatureDevContext; event: any }) => ({
      lastValidatorVerdict: event.output.verdict as 'pass' | 'fail' | 'blocked',
    })),
    commit: () => { /* placeholder: real git commit wired in B.2 */ },
  },
}).createMachine({
  id: 'feature-dev-engine',
  initial: 'planning',
  context: ({ input }) => ({
    cwd: input.cwd,
    userPrompt: input.userPrompt,
    maxRetries: input.maxRetries ?? 3,
    plan: null,
    currentTaskIdx: 0,
    attempts: 0,
    iterationsThisTask: 0,
    iterationsGlobal: 0,
  }),
  states: {
    planning: {
      invoke: {
        src: 'plannerActor',
        input: ({ context }) => ({ prompt: context.userPrompt, cwd: context.cwd }),
        onDone: {
          actions: assign({ plan: ({ event }) => event.output }),
          target: 'loop',
        },
        onError: { target: '#feature-dev-engine.failed' },
      },
    },
    loop: {
      initial: 'developer',
      states: {
        developer: {
          invoke: {
            src: 'developerActor',
            input: ({ context }) => ({
              task: context.plan!.tasks[context.currentTaskIdx]!,
              cwd: context.cwd,
              resumeSessionId: context.devSession,
            }),
            onDone: {
              actions: ['stashDevSession'],
              target: 'validator',
            },
            onError: { target: 'failed' },
          },
        },
        validator: {
          invoke: {
            src: 'validatorActor',
            input: ({ context }) => ({
              task: context.plan!.tasks[context.currentTaskIdx]!,
              cwd: context.cwd,
              resumeSessionId: context.validatorSession,
            }),
            onDone: [
              {
                guard: ({ event }) => event.output.verdict === 'pass',
                target: 'next',
                actions: ['stashValidator', 'assignLastVerdict', 'commit'],
              },
              {
                guard: ({ context, event }) =>
                  event.output.verdict === 'fail' && context.attempts < context.maxRetries,
                target: 'developer',
                actions: ['stashValidator', 'assignLastVerdict', 'bumpAttempts'],
              },
              {
                target: 'failed',
                actions: ['stashValidator', 'assignLastVerdict'],
              },
            ],
            onError: { target: 'failed' },
          },
        },
        next: {
          entry: 'advanceTask',
          always: [
            {
              guard: ({ context }) =>
                context.currentTaskIdx >= (context.plan?.tasks.length ?? 0),
              target: '#feature-dev-engine.done',
            },
            { target: 'developer' },
          ],
        },
        failed: {
          always: { target: '#feature-dev-engine.failed' },
        },
      },
    },
    done: { type: 'final' },
    failed: { type: 'final' },
  },
});

export default defineWorkflow({
  id: 'feature-dev-engine',
  needsBranch: true,
  needsWorktree: true,
  machine,
});
