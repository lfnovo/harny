// feature-dev workflow as XState v5 machine

import { assign, fromPromise, setup } from 'xstate';
import { defineWorkflow } from '../defineWorkflow.js';
import { composeCommitMessage } from '../../workflows/composeCommit.js';
import { buildFeatureDevActors } from './featureDevActors.js';
import { harnyActions } from '../harnyActions.js';
import type { Plan, PlanTask } from '../../types.js';

interface FeatureDevContext {
  cwd: string;
  taskSlug: string;
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
  lastDevCommitMessage: string;
  lastValidatorReasons: string[];
  commitSha?: string;
  error?: string;
}

const machine = setup({
  types: {} as {
    context: FeatureDevContext;
    input: { cwd: string; userPrompt: string; taskSlug: string; maxRetries?: number };
  },
  actors: {
    plannerActor: fromPromise<Plan, { prompt: string; cwd: string }>(
      async () => { throw new Error('not wired'); },
    ),
    developerActor: fromPromise<
      { session_id: string; status: 'done' | 'blocked'; commit_message: string },
      { task: PlanTask; cwd: string; resumeSessionId?: string; attempt?: number }
    >(
      async () => { throw new Error('not wired'); },
    ),
    validatorActor: fromPromise<
      { verdict: 'pass' | 'fail' | 'blocked'; session_id: string; reasons: string[] },
      { task: PlanTask; cwd: string; resumeSessionId?: string; attempt?: number }
    >(
      async () => { throw new Error('not wired'); },
    ),
    commitActor: fromPromise<{ sha: string | null }, { cwd: string; message: string; validatorAttempt: number }>(
      async () => { throw new Error('not wired'); },
    ),
    // Persists the plan produced by plannerActor to .harny/<slug>/plan.json.
    // Separate state because it's a disk write that can fail and we want that
    // failure to cleanly route to 'failed' without corrupting in-memory state.
    persistPlanActor: fromPromise<void, { cwd: string; taskSlug: string; plan: Plan }>(
      async () => { throw new Error('not wired'); },
    ),
  },
  actions: {
    // The `(event as any).output` access in stash* / assignLastVerdict is
    // the honest shape of XState v5 named actions: events widen to
    // AnyEventObject because a named action can be referenced from any
    // transition. harnyActions uses the same pattern.
    advanceTask: assign(({ context }) => ({
      currentTaskIdx: context.currentTaskIdx + 1,
      attempts: 0,
      iterationsThisTask: 0,
    })),
    bumpAttempts: assign(({ context }) => ({
      attempts: context.attempts + 1,
      iterationsThisTask: context.iterationsThisTask + 1,
      iterationsGlobal: context.iterationsGlobal + 1,
    })),
    stashValidator: harnyActions.stashValidator as any,
    stashDevSession: harnyActions.stashDevSession as any,
    stashDevCommitMessage: assign(({ event }) => ({
      lastDevCommitMessage: (event as any).output?.commit_message ?? '',
    })),
    stashValidatorReasons: assign(({ event }) => ({
      lastValidatorReasons: (event as any).output?.reasons ?? [],
    })),
    assignLastVerdict: assign(({ event }) => ({
      lastValidatorVerdict: (event as any).output.verdict as 'pass' | 'fail' | 'blocked',
    })),
  },
}).createMachine({
  id: 'feature-dev',
  initial: 'planning',
  context: ({ input }) => ({
    cwd: input.cwd,
    taskSlug: input.taskSlug,
    userPrompt: input.userPrompt,
    maxRetries: input.maxRetries ?? 3,
    plan: null,
    currentTaskIdx: 0,
    attempts: 0,
    iterationsThisTask: 0,
    iterationsGlobal: 0,
    lastDevCommitMessage: '',
    lastValidatorReasons: [],
  }),
  states: {
    planning: {
      invoke: {
        src: 'plannerActor',
        input: ({ context }) => ({ prompt: context.userPrompt, cwd: context.cwd }),
        onDone: {
          actions: assign({ plan: ({ event }) => event.output }),
          target: 'persistingPlan',
        },
        onError: {
          target: '#feature-dev.failed',
          actions: assign({ error: ({ event }) => `planner: ${String((event as { error?: unknown }).error)}` }),
        },
      },
    },
    persistingPlan: {
      invoke: {
        src: 'persistPlanActor',
        input: ({ context }) => ({
          cwd: context.cwd,
          taskSlug: context.taskSlug,
          plan: context.plan!,
        }),
        onDone: { target: 'loop' },
        onError: {
          target: '#feature-dev.failed',
          actions: assign({ error: ({ event }) => `persistPlan: ${String((event as { error?: unknown }).error)}` }),
        },
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
              attempt: context.attempts + 1,
            }),
            onDone: [
              {
                guard: ({ event }) => event.output.status === 'blocked',
                target: 'failed',
                actions: assign({ error: ({ context }) => `developer blocked on task ${context.plan?.tasks[context.currentTaskIdx]?.id ?? '?'}` }),
              },
              {
                actions: ['stashDevSession', 'stashDevCommitMessage'],
                target: 'validator',
              },
            ],
            onError: {
              target: 'failed',
              actions: assign({ error: ({ event }) => `developer: ${String((event as { error?: unknown }).error)}` }),
            },
          },
        },
        validator: {
          invoke: {
            src: 'validatorActor',
            input: ({ context }) => ({
              task: context.plan!.tasks[context.currentTaskIdx]!,
              cwd: context.cwd,
              resumeSessionId: context.validatorSession,
              attempt: context.attempts + 1,
            }),
            onDone: [
              {
                guard: ({ event }) => event.output.verdict === 'pass',
                target: 'committing',
                actions: ['stashValidator', 'assignLastVerdict', 'stashValidatorReasons'],
              },
              {
                guard: ({ context, event }) =>
                  event.output.verdict === 'fail' && context.attempts < context.maxRetries,
                target: 'developer',
                actions: ['stashValidator', 'assignLastVerdict', 'bumpAttempts'],
              },
              {
                target: 'failed',
                actions: [
                  'stashValidator',
                  'assignLastVerdict',
                  assign({ error: ({ context, event }) => `validator: ${event.output.verdict} after ${context.attempts + 1} attempt(s) on task ${context.plan?.tasks[context.currentTaskIdx]?.id ?? '?'}; reasons: ${event.output.reasons.join('; ')}` }),
                ],
              },
            ],
            onError: {
              target: 'failed',
              actions: assign({ error: ({ event }) => `validator: ${String((event as { error?: unknown }).error)}` }),
            },
          },
        },
        committing: {
          invoke: {
            src: 'commitActor',
            input: ({ context }) => ({
              cwd: context.cwd,
              message: composeCommitMessage({
                devMessage: context.lastDevCommitMessage,
                taskId: context.plan!.tasks[context.currentTaskIdx]!.id,
                role: 'validator',
                evidence: context.lastValidatorReasons.join('; '),
              }),
              validatorAttempt: context.attempts + 1,
            }),
            onDone: {
              // event.output.sha is null when the developer reported done but
              // produced no diff (verified-only task) — see gitCommit. Skip the
              // commitSha update in that case but still advance to the next task.
              actions: assign({ commitSha: ({ event, context }) => event.output.sha ?? context.commitSha }),
              target: 'next',
            },
            onError: {
              target: 'failed',
              actions: assign({ error: ({ event }) => `committing: ${String((event as { error?: unknown }).error)}` }),
            },
          },
        },
        next: {
          entry: 'advanceTask',
          always: [
            {
              guard: ({ context }) =>
                context.currentTaskIdx >= (context.plan?.tasks.length ?? 0),
              target: '#feature-dev.done',
            },
            { target: 'developer' },
          ],
        },
        failed: {
          always: { target: '#feature-dev.failed' },
        },
      },
    },
    done: { type: 'final' },
    failed: { type: 'final' },
  },
});

export default defineWorkflow({
  id: 'feature-dev',
  needsBranch: true,
  needsWorktree: true,
  machine,
  buildActors: buildFeatureDevActors,
});
