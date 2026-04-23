/**
 * validator-smoke template — zero-token skeleton for a fixture-based validator probe.
 *
 * HOW TO USE
 *   Copy to scripts/probes/<feature>/01-validator-smoke.ts and fill in the
 *   fixture data matching your task's expected outputs. Run:
 *     bun scripts/probes/<feature>/01-validator-smoke.ts
 *
 * CONTRACT
 *   - Zero real Claude / SDK calls.
 *   - Total wall-clock under 5 s.
 *   - process.exit(0) on all pass, process.exit(1) on any failure.
 *
 * RULE: validator NEVER spawns a nested harny invocation. Use these helpers
 * instead. Full docs: src/harness/testing/ and
 * .claude/skills/release-management/SKILL.md §Cheap validator patterns.
 */

import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromPromise } from 'xstate';
import {
  tmpGitRepo,
  runPhaseWithFixture,
  assertStateField,
  withSyntheticState,
  runEngineWorkflowDry,
} from '../../../src/harness/testing/index.ts';
import featureDevWorkflow from '../../../src/harness/engine/workflows/featureDev.ts';

const DEADLINE_MS = 1500;
function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// --- 1. tmpGitRepo + withSyntheticState + assertStateField ------------------
try {
  await Promise.race([
    (async () => {
      // Create a disposable git repo for file-presence checks.
      const { path, cleanup } = await tmpGitRepo();

      // Write synthetic state and assert a field inside the fn.
      const stateDir = join(tmpdir(), `smoke-${Date.now()}`);
      await withSyntheticState(
        stateDir,
        // Override only the fields relevant to your test:
        { lifecycle: { status: 'done', current_phase: null, ended_at: null, ended_reason: null, pid: 1 } },
        async () => {
          // Literal equality:
          await assertStateField(stateDir, 'lifecycle.status', 'done');
          // Predicate form:
          await assertStateField(stateDir, 'schema_version', (v) => v === 1);
          // TODO: add assertions specific to your task here.
        },
      );
      // state.json is removed after withSyntheticState returns.

      await cleanup();
      if (existsSync(path)) throw new Error('cleanup should have removed the tmp dir');
      console.log('PASS state-fields');
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL state-fields: ${e.message}`);
  failures++;
}

// --- 2. runPhaseWithFixture — canned output, zero tokens --------------------
try {
  await Promise.race([
    (async () => {
      const fixture = {
        sessionId: 'fixture-session',
        status: 'completed' as const,
        error: null,
        // Replace structuredOutput with the actual output your phase should emit:
        structuredOutput: { status: 'done', commit_message: 'feat: add thing' },
        resultSubtype: 'success',
        events: [],
      };
      const runner = runPhaseWithFixture(
        {
          prompt: '',
          allowedTools: [] as string[],
          permissionMode: 'bypassPermissions',
          maxTurns: 1,
          effort: 'low',
          model: undefined,
          mcpServers: {},
        },
        fixture,
      );
      const result = await runner({
        phaseName: 'validator',
        prompt: 'validate',
        schema: { type: 'object' } as any,
        allowedTools: [],
      });
      if (result.session_id !== fixture.sessionId) throw new Error('session_id mismatch');
      // TODO: assert result.output matches your expected structured output.
      console.log('PASS fixture-phase');
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL fixture-phase: ${e.message}`);
  failures++;
}

// --- 3. runEngineWorkflowDry — full machine, zero tokens --------------------
try {
  await Promise.race([
    (async () => {
      const now = new Date().toISOString();
      // Build a minimal stub plan. Replace tasks with your actual task structure.
      const stubPlan = {
        schema_version: 1 as const,
        task_slug: 'test',
        primary_cwd: '/tmp',
        user_prompt: 'test',
        branch: '',
        isolation: 'inline' as const,
        worktree_path: null,
        created_at: now,
        updated_at: now,
        status: 'in_progress' as const,
        summary: 'stub',
        iterations_global: 0,
        tasks: [{
          id: 't1',
          title: 'Test task',
          description: 'test',
          acceptance: ['pass'],
          status: 'pending' as const,
          attempts: 0,
          commit_sha: null,
          history: [],
        }],
        metadata: {},
      };

      const snapshot = await runEngineWorkflowDry(
        featureDevWorkflow,
        { cwd: '/tmp', userPrompt: 'test' },
        {
          plannerActor:   fromPromise(async () => stubPlan),
          developerActor: fromPromise(async () => ({ status: 'done' as const, commit_message: 'feat: x', session_id: 's1' })),
          validatorActor: fromPromise(async () => ({ verdict: 'pass' as const, session_id: 's2', reasons: [] })),
          commitActor:    fromPromise(async () => ({ sha: 'abc123' })),
        },
      );

      // XState status 'done' means the machine reached any final state.
      if (snapshot.status !== 'done') throw new Error(`unexpected snapshot.status: ${snapshot.status}`);
      console.log('PASS engine-dry');
    })(),
    // Slightly longer deadline for the full planning→committing loop:
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('deadline exceeded')), 3000),
    ),
  ]);
} catch (e: any) {
  console.log(`FAIL engine-dry: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
