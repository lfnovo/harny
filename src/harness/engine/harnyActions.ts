// engine-design.md §8.2

import { assign, fromPromise } from 'xstate';
import type { PlanDrivenContext } from './types.ts';

async function spawnGit(args: string[], signal: AbortSignal): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });

  let killed = false;
  const kill = () => {
    if (!killed) {
      killed = true;
      proc.kill('SIGKILL');
    }
  };

  const abortHandler = () => kill();
  signal.addEventListener('abort', abortHandler);

  const stdoutPromise = new Response(proc.stdout!).text();
  const stderrPromise = new Response(proc.stderr!).text();

  try {
    await proc.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (signal.aborted) {
      throw new Error('git command aborted');
    }

    if (proc.exitCode !== 0) {
      throw new Error(`git ${args[0]} failed (exit ${proc.exitCode}): ${stderr.trim()}`);
    }

    return stdout;
  } finally {
    signal.removeEventListener('abort', abortHandler);
  }
}

export async function gitCommit(
  { cwd, message }: { cwd: string; message: string },
  signal: AbortSignal,
): Promise<{ sha: string }> {
  await spawnGit(['-C', cwd, 'add', '-A'], signal);
  const staged = await spawnGit(['-C', cwd, 'diff', '--cached', '--name-only'], signal);
  if (staged.trim().length === 0) {
    throw new Error('gitCommit: nothing staged after add -A; refusing empty commit');
  }
  await spawnGit(['-C', cwd, 'commit', '-m', message], signal);
  const sha = await spawnGit(['-C', cwd, 'rev-parse', 'HEAD'], signal);
  return { sha: sha.trim() };
}

export async function gitResetTree(
  { cwd, sha }: { cwd: string; sha: string },
  signal: AbortSignal,
): Promise<void> {
  await spawnGit(['-C', cwd, 'reset', '--hard', sha], signal);
}

export async function gitCleanUntracked(
  { cwd }: { cwd: string },
  signal: AbortSignal,
): Promise<void> {
  await spawnGit(['-C', cwd, 'clean', '-fd'], signal);
}

// Actor logic constants — for setup({ actors }) composition in workflows.
export const commitLogic = fromPromise<{ sha: string }, { cwd: string; message: string }>(
  ({ input, signal }) => gitCommit(input, signal),
);

export const resetTreeLogic = fromPromise<void, { cwd: string; sha: string }>(
  ({ input, signal }) => gitResetTree(input, signal),
);

export const cleanUntrackedLogic = fromPromise<void, { cwd: string }>(
  ({ input, signal }) => gitCleanUntracked(input, signal),
);

export const harnyActions = {
  commit: async (opts: { cwd: string; message: string }, signal: AbortSignal) =>
    gitCommit(opts, signal),
  resetTree: async (opts: { cwd: string; sha: string }, signal: AbortSignal) =>
    gitResetTree(opts, signal),
  cleanUntracked: async (opts: { cwd: string }, signal: AbortSignal) =>
    gitCleanUntracked(opts, signal),
  advanceTask: assign(({ context }: { context: PlanDrivenContext; event: any }) => ({
    currentTaskIdx: context.currentTaskIdx + 1,
    attempts: 0,
    iterationsThisTask: 0,
  })),
  bumpAttempts: assign(({ context }: { context: PlanDrivenContext; event: any }) => ({
    attempts: context.attempts + 1,
    iterationsThisTask: context.iterationsThisTask + 1,
    iterationsGlobal: context.iterationsGlobal + 1,
  })),
  stashValidator: assign(({ event }: { context: PlanDrivenContext; event: any }) => ({
    validatorSession: event.output?.session_id ?? null,
  })),
  stashDevSession: assign(({ event }: { context: PlanDrivenContext; event: any }) => ({
    devSession: event.output?.session_id ?? null,
  })),
};
