// engine-design.md §8, §11 — runtime executor for WorkflowDefinition-shaped workflows

import { createActor } from 'xstate';
import type { AnyStateMachine } from 'xstate';
import type { WorkflowDefinition } from '../types.js';

const TIMEOUT_MS = 60_000;

export async function runEngineWorkflow(
  workflow: WorkflowDefinition<AnyStateMachine>,
  ctx: {
    cwd: string;
    taskSlug: string;
    runId: string;
    log?: (msg: string) => void;
  },
): Promise<{ status: 'done' | 'failed'; finalContext: any; error?: string }> {
  const log = ctx.log ?? ((_msg: string) => {});

  const actorPromise = new Promise<{ status: 'done' | 'failed'; finalContext: any; error?: string }>(
    (resolve) => {
      const actor = createActor(workflow.machine, { input: { cwd: ctx.cwd } });

      actor.subscribe((snapshot) => {
        log(`[engine] workflow=${workflow.id} state=${String(snapshot.value)} status=${snapshot.status}`);

        if (snapshot.status === 'done') {
          if (snapshot.value === 'failed') {
            resolve({
              status: 'failed',
              finalContext: snapshot.context,
              error: (snapshot.context as any)?.error ?? 'workflow reached failed state',
            });
          } else {
            resolve({
              status: 'done',
              finalContext: snapshot.context,
            });
          }
        }
      });

      actor.start();
    },
  );

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`engine workflow "${workflow.id}" timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS,
    ),
  );

  try {
    return await Promise.race([actorPromise, timeoutPromise]);
  } catch (err) {
    return {
      status: 'failed',
      finalContext: null,
      error: (err as Error).message,
    };
  }
}
