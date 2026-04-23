/**
 * Probe: feature-dev-engine skeleton — 9 scenarios using mock actors.
 * Scenarios 1-4: mock actors only. Scenario 5: real-planner-shape (no invocation).
 * Scenario 6: real-planner-mock-injection (mock sessionRunPhase).
 * Scenario 7: real-developer-mock-injection (all three actors via buildFeatureDevActors).
 * Scenario 8: real-validator-blocks-machine (validator 'blocked' → machine 'failed').
 * Scenario 9: commit-after-validator-pass (asserts commit message composition end-to-end).
 * Each raced 1500ms–3000ms, whole probe under 12s.
 *
 * RUN
 *   bun scripts/probes/engine/10-feature-dev-skeleton.ts
 */

import { createActor, fromPromise } from 'xstate';
import featureDevWorkflow from '../../../src/harness/engine/workflows/featureDev.ts';
import { buildFeatureDevActors } from '../../../src/harness/engine/workflows/featureDevActors.ts';
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
          commitActor: fromPromise(async () => ({ sha: 'mock-sha' })) as any,
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
          commitActor: fromPromise(async () => ({ sha: 'mock-sha' })) as any,
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

// Scenario 5: real-planner-shape — assert plannerActor from buildFeatureDevActors is a valid actor logic object
try {
  await Promise.race([
    (async () => {
      const name = 'real-planner-shape';
      const actors = buildFeatureDevActors({ cwd: '/tmp', taskSlug: 'probe', runId: 'probe-uuid', mode: 'silent' as const, logMode: 'compact' as const, variant: 'default' });

      if (!actors.plannerActor || typeof actors.plannerActor !== 'object') {
        throw new Error('plannerActor is not an object');
      }
      // fromPromise returns ActorLogic with a config property referencing the promise fn
      if (typeof (actors.plannerActor as any).config !== 'function') {
        throw new Error('plannerActor.config is not a function — not a valid fromPromise actor');
      }
      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hard deadline exceeded')), 1500)),
  ]);
} catch (e: any) {
  console.log(`FAIL real-planner-shape: ${e.message}`);
  failures++;
}

// Scenario 6: real-planner-mock-injection — inject mock sessionRunPhase, drive machine to 'done'
try {
  await Promise.race([
    (async () => {
      const name = 'real-planner-mock-injection';

      const mockSessionRunPhase = async (_args: unknown) => ({
        status: 'completed' as const,
        structuredOutput: {
          summary: 'Build X',
          tasks: [{ id: 't1', title: 'Task', description: 'Do it', acceptance: ['AC1'] }],
        },
        sessionId: 'mock-sess',
        error: null,
        resultSubtype: null,
        events: [],
      });

      const actors = buildFeatureDevActors({
        cwd: '/tmp',
        taskSlug: 'probe',
        runId: 'probe-uuid',
        sessionRunPhase: mockSessionRunPhase as any,
        mode: 'silent' as const,
        logMode: 'compact' as const,
        variant: 'default',
      });

      const provided = machine.provide({
        actors: {
          plannerActor: actors.plannerActor as any,
          developerActor: fromPromise(async () => ({ session_id: 'dev' })) as any,
          validatorActor: fromPromise(async () => ({ verdict: 'pass' as const, session_id: 'val' })) as any,
          commitActor: fromPromise(async () => ({ sha: 'mock-sha' })) as any,
        },
      });

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'build something', maxRetries: 3 } });
        actor.subscribe((s) => {
          if (s.status === 'done') resolve(s);
        });
        actor.start();
      });

      if (snapshot.value !== 'done') {
        throw new Error(`expected state 'done', got '${JSON.stringify(snapshot.value)}'`);
      }
      if (!snapshot.context.plan) {
        throw new Error('expected context.plan to be set');
      }
      const firstTask: PlanTask | undefined = snapshot.context.plan.tasks[0];
      if (!firstTask) {
        throw new Error('expected at least one task in plan');
      }
      if (firstTask.id !== 't1') {
        throw new Error(`expected tasks[0].id 't1', got '${firstTask.id}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hard deadline exceeded')), 2000)),
  ]);
} catch (e: any) {
  console.log(`FAIL real-planner-mock-injection: ${e.message}`);
  failures++;
}

// Scenario 7: real-developer-mock-injection — all three actors via buildFeatureDevActors with mock
try {
  await Promise.race([
    (async () => {
      const name = 'real-developer-mock-injection';

      let callCount = 0;
      const mockSessionRunPhase = async (_args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 'completed' as const,
            structuredOutput: {
              summary: 'Build X',
              tasks: [{ id: 't1', title: 'Task', description: 'Do it', acceptance: ['AC1'] }],
            },
            sessionId: 'plan-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        } else if (callCount === 2) {
          return {
            status: 'completed' as const,
            structuredOutput: { status: 'done', commit_message: 'feat: synthetic' },
            sessionId: 'dev-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        } else {
          return {
            status: 'completed' as const,
            structuredOutput: { verdict: 'pass', reasons: ['ok'] },
            sessionId: 'val-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        }
      };

      const actors = buildFeatureDevActors({
        cwd: '/tmp',
        taskSlug: 'probe',
        runId: 'probe-uuid',
        sessionRunPhase: mockSessionRunPhase as any,
        gitCommit: async (_opts: { cwd: string; message: string }, _signal: AbortSignal) => ({ sha: 'mock-sha' }),
        mode: 'silent' as const,
        logMode: 'compact' as const,
        variant: 'default',
      });

      const provided = machine.provide({ actors } as any);

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'build something', maxRetries: 3 } });
        actor.subscribe((s) => {
          if (s.status === 'done') resolve(s);
        });
        actor.start();
      });

      if (snapshot.value !== 'done') {
        throw new Error(`expected state 'done', got '${JSON.stringify(snapshot.value)}'`);
      }
      if (snapshot.context.devSession !== 'dev-sess-1') {
        throw new Error(`expected context.devSession 'dev-sess-1', got '${snapshot.context.devSession}'`);
      }
      if (snapshot.context.validatorSession !== 'val-sess-1') {
        throw new Error(`expected context.validatorSession 'val-sess-1', got '${snapshot.context.validatorSession}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hard deadline exceeded')), 2000)),
  ]);
} catch (e: any) {
  console.log(`FAIL real-developer-mock-injection: ${e.message}`);
  failures++;
}

// Scenario 8: real-validator-blocks-machine — validator returns 'blocked', machine reaches 'failed'
try {
  await Promise.race([
    (async () => {
      const name = 'real-validator-blocks-machine';

      let callCount = 0;
      const mockSessionRunPhase = async (_args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 'completed' as const,
            structuredOutput: {
              summary: 'Build X',
              tasks: [{ id: 't1', title: 'Task', description: 'Do it', acceptance: ['AC1'] }],
            },
            sessionId: 'plan-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        } else if (callCount === 2) {
          return {
            status: 'completed' as const,
            structuredOutput: { status: 'done', commit_message: 'feat: x' },
            sessionId: 'dev-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        } else {
          return {
            status: 'completed' as const,
            structuredOutput: { verdict: 'blocked', reasons: ['cannot proceed'] },
            sessionId: 'val-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        }
      };

      const actors = buildFeatureDevActors({
        cwd: '/tmp',
        taskSlug: 'probe',
        runId: 'probe-uuid',
        sessionRunPhase: mockSessionRunPhase as any,
        mode: 'silent' as const,
        logMode: 'compact' as const,
        variant: 'default',
      });

      const provided = machine.provide({ actors } as any);

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'build something', maxRetries: 3 } });
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
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hard deadline exceeded')), 2000)),
  ]);
} catch (e: any) {
  console.log(`FAIL real-validator-blocks-machine: ${e.message}`);
  failures++;
}

// Scenario 9: commit-after-validator-pass — asserts commit message composition end-to-end
try {
  await Promise.race([
    (async () => {
      const name = 'commit-after-validator-pass';

      let callCount = 0;
      const mockSessionRunPhase = async (_args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 'completed' as const,
            structuredOutput: {
              summary: 'Build X',
              tasks: [{ id: 't1', title: 'Task', description: 'Do it', acceptance: ['AC1'] }],
            },
            sessionId: 'plan-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        } else if (callCount === 2) {
          return {
            status: 'completed' as const,
            structuredOutput: { status: 'done', commit_message: 'feat: my-feature' },
            sessionId: 'dev-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        } else {
          return {
            status: 'completed' as const,
            structuredOutput: { verdict: 'pass', reasons: ['looks good'] },
            sessionId: 'val-sess-1',
            error: null,
            resultSubtype: null,
            events: [],
          };
        }
      };

      let gitCommitCallCount = 0;
      let receivedMessage = '';
      const mockGitCommit = async (opts: { cwd: string; message: string }, _signal: AbortSignal) => {
        gitCommitCallCount++;
        receivedMessage = opts.message;
        return { sha: 'aaaa' };
      };

      const actors = buildFeatureDevActors({
        cwd: '/tmp',
        taskSlug: 'probe',
        runId: 'probe-uuid',
        sessionRunPhase: mockSessionRunPhase as any,
        gitCommit: mockGitCommit,
        mode: 'silent' as const,
        logMode: 'compact' as const,
        variant: 'default',
      });

      const provided = machine.provide({ actors } as any);

      const snapshot = await new Promise<any>((resolve) => {
        const actor = createActor(provided, { input: { cwd: '/tmp', userPrompt: 'build something', maxRetries: 3 } });
        actor.subscribe((s) => {
          if (s.status === 'done') resolve(s);
        });
        actor.start();
      });

      if (snapshot.value !== 'done') {
        throw new Error(`expected state 'done', got '${JSON.stringify(snapshot.value)}'`);
      }
      if (gitCommitCallCount !== 1) {
        throw new Error(`expected gitCommit called once, got ${gitCommitCallCount}`);
      }
      if (!receivedMessage.includes('feat: my-feature')) {
        throw new Error(`commit message missing dev message; got: ${receivedMessage}`);
      }
      if (!receivedMessage.includes('task=t1')) {
        throw new Error(`commit message missing 'task=t1'; got: ${receivedMessage}`);
      }
      if (!receivedMessage.includes('validator:')) {
        throw new Error(`commit message missing 'validator:'; got: ${receivedMessage}`);
      }
      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hard deadline exceeded')), 3000)),
  ]);
} catch (e: any) {
  console.log(`FAIL commit-after-validator-pass: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
