/**
 * Probe: cheap-validator infrastructure — 5 scenarios, zero real Claude calls.
 * Exercises every helper in src/harness/testing/index.ts at least once.
 *
 * RUN
 *   bun scripts/probes/testing/01-cheap-validator.ts
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario 1: tmpGitRepo — creates a directory, cleanup removes it idempotently
try {
  await Promise.race([
    (async () => {
      const name = 'tmpGitRepo';
      const repo = await tmpGitRepo();

      if (!existsSync(repo.path)) {
        throw new Error(`expected directory at ${repo.path}`);
      }

      await repo.cleanup();
      if (existsSync(repo.path)) {
        throw new Error(`expected ${repo.path} to be removed after cleanup`);
      }

      // Second call must not throw (idempotent)
      await repo.cleanup();

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL tmpGitRepo: ${e.message}`);
  failures++;
}

// Scenario 2: runPhaseWithFixture — returns canned session_id and output
try {
  await Promise.race([
    (async () => {
      const name = 'runPhaseWithFixture';
      const fixtureSessionId = 'fixture-session-abc';
      const fixtureOutput = { status: 'done', commit_message: 'test fixture' };
      const fixture = {
        sessionId: fixtureSessionId,
        status: 'completed' as const,
        error: null,
        structuredOutput: fixtureOutput,
        resultSubtype: 'success',
        events: [],
      };
      const phaseConfig = {
        prompt: 'test',
        allowedTools: ['Read'] as string[],
        permissionMode: 'bypassPermissions' as const,
        maxTurns: 10,
        effort: 'low' as const,
        model: 'sonnet' as const,
        mcpServers: {},
      };
      const runner = runPhaseWithFixture(phaseConfig, fixture);
      const result = await runner({
        phaseName: 'developer',
        prompt: 'do the thing',
        schema: { type: 'object' } as any,
        allowedTools: ['Read'],
      });

      if (result.session_id !== fixtureSessionId) {
        throw new Error(`session_id: expected ${fixtureSessionId}, got ${result.session_id}`);
      }
      if (JSON.stringify(result.output) !== JSON.stringify(fixtureOutput)) {
        throw new Error(`output mismatch: ${JSON.stringify(result.output)}`);
      }

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL runPhaseWithFixture: ${e.message}`);
  failures++;
}

// Scenario 3: withSyntheticState — file exists during fn, removed after
try {
  await Promise.race([
    (async () => {
      const name = 'withSyntheticState';
      const stateDir = join(tmpdir(), `harny-test-state-${Date.now()}`);
      await mkdir(stateDir, { recursive: true });

      let foundDuringFn = false;
      await withSyntheticState(
        stateDir,
        { lifecycle: { status: 'done', current_phase: null, ended_at: null, ended_reason: null, pid: 1 } },
        async () => {
          foundDuringFn = existsSync(join(stateDir, 'state.json'));
        },
      );

      if (!foundDuringFn) throw new Error('state.json not found during fn');
      if (existsSync(join(stateDir, 'state.json'))) {
        throw new Error('state.json should be removed after withSyntheticState');
      }

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL withSyntheticState: ${e.message}`);
  failures++;
}

// Scenario 4: assertStateField — passes on match, throws on mismatch
try {
  await Promise.race([
    (async () => {
      const name = 'assertStateField';
      const stateDir = join(tmpdir(), `harny-test-assert-${Date.now()}`);
      await mkdir(stateDir, { recursive: true });

      await withSyntheticState(
        stateDir,
        { lifecycle: { status: 'done', current_phase: null, ended_at: null, ended_reason: null, pid: 1 } },
        async () => {
          // Literal match
          await assertStateField(stateDir, 'lifecycle.status', 'done');

          // Predicate match
          await assertStateField(stateDir, 'schema_version', (v) => v === 1);

          // Mismatch should throw
          let threw = false;
          try {
            await assertStateField(stateDir, 'lifecycle.status', 'running');
          } catch {
            threw = true;
          }
          if (!threw) throw new Error('assertStateField should throw on literal mismatch');

          // Predicate returning false should throw
          let threwPred = false;
          try {
            await assertStateField(stateDir, 'schema_version', (v) => v === 99);
          } catch {
            threwPred = true;
          }
          if (!threwPred) throw new Error('assertStateField should throw when predicate returns false');
        },
      );

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL assertStateField: ${e.message}`);
  failures++;
}

// Scenario 5: runEngineWorkflowDry — featureDev machine with all 4 actors stubbed, zero tokens
try {
  await Promise.race([
    (async () => {
      const name = 'runEngineWorkflowDry';
      const now = new Date().toISOString();

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
        summary: 'stub plan',
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
          developerActor: fromPromise(async () => ({
            status: 'done' as const,
            commit_message: 'test',
            session_id: 's1',
          })),
          validatorActor: fromPromise(async () => ({
            verdict: 'pass' as const,
            session_id: 's2',
            reasons: [] as string[],
          })),
          commitActor: fromPromise(async () => ({ sha: 'abc123' })),
        },
      );

      if (snapshot.status !== 'done') {
        throw new Error(`expected snapshot.status 'done', got '${snapshot.status}'`);
      }

      console.log(`PASS ${name}`);
    })(),
    // Slightly wider window for the full planning→committing→done loop
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('hard deadline exceeded')), 3000),
    ),
  ]);
} catch (e: any) {
  console.log(`FAIL runEngineWorkflowDry: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
