// runtime executor for WorkflowDefinition-shaped workflows

import { createActor } from 'xstate';
import type { AnyStateMachine } from 'xstate';
import type { LogMode, RunMode } from '../../types.js';
import type { WorkflowDefinition } from '../types.js';
import type { StateStore } from '../../state/store.js';

export async function runEngineWorkflow(
  workflow: WorkflowDefinition<AnyStateMachine>,
  ctx: {
    cwd: string;
    primaryCwd?: string;
    taskSlug: string;
    runId: string;
    userPrompt: string;
    log?: (msg: string) => void;
    timeoutMs?: number;
    mode?: RunMode;
    logMode?: LogMode;
    store?: StateStore;
    variant: string;
  },
): Promise<{ status: 'done' | 'failed'; finalContext: any; error?: string }> {
  const log = ctx.log ?? ((_msg: string) => {});
  // 30 min default covers real planner + multiple dev/validator attempts on larger tasks;
  // probes override via ctx.timeoutMs (engine probes use tight deadlines of 1500ms-5000ms).
  const timeoutMs = ctx.timeoutMs ?? 1_800_000;

  const actorCleanup: { stop?: () => void } = {};

  const actorPromise = new Promise<{ status: 'done' | 'failed'; finalContext: any; error?: string }>(
    (resolve) => {
      const primaryCwd = ctx.primaryCwd ?? ctx.cwd;
      const machineWithActors = workflow.buildActors
        ? workflow.machine.provide({ actors: workflow.buildActors({ cwd: ctx.cwd, primaryCwd, taskSlug: ctx.taskSlug, runId: ctx.runId, mode: ctx.mode ?? 'silent', logMode: ctx.logMode ?? 'compact', store: ctx.store, variant: ctx.variant }) })
        : workflow.machine;
      const actor = createActor(machineWithActors, { input: { cwd: ctx.cwd, primaryCwd, userPrompt: ctx.userPrompt, taskSlug: ctx.taskSlug } });
      actorCleanup.stop = () => actor.stop();

      actor.subscribe({
        next: (snapshot) => {
          log(`[engine] workflow=${workflow.id} state=${String(snapshot.value)} status=${snapshot.status}`);

          if (snapshot.status === 'done') {
            if (snapshot.value === 'failed') {
              const ctxError = (snapshot.context as any)?.error;
              resolve({
                status: 'failed',
                finalContext: snapshot.context,
                error:
                  ctxError ??
                  `workflow "${workflow.id}" reached 'failed' state with no context.error set`,
              });
            } else {
              resolve({
                status: 'done',
                finalContext: snapshot.context,
              });
            }
          }
        },
        error: (err) => resolve({ status: 'failed', finalContext: null, error: String(err) }),
      });

      actor.start();
    },
  );

  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`engine workflow "${workflow.id}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([actorPromise, timeoutPromise]);
  } catch (err) {
    return {
      status: 'failed',
      finalContext: null,
      error: (err as Error).message,
    };
  } finally {
    actorCleanup.stop?.();
    clearTimeout(timeoutId!);
  }
}
