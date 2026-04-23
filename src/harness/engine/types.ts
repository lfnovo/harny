// engine-design.md §6.1, §7, §8

import type { AnyStateMachine } from 'xstate';
import type { Plan } from '../types.ts';

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
  kind?: 'text' | 'option';
  value: string;
  text?: string;
}

// §8 — typed wrapper returned by defineWorkflow
export interface WorkflowDefinition<TMachine extends AnyStateMachine> {
  id: string;
  needsBranch?: boolean;
  needsWorktree?: boolean;
  machine: TMachine;
  // Optional. When set, runEngineWorkflow calls machine.provide({ actors: buildActors(deps) }) before createActor.
  buildActors?: (deps: { cwd: string; taskSlug: string; runId: string }) => Record<string, any>;
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

// Bookkeeping context for plan-driven workflows; assigns in harnyActions operate on this shape
export interface PlanDrivenContext {
  plan: Plan;
  currentTaskIdx: number;
  attempts: number;
  validatorSession?: string;
  devSession?: string;
  iterationsGlobal: number;
  iterationsThisTask: number;
}

// §9.1.1 — options for the agentActor dispatcher
export interface AgentActorOptions {
  phaseName: string;
  prompt: string;
  schema: object;
  allowedTools: string[];
  resumeSessionId?: string;
  runPhase: (args: {
    phaseName: string;
    prompt: string;
    schema: object;
    allowedTools: string[];
    resumeSessionId?: string;
    signal: AbortSignal;
  }) => Promise<{ output: unknown; session_id: string }>;
  context?: ActorContext;
}

export type AgentRunOptions = AgentActorOptions;

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

// §8.4 — DI-friendly options for runHumanReview / humanReviewActor
export interface HumanReviewRunOptions {
  message: string;
  options?: HumanReviewOption[];
  askProvider: (req: {
    message: string;
    options?: HumanReviewOption[];
    signal: AbortSignal;
  }) => Promise<HumanReviewOutput>;
}
