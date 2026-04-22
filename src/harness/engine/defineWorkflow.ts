// engine-design.md §8.1

import type { AnyStateMachine } from 'xstate';
import type { WorkflowDefinition } from './types.js';

export function defineWorkflow<TMachine extends AnyStateMachine>(def: {
  id: string;
  needsBranch?: boolean;
  needsWorktree?: boolean;
  machine: TMachine;
}): WorkflowDefinition<TMachine> {
  throw new Error('not implemented');
}
