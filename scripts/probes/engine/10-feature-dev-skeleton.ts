/**
 * Probe: feature-dev-engine skeleton — 4 scenarios using mock actors.
 * Each raced 1500ms, whole probe under 6s.
 *
 * RUN
 *   bun scripts/probes/engine/10-feature-dev-skeleton.ts
 */

import { createActor, fromPromise } from 'xstate';
import featureDevWorkflow from '../../../src/harness/engine/workflows/featureDev.ts';
import type { Plan, PlanTask } from '../../../src/harness/types.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

function makeTaskMock(id: string): PlanTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for ${id}`,
    acceptance: [],
    status: 'pending',
    attempts: 0,
    commit_sha: null,
    history: [],
  };
}

function makePlanMock(tasks: PlanTask[]): Plan {
  return {
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
    tasks,
    metadata: {},
  };
}

const { machine } = featureDevWorkflow;

let failures = 0;

// Scenario 1: happy-path — planner returns 2-task plan, dev+validator pass first try for each
try {
  await Promise.race([
    (async () => {
      const name = 'happy-path';
      const plan = makePlanMock([makeTaskMock('t1'), makeTaskMock('t2')]);

      const provided = machine.provide({
        actors: {
          plannerActor: fromPromise(async () => plan) as any,
          developerActor: fromPromise(async () => ({ session_id: 'dev' })) as any,
          validatorActor: fromPromise(async () => ({ verdict: 'pass' as const, session_id: 'val' })) as any,
        },
      });

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'test', maxRetries: 3 } });
        actor.subscribe((s) => {
          if (s.status === 'done') resolve(s);
        });
        actor.start();
      });

      if (snapshot.value !== 'done') {
        throw new Error(`expected state 'done', got '${JSON.stringify(snapshot.value)}'`);
      }
      if (snapshot.context.currentTaskIdx !== 2) {
        throw new Error(`expected currentTaskIdx 2, got ${snapshot.context.currentTaskIdx}`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL happy-path: ${e.message}`);
  failures++;
}

// Scenario 2: validator-fail-retry — validator fails once then passes; assert done + currentTaskIdx===1
try {
  await Promise.race([
    (async () => {
      const name = 'validator-fail-retry';
      const plan = makePlanMock([makeTaskMock('t1')]);
      let valCallCount = 0;

      const provided = machine.provide({
        actors: {
          plannerActor: fromPromise(async () => plan) as any,
          developerActor: fromPromise(async () => ({ session_id: 'dev' })) as any,
          validatorActor: fromPromise(async () => {
            valCallCount++;
            return { verdict: valCallCount === 1 ? ('fail' as const) : ('pass' as const), session_id: 'val' };
          }) as any,
        },
      });

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'test', maxRetries: 3 } });
        actor.subscribe((s) => {
          if (s.status === 'done') resolve(s);
        });
        actor.start();
      });

      if (snapshot.value !== 'done') {
        throw new Error(`expected state 'done', got '${JSON.stringify(snapshot.value)}'`);
      }
      // advanceTask resets attempts to 0; use currentTaskIdx as evidence that one task advanced after a retry
      if (snapshot.context.currentTaskIdx !== 1) {
        throw new Error(`expected currentTaskIdx 1, got ${snapshot.context.currentTaskIdx}`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL validator-fail-retry: ${e.message}`);
  failures++;
}

// Scenario 3: validator-fail-exhausts — validator always fails; maxRetries=3 → machine reaches 'failed'
try {
  await Promise.race([
    (async () => {
      const name = 'validator-fail-exhausts';
      const plan = makePlanMock([makeTaskMock('t1')]);

      const provided = machine.provide({
        actors: {
          plannerActor: fromPromise(async () => plan) as any,
          developerActor: fromPromise(async () => ({ session_id: 'dev' })) as any,
          validatorActor: fromPromise(async () => ({ verdict: 'fail' as const, session_id: 'val' })) as any,
        },
      });

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'test', maxRetries: 3 } });
        actor.subscribe((s) => {
          if (s.status === 'done') resolve(s);
        });
        actor.start();
      });

      if (snapshot.value !== 'failed') {
        throw new Error(`expected state 'failed', got '${JSON.stringify(snapshot.value)}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL validator-fail-exhausts: ${e.message}`);
  failures++;
}

// Scenario 4: validator-blocked — validator returns 'blocked'; reaches 'failed' with no retry
try {
  await Promise.race([
    (async () => {
      const name = 'validator-blocked';
      const plan = makePlanMock([makeTaskMock('t1')]);
      let devCallCount = 0;

      const provided = machine.provide({
        actors: {
          plannerActor: fromPromise(async () => plan) as any,
          developerActor: fromPromise(async () => {
            devCallCount++;
            return { session_id: 'dev' };
          }) as any,
          validatorActor: fromPromise(async () => ({ verdict: 'blocked' as const, session_id: 'val' })) as any,
        },
      });

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'test', maxRetries: 3 } });
        actor.subscribe((s) => {
          if (s.status === 'done') resolve(s);
        });
        actor.start();
      });

      if (snapshot.value !== 'failed') {
        throw new Error(`expected state 'failed', got '${JSON.stringify(snapshot.value)}'`);
      }
      if (devCallCount !== 1) {
        throw new Error(`expected 1 developer invocation (no retry on blocked), got ${devCallCount}`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL validator-blocked: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
