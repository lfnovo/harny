// engine-design.md §8, §4.4, §9.1.1
// Convention per §8.4: exports runCommand (plain async) + commandActor (fromPromise wrapper). See §8.4 for rationale.

import { fromPromise } from 'xstate';
import type { CommandActorOptions } from '../types.js';

export async function runCommand(
  options: CommandActorOptions,
  signal: AbortSignal,
): Promise<{ exit_code: number; stdout: string; stderr: string; duration_ms: number }> {
  const cwd = options.cwd ?? process.cwd();
  const start = Date.now();

  const proc = Bun.spawn(options.cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });

  let abortReason: 'timeout' | 'abort' | null = null;
  let killed = false;

  const kill = () => {
    if (!killed) {
      killed = true;
      proc.kill('SIGKILL');
    }
  };

  const abortHandler = () => {
    abortReason = 'abort';
    kill();
  };
  signal.addEventListener('abort', abortHandler);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (options.timeout_ms !== undefined) {
    const timeoutMs = options.timeout_ms;
    timeoutId = setTimeout(() => {
      abortReason = 'timeout';
      kill();
    }, timeoutMs);
  }

  const stdoutPromise = new Response(proc.stdout!).text();
  const stderrPromise = new Response(proc.stderr!).text();

  try {
    await proc.exited;
    const duration_ms = Date.now() - start;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (abortReason === 'timeout') {
      throw new Error(`command timed out after ${options.timeout_ms}ms`);
    }
    if (abortReason === 'abort') {
      throw new Error('command aborted');
    }

    return { exit_code: proc.exitCode!, stdout, stderr, duration_ms };
  } finally {
    signal.removeEventListener('abort', abortHandler);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// Actor logic — for setup({ actors }) composition in workflows.
export const commandActorLogic = fromPromise<
  { exit_code: number; stdout: string; stderr: string; duration_ms: number },
  CommandActorOptions
>(({ input, signal }) => runCommand(input, signal));

// Wraps Bun.spawn as an XState fromPromise actor.
// advisory: true causes onError to be caught internally so post-nodes don't fail the run (§4.4).
// idempotent: false causes the runtime to refuse re-invocation after snapshot restore (§9.1.1).
export function commandActor(options: CommandActorOptions): ReturnType<typeof fromPromise> {
  return fromPromise(({ signal }) => runCommand(options, signal));
}
