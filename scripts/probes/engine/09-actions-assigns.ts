/**
 * Probe: actions-assigns — runtime verification of PlanDrivenContext assigns.
 * 4 scenarios, each raced 1500ms, whole probe under 4s.
 *
 * RUN
 *   bun scripts/probes/engine/09-actions-assigns.ts
 */

import { createActor, setup } from 'xstate';
import { harnyActions } from '../../../src/harness/engine/harnyActions.ts';
import type { PlanDrivenContext } from '../../../src/harness/engine/types.ts';
import type { Plan } from '../../../src/harness/types.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

const stubPlan: Plan = {
  schema_version: 1,
  task_slug: 'test',
  user_prompt: 'test',
  branch: 'test',
  primary_cwd: '/tmp',
  isolation: 'inline',
  worktree_path: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  status: 'in_progress',
  summary: '',
  iterations_global: 0,
  tasks: [],
  metadata: {},
};

let failures = 0;

// Scenario 1: advanceTask — increments currentTaskIdx, resets attempts and iterationsThisTask
try {
  await Promise.race([
    (async () => {
      const name = 'advanceTask';
      const machine = setup({
        types: {} as {
          context: PlanDrivenContext;
          events: { type: 'ADVANCE' };
        },
        actions: {
          advanceTask: harnyActions.advanceTask,
        },
      }).createMachine({
        context: {
          plan: stubPlan,
          currentTaskIdx: 0,
          attempts: 3,
          iterationsThisTask: 2,
          iterationsGlobal: 5,
        },
        initial: 'idle',
        states: {
          idle: {
            on: { ADVANCE: { target: 'done', actions: 'advanceTask' } },
          },
          done: { type: 'final' },
        },
      });

      const actor = createActor(machine);
      actor.start();
      actor.send({ type: 'ADVANCE' });
      const ctx = actor.getSnapshot().context;

      if (ctx.currentTaskIdx !== 1) throw new Error(`currentTaskIdx: expected 1, got ${ctx.currentTaskIdx}`);
      if (ctx.attempts !== 0) throw new Error(`attempts: expected 0, got ${ctx.attempts}`);
      if (ctx.iterationsThisTask !== 0) throw new Error(`iterationsThisTask: expected 0, got ${ctx.iterationsThisTask}`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL advanceTask: ${e.message}`);
  failures++;
}

// Scenario 2: bumpAttempts — increments attempts, iterationsThisTask, iterationsGlobal each by 1
try {
  await Promise.race([
    (async () => {
      const name = 'bumpAttempts';
      const machine = setup({
        types: {} as {
          context: PlanDrivenContext;
          events: { type: 'BUMP' };
        },
        actions: {
          bumpAttempts: harnyActions.bumpAttempts,
        },
      }).createMachine({
        context: {
          plan: stubPlan,
          currentTaskIdx: 0,
          attempts: 0,
          iterationsThisTask: 0,
          iterationsGlobal: 0,
        },
        initial: 'idle',
        states: {
          idle: {
            on: { BUMP: { target: 'done', actions: 'bumpAttempts' } },
          },
          done: { type: 'final' },
        },
      });

      const actor = createActor(machine);
      actor.start();
      actor.send({ type: 'BUMP' });
      const ctx = actor.getSnapshot().context;

      if (ctx.attempts !== 1) throw new Error(`attempts: expected 1, got ${ctx.attempts}`);
      if (ctx.iterationsThisTask !== 1) throw new Error(`iterationsThisTask: expected 1, got ${ctx.iterationsThisTask}`);
      if (ctx.iterationsGlobal !== 1) throw new Error(`iterationsGlobal: expected 1, got ${ctx.iterationsGlobal}`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL bumpAttempts: ${e.message}`);
  failures++;
}

// Scenario 3: stashValidator — stores session_id from event.output into validatorSession
try {
  await Promise.race([
    (async () => {
      const name = 'stashValidator';
      const machine = setup({
        types: {} as {
          context: PlanDrivenContext;
          events: { type: 'STASH_VALIDATOR'; output: { session_id: string } };
        },
        actions: {
          stashValidator: harnyActions.stashValidator,
        },
      }).createMachine({
        context: {
          plan: stubPlan,
          currentTaskIdx: 0,
          attempts: 0,
          iterationsThisTask: 0,
          iterationsGlobal: 0,
        },
        initial: 'idle',
        states: {
          idle: {
            on: { STASH_VALIDATOR: { target: 'done', actions: 'stashValidator' } },
          },
          done: { type: 'final' },
        },
      });

      const actor = createActor(machine);
      actor.start();
      actor.send({ type: 'STASH_VALIDATOR', output: { session_id: 'val-sess-1' } });
      const ctx = actor.getSnapshot().context;

      if (ctx.validatorSession !== 'val-sess-1') throw new Error(`validatorSession: expected 'val-sess-1', got ${ctx.validatorSession}`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL stashValidator: ${e.message}`);
  failures++;
}

// Scenario 4: stashDevSession — stores session_id from event.output into devSession
try {
  await Promise.race([
    (async () => {
      const name = 'stashDevSession';
      const machine = setup({
        types: {} as {
          context: PlanDrivenContext;
          events: { type: 'STASH_DEV'; output: { session_id: string } };
        },
        actions: {
          stashDevSession: harnyActions.stashDevSession,
        },
      }).createMachine({
        context: {
          plan: stubPlan,
          currentTaskIdx: 0,
          attempts: 0,
          iterationsThisTask: 0,
          iterationsGlobal: 0,
        },
        initial: 'idle',
        states: {
          idle: {
            on: { STASH_DEV: { target: 'done', actions: 'stashDevSession' } },
          },
          done: { type: 'final' },
        },
      });

      const actor = createActor(machine);
      actor.start();
      actor.send({ type: 'STASH_DEV', output: { session_id: 'dev-sess-2' } });
      const ctx = actor.getSnapshot().context;

      if (ctx.devSession !== 'dev-sess-2') throw new Error(`devSession: expected 'dev-sess-2', got ${ctx.devSession}`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL stashDevSession: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
