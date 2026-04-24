import { mkdtemp, rm, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createActor } from 'xstate';
import type { AnyStateMachine } from 'xstate';
import { adaptRunPhase } from '../engine/runtime/runPhaseAdapter.js';
import type { SessionRunPhase, AgentRunOptionsSubset } from '../engine/runtime/runPhaseAdapter.js';
import type { PhaseRunResult } from '../sessionRecorder.js';
import type { ResolvedPhaseConfig } from '../types.js';
import { StateSchema, type State } from '../state/schema.js';
import type { WorkflowDefinition } from '../engine/types.js';
import type { StateStore } from '../state/store.js';

/**
 * Creates a disposable git repo under os.tmpdir(). cleanup() is idempotent.
 *
 * By default the repo has no user.name/email and no commits — cheap for tests
 * that just need a valid cwd. Pass `seed: {}` (or with overrides) to get:
 *   - user.email / user.name configured (defaults "test@harny.local" /
 *     "harny test"), required before any commit;
 *   - an initial empty commit (opt-out via seed.initialCommit=false), required
 *     by anything that calls git operations expecting HEAD to exist.
 */
export async function tmpGitRepo(opts?: {
  seed?: { name?: string; email?: string; initialCommit?: boolean };
}): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'harny-test-'));
  const run = async (args: string[]) => {
    const proc = Bun.spawn(['git', ...args], {
      cwd: path,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed in ${path} (exit ${proc.exitCode})`);
    }
  };
  await run(['init']);
  if (opts?.seed) {
    const email = opts.seed.email ?? 'test@harny.local';
    const name = opts.seed.name ?? 'harny test';
    await run(['config', 'user.email', email]);
    await run(['config', 'user.name', name]);
    if (opts.seed.initialCommit !== false) {
      await run(['commit', '--allow-empty', '-m', 'seed']);
    }
  }
  let cleaned = false;
  return {
    path,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(path, { recursive: true, force: true });
    },
  };
}

/**
 * Injects a canned PhaseRunResult into adaptRunPhase via the sessionRunPhase DI seam.
 * Returns the same runner shape as adaptRunPhase — zero real Claude calls.
 */
export function runPhaseWithFixture(
  phaseConfig: ResolvedPhaseConfig,
  fixtureResult: PhaseRunResult<unknown>,
  store?: StateStore,
): (engineArgs: AgentRunOptionsSubset) => Promise<{ output: unknown; session_id: string }> {
  const mockSessionRunPhase: SessionRunPhase = async () => fixtureResult;
  return adaptRunPhase({
    cwd: '/tmp',
    workflowId: 'test',
    taskSlug: 'test',
    runId: 'test',
    phaseConfig,
    sessionRunPhase: mockSessionRunPhase,
    mode: 'silent',
    logMode: 'quiet',
    store,
  });
}

/**
 * Reads state.json from stateDir, walks dotPath (e.g. "lifecycle.status"),
 * and asserts the value satisfies expectedPredicate (literal equality or a
 * function returning bool). Throws with a descriptive message on mismatch.
 */
export async function assertStateField(
  stateDir: string,
  dotPath: string,
  expectedPredicate: unknown | ((v: unknown) => boolean),
): Promise<void> {
  const raw = await readFile(join(stateDir, 'state.json'), 'utf8');
  let current: unknown = JSON.parse(raw);
  for (const part of dotPath.split('.')) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(
        `assertStateField: path "${dotPath}" — segment "${part}" is not an object (got ${typeof current})`,
      );
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof expectedPredicate === 'function') {
    const ok = (expectedPredicate as (v: unknown) => boolean)(current);
    if (!ok) {
      throw new Error(
        `assertStateField: predicate returned false for path "${dotPath}" (value=${JSON.stringify(current)})`,
      );
    }
  } else {
    if (JSON.stringify(current) !== JSON.stringify(expectedPredicate)) {
      throw new Error(
        `assertStateField: path "${dotPath}" — expected ${JSON.stringify(expectedPredicate)}, got ${JSON.stringify(current)}`,
      );
    }
  }
}

/**
 * Constructs a minimal valid state.json in stateDir (merged with partialState),
 * runs fn, then removes the file in a finally block. Creates stateDir if needed.
 */
export async function withSyntheticState(
  stateDir: string,
  partialState: Partial<State>,
  fn: () => Promise<void>,
): Promise<void> {
  const statePath = join(stateDir, 'state.json');
  const defaults: State = {
    schema_version: 2,
    run_id: 'test-run-id',
    origin: {
      prompt: 'test prompt',
      workflow: 'test',
      task_slug: 'test',
      started_at: new Date().toISOString(),
      host: 'localhost',
      user: 'test',
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
      pid: process.pid,
    },
    phases: [],
    history: [],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
  const merged = deepMerge(
    defaults as Record<string, unknown>,
    partialState as Record<string, unknown>,
  ) as State;
  StateSchema.parse(merged);
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(merged, null, 2), 'utf8');
  try {
    await fn();
  } finally {
    await unlink(statePath).catch(() => {});
  }
}

/**
 * Runs the workflow's XState machine with all actors substituted from the
 * fixtures map. Zero real Claude calls. Returns the final XState snapshot.
 * Throws if the machine does not reach a final state within 5 000 ms.
 */
export async function runEngineWorkflowDry(
  workflow: WorkflowDefinition<AnyStateMachine>,
  input: { cwd: string; userPrompt: string } & Record<string, unknown>,
  fixtures: Record<string, unknown>,
): Promise<any> {
  const DEADLINE_MS = 5_000;
  const machineWithActors = workflow.machine.provide({ actors: fixtures as any });

  let stopActor: (() => void) | undefined;

  const runPromise = new Promise<any>((resolve, reject) => {
    const actor = createActor(machineWithActors, { input });
    stopActor = () => actor.stop();

    actor.subscribe({
      next: (snapshot) => {
        if (snapshot.status === 'done' || snapshot.status === 'error') {
          resolve(snapshot);
        }
      },
      error: (err) => reject(err instanceof Error ? err : new Error(String(err))),
    });

    actor.start();
  });

  const deadlinePromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error('runEngineWorkflowDry: 5000ms deadline exceeded')),
      DEADLINE_MS,
    ),
  );

  try {
    return await Promise.race([runPromise, deadlinePromise]);
  } finally {
    stopActor?.();
  }
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const v = override[key];
    const b = base[key];
    if (
      v !== undefined &&
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof b === 'object' &&
      b !== null &&
      !Array.isArray(b)
    ) {
      result[key] = deepMerge(b as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) {
      result[key] = v;
    }
  }
  return result;
}
