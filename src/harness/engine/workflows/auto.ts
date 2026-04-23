// 'auto' boundary workflow: XState sub-actor wrapper around a leaf workflow.
// Ships the structural skeleton for pre/post cleanup nodes; router logic is deferred.

import { assign, fromPromise, setup } from 'xstate';
import { defineWorkflow } from '../defineWorkflow.js';
import { buildFeatureDevActors, type BuildFeatureDevActorsDeps } from './featureDevActors.js';
import featureDevEngineWorkflow from './featureDev.js';

interface AutoContext {
  cwd: string;
  taskSlug: string;
  userPrompt: string;
  error: string | null;
}

const machine = setup({
  types: {} as {
    context: AutoContext;
    input: { cwd: string; userPrompt: string; taskSlug: string };
  },
  actors: {
    // Placeholder — replaced at runtime by wired featureDevEngineWorkflow via machine.provide()
    leafMachine: fromPromise<void, { cwd: string; userPrompt: string; taskSlug: string }>(
      async () => { throw new Error('leafMachine not wired'); },
    ),
    // §4.2/§4.3 extension point: cleanup, telemetry, meta-improve hooks. Idempotent no-op today.
    cleanupActor: fromPromise<void, undefined>(
      async () => {},
    ),
  },
}).createMachine({
  id: 'auto',
  initial: 'invoking',
  context: ({ input }) => ({
    cwd: input.cwd,
    taskSlug: input.taskSlug,
    userPrompt: input.userPrompt,
    error: null,
  }),
  states: {
    invoking: {
      invoke: {
        src: 'leafMachine',
        input: ({ context }) => ({
          cwd: context.cwd,
          userPrompt: context.userPrompt,
          taskSlug: context.taskSlug,
        }),
        onDone: { target: 'finalize' },
        onError: {
          actions: assign({ error: ({ event }: any) => String(event.error ?? 'leaf workflow failed') }),
          target: 'finalize',
        },
      },
    },
    finalize: {
      initial: 'cleanup',
      states: {
        // §4.2/§4.3 extension point: post-run cleanup, telemetry, meta-improve hooks.
        // No-op stub today — resolves immediately. Future runs add real bodies here.
        cleanup: {
          invoke: {
            src: 'cleanupActor',
            input: () => undefined,
            onDone: [
              {
                guard: ({ context }) => context.error !== null,
                target: '#auto.failed',
              },
              { target: '#auto.done' },
            ],
            onError: { target: '#auto.failed' },
          },
        },
      },
    },
    done: { type: 'final' },
    failed: { type: 'final' },
  },
});

export function buildAutoActors(deps: BuildFeatureDevActorsDeps) {
  const leafActors = buildFeatureDevActors(deps);
  // Wire the leaf machine with production actors so the store threads through the boundary
  const wiredLeafMachine = featureDevEngineWorkflow.machine.provide({ actors: leafActors });

  return {
    leafMachine: wiredLeafMachine,
    // §4.2/§4.3 extension point: no-op today
    cleanupActor: fromPromise<void, undefined>(async () => {}),
  };
}

export default defineWorkflow({
  id: 'auto',
  needsBranch: true,
  needsWorktree: true,
  machine,
  buildActors: buildAutoActors,
});
