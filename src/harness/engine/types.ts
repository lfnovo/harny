// engine-design.md §6.1, §7, §8

import type { AnyStateMachine } from 'xstate';

// §6.1 — structured features captured at run start for meta-agent analytics
export interface FeatureSet {
  repo?: {
    language?: string;
    loc?: number;
    test_infra?: string;
    package_manager?: string;
    has_ci?: boolean;
  };
  request?: {
    type?: 'feature' | 'bugfix' | 'refactor' | 'doc' | 'exploration';
    scope?: 'single_file' | 'cross_cutting' | 'architectural';
    ambiguity?: 'low' | 'medium' | 'high';
    estimated_complexity?: 'small' | 'medium' | 'large';
  };
  router?: {
    confidence?: 'high' | 'medium' | 'low';
    rationale?: string;
  };
}

// §7.2 — option presented in a humanReview checkpoint
export interface HumanReviewOption {
  value: string;
  label: string;
  needsText?: boolean;
}

// §7.2 — answer returned from a humanReview checkpoint
export interface HumanReviewOutput {
  value: string;
  text?: string;
}

// §8 — typed wrapper returned by defineWorkflow
export interface WorkflowDefinition<TMachine extends AnyStateMachine> {
  id: string;
  needsBranch?: boolean;
  needsWorktree?: boolean;
  machine: TMachine;
}

// Runtime context passed to actor factories; populated by the harny runtime
export interface ActorContext {
  workflowId: string;
  runId: string;
  taskSlug: string;
  cwd: string;
  features?: FeatureSet;
}

// Minimal machine context shape used by harnyActions assigns; concrete machines extend this
export interface HarnessContext {
  currentTaskIdx: number;
  attempts: number;
  validatorResult: unknown;
  devSession: unknown;
}

// §9.1.1 — options for the agentActor dispatcher
export interface AgentActorOptions {
  phase: string;
  prompt: string;
  context?: ActorContext;
}

// §4.4, §9.1.1 — options for the commandActor dispatcher
export interface CommandActorOptions {
  cmd: string[];
  cwd?: string;
  timeout_ms?: number;
  advisory?: boolean;
  idempotent?: boolean;
  context?: ActorContext;
}

// §7.2 — options for the humanReviewActor dispatcher
export interface HumanReviewActorOptions {
  message: string | ((args: { context: HarnessContext }) => string);
  options?: HumanReviewOption[];
  previousAnswer?: HumanReviewOutput;
}
