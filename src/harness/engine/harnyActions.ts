// engine-design.md §8.2

import { assign } from 'xstate';

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

export const harnyActions = {
  commit: async (opts: { cwd: string; message: string }, signal: AbortSignal) =>
    gitCommit(opts, signal),
  resetTree: async (opts: { cwd: string; sha: string }, signal: AbortSignal) =>
    gitResetTree(opts, signal),
  cleanUntracked: async (opts: { cwd: string }, signal: AbortSignal) =>
    gitCleanUntracked(opts, signal),
  advanceTask: assign(({ context }: { context: any; event: any }) => ({
    currentTaskIdx: (context.currentTaskIdx as number) + 1,
  })),
  bumpAttempts: assign(({ context }: { context: any; event: any }) => ({
    attempts: (context.attempts as number) + 1,
  })),
  stashValidator: assign((_args: { context: any; event: any }) => ({
    validatorResult: null as unknown,
  })),
  stashDevSession: assign((_args: { context: any; event: any }) => ({
    devSession: null as unknown,
  })),
};
