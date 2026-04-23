// engine-design.md §8.1

import type { AnyStateMachine } from 'xstate';
import type { WorkflowDefinition } from './types.js';
import type { StateStore } from '../state/store.js';
import type { LogMode, RunMode } from '../types.js';

export function defineWorkflow<TMachine extends AnyStateMachine>(def: {
  id: string;
  needsBranch?: boolean;
  needsWorktree?: boolean;
  machine: TMachine;
  buildActors?: (deps: { cwd: string; taskSlug: string; runId: string; mode?: RunMode; logMode?: LogMode; store?: StateStore; variant: string }) => Record<string, any>;
}): WorkflowDefinition<TMachine> {
  if (typeof def.id !== 'string' || def.id.trim().length === 0) {
    throw new Error('defineWorkflow: id must be a non-empty string');
  }

  const m = def.machine as unknown as Record<string, unknown>;
  if (
    typeof m?.config !== 'object' ||
    m?.config === null ||
    typeof m?.getInitialSnapshot !== 'function'
  ) {
    throw new Error(
      'defineWorkflow: machine must be an XState v5 StateMachine (missing config or getInitialSnapshot)',
    );
  }

  return Object.freeze({
    id: def.id,
    needsBranch: def.needsBranch,
    needsWorktree: def.needsWorktree,
    machine: def.machine,
    buildActors: def.buildActors,
  }) as WorkflowDefinition<TMachine>;
}
