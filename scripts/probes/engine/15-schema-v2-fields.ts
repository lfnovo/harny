/**
 * Probe: schema v2 fields — exercises StateSchema.parse with three scenarios:
 * A) minimal v2 object, B) full v2 with new optional fields + human_review history,
 * C) v1-shaped object (schema_version: 1) must be rejected.
 * Zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/engine/15-schema-v2-fields.ts
 */

import { StateSchema } from '../../../src/harness/state/schema.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario A: minimal v2 object — must parse without throwing
try {
  await Promise.race([
    (async () => {
      const name = 'scenario-A-minimal-v2';
      const now = new Date().toISOString();
      StateSchema.parse({
        schema_version: 2,
        run_id: 'run-a',
        origin: {
          prompt: 'test',
          workflow: 'test',
          task_slug: 'test',
          started_at: now,
          host: 'h',
          user: 'u',
          features: null,
        },
        environment: {
          cwd: '/tmp',
          branch: 'main',
          isolation: 'inline',
          worktree_path: null,
          mode: 'silent',
        },
        lifecycle: {
          status: 'running',
          current_phase: null,
          ended_at: null,
          ended_reason: null,
          pid: 1,
        },
        phases: [],
        history: [],
        pending_question: null,
        workflow_state: {},
        workflow_chosen: null,
      });
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL scenario-A-minimal-v2: ${e.message}`);
  failures++;
}

// Scenario B: full v2 with origin.features, workflow_chosen, human_review history
try {
  await Promise.race([
    (async () => {
      const name = 'scenario-B-full-v2';
      const now = new Date().toISOString();
      StateSchema.parse({
        schema_version: 2,
        run_id: 'run-b',
        origin: {
          prompt: 'test',
          workflow: 'router',
          task_slug: 'test',
          started_at: now,
          host: 'h',
          user: 'u',
          features: { env: 'prod', tier: 'enterprise' },
        },
        environment: {
          cwd: '/tmp',
          branch: 'main',
          isolation: 'worktree',
          worktree_path: '/tmp/wt',
          mode: 'async',
        },
        lifecycle: {
          status: 'done',
          current_phase: null,
          ended_at: now,
          ended_reason: 'completed',
          pid: 42,
        },
        phases: [
          {
            name: 'planner',
            attempt: 1,
            started_at: now,
            ended_at: now,
            status: 'completed',
            verdict: '{"summary":"ok"}',
            session_id: 'sess-1',
          },
        ],
        history: [
          { at: now, phase: 'planner', event: 'phase_start' },
          { at: now, phase: 'planner', event: 'phase_end' },
          {
            at: now,
            kind: 'human_review',
            state_path: 'lifecycle.status',
            question: 'Is this ok?',
            answered: true,
            answer: 'yes',
          },
        ],
        pending_question: null,
        workflow_state: { custom: 'data' },
        workflow_chosen: { id: 'router', variant: 'auto' },
      });
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL scenario-B-full-v2: ${e.message}`);
  failures++;
}

// Scenario C: v1-shaped object — must throw, error message must include 'schema_version'
try {
  await Promise.race([
    (async () => {
      const name = 'scenario-C-v1-rejected';
      const now = new Date().toISOString();
      let threw = false;
      let errorMessage = '';
      try {
        StateSchema.parse({
          schema_version: 1,
          run_id: 'run-c',
          origin: {
            prompt: 'test',
            workflow: 'test',
            task_slug: 'test',
            started_at: now,
            host: 'h',
            user: 'u',
            features: null,
          },
          environment: {
            cwd: '/tmp',
            branch: 'main',
            isolation: 'inline',
            worktree_path: null,
            mode: 'silent',
          },
          lifecycle: {
            status: 'running',
            current_phase: null,
            ended_at: null,
            ended_reason: null,
            pid: 1,
          },
          phases: [],
          history: [],
          pending_question: null,
          workflow_state: {},
          workflow_chosen: null,
        });
      } catch (e: any) {
        threw = true;
        errorMessage = e.message;
      }
      if (!threw) throw new Error('expected StateSchema.parse to throw for schema_version: 1');
      if (!errorMessage.includes('schema_version')) {
        throw new Error(
          `expected error message to contain 'schema_version', got: ${errorMessage.slice(0, 300)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL scenario-C-v1-rejected: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
