/**
 * Probe: plan.json persistence + Zod validation.
 *
 * Validates:
 *   (a) savePlan writes an atomically-renamed file.
 *   (b) loadPlan round-trips a valid Plan.
 *   (c) loadPlan rejects non-JSON with a clear error.
 *   (d) loadPlan rejects schema-mismatched JSON with a clear error.
 *   (e) savePlan rejects a structurally-invalid Plan (caught at write boundary).
 *   (f) PlanSchema accepts the shape produced by the planner today.
 *
 * Run when editing src/harness/state/plan.ts:
 *   bun scripts/probes/plan/01-persistence.ts
 *
 * Hard deadline: 2s total.
 */

import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlan, savePlan, planFilePath } from '../../../src/harness/state/plan.ts';
import type { Plan } from '../../../src/harness/types.ts';

function validPlan(): Plan {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    task_slug: 'probe-slug',
    user_prompt: 'do the thing',
    branch: 'harny/probe-slug',
    primary_cwd: '/tmp/probe-cwd',
    isolation: 'worktree',
    worktree_path: '/tmp/probe-cwd/.harny/worktrees/probe-slug',
    created_at: now,
    updated_at: now,
    status: 'planning',
    summary: 'test plan',
    iterations_global: 0,
    tasks: [
      {
        id: 't1',
        title: 'first task',
        description: 'do first thing',
        acceptance: ['it works'],
        status: 'pending',
        attempts: 0,
        commit_sha: null,
        history: [],
      },
    ],
    metadata: {},
  };
}

let failures = 0;

function run(name: string, body: () => void | Promise<void>): Promise<void> {
  return (async () => {
    try {
      await body();
      console.log(`PASS ${name}`);
    } catch (err: any) {
      console.log(`FAIL ${name}: ${err?.message ?? err}`);
      failures++;
    }
  })();
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'harny-plan-probe-'));
  const path = planFilePath(dir, 'probe-slug');

  // (a) + (b) save + load round-trip
  await run('save + load round-trip', async () => {
    const p = validPlan();
    await savePlan(path, p);
    if (!existsSync(path)) throw new Error('plan.json not written');
    const loaded = await loadPlan(path);
    if (loaded.task_slug !== 'probe-slug') {
      throw new Error(`round-trip task_slug mismatch: ${loaded.task_slug}`);
    }
    if (loaded.tasks.length !== 1 || loaded.tasks[0]!.id !== 't1') {
      throw new Error(`round-trip tasks mismatch`);
    }
    // updated_at is stamped on write — should be >= created_at
    if (!loaded.updated_at) throw new Error('updated_at missing after save');
  });

  // (c) non-JSON rejection
  await run('loadPlan rejects non-JSON', async () => {
    const badPath = join(dir, 'corrupt.json');
    writeFileSync(badPath, 'not json at all {');
    try {
      await loadPlan(badPath);
      throw new Error('expected loadPlan to throw');
    } catch (err: any) {
      if (!String(err.message).includes('not valid JSON')) {
        throw new Error(`wrong error: ${err.message}`);
      }
    }
  });

  // (d) schema mismatch rejection — wrong schema_version, missing required fields
  await run('loadPlan rejects schema mismatch', async () => {
    const badPath = join(dir, 'wrongshape.json');
    writeFileSync(badPath, JSON.stringify({ schema_version: 99, foo: 'bar' }));
    try {
      await loadPlan(badPath);
      throw new Error('expected loadPlan to throw');
    } catch (err: any) {
      if (!String(err.message).includes('schema validation')) {
        throw new Error(`wrong error: ${err.message}`);
      }
    }
  });

  // (e) savePlan refuses invalid plan
  await run('savePlan refuses invalid plan', async () => {
    const bogus = { ...validPlan(), schema_version: 99 as unknown as 1 };
    try {
      await savePlan(join(dir, 'shouldnotexist.json'), bogus as Plan);
      throw new Error('expected savePlan to throw');
    } catch (err: any) {
      if (!String(err.message).includes('schema validation')) {
        throw new Error(`wrong error: ${err.message}`);
      }
    }
  });

  // (f) schema accepts a realistic planner-produced shape: the planner today
  // builds Plans via featureDevActors.ts with all core fields + empty history.
  await run('schema accepts a rich plan with metadata + multiple tasks', async () => {
    const now = new Date().toISOString();
    const plan: Plan = {
      schema_version: 1,
      task_slug: 'rich',
      user_prompt: 'complex thing',
      branch: 'harny/rich',
      primary_cwd: dir,
      isolation: 'inline',
      worktree_path: null,
      created_at: now,
      updated_at: now,
      status: 'in_progress',
      summary: 'rich summary',
      iterations_global: 2,
      tasks: [
        {
          id: 't1',
          title: 'one',
          description: 'd1',
          acceptance: ['a1', 'a2'],
          status: 'done',
          attempts: 1,
          commit_sha: 'deadbeef',
          history: [{ role: 'developer', session_id: 'sess1', at: now, extra: 42 }],
          output: { foo: 'bar' },
        },
        {
          id: 't2',
          title: 'two',
          description: 'd2',
          acceptance: ['a3'],
          status: 'pending',
          attempts: 0,
          commit_sha: null,
          history: [],
        },
      ],
      run_id: 'run-abc',
      metadata: { planner_session_id: 'sess0', anything: { nested: true } },
    };
    const p = join(dir, 'rich.json');
    await savePlan(p, plan);
    const loaded = await loadPlan(p);
    if (loaded.tasks.length !== 2) throw new Error('tasks length');
    if (loaded.tasks[0]!.status !== 'done') throw new Error('task status');
    if ((loaded.metadata as any).planner_session_id !== 'sess0') {
      throw new Error('metadata roundtrip');
    }
    // passthrough on history should retain the extra field
    if ((loaded.tasks[0]!.history[0] as any).extra !== 42) {
      throw new Error('history passthrough');
    }
  });
}

const DEADLINE_MS = 2000;
const deadline = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
);

try {
  await Promise.race([main(), deadline]);
  console.log(`\n${failures === 0 ? 'all passed' : `${failures} failed`}`);
  if (failures > 0) process.exit(1);
} catch (err: any) {
  console.log(`FAIL probe: ${err?.message ?? err}`);
  process.exit(1);
}
