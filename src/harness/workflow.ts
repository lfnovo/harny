import { z } from "zod";
import type { Plan } from "./types.js";
import type { AuditEntry } from "./state/audit.js";
import type { PhaseGuards } from "./guardHooks.js";
import type {
  LogMode,
  PhaseName,
  ResolvedHarnessConfig,
  ResolvedPhaseConfig,
} from "./types.js";

export type WorkflowPhaseResult<T> = {
  sessionId: string;
  status: "completed" | "error";
  structuredOutput: T | null;
  error: string | null;
};

export type WorkflowContext = {
  taskSlug: string;
  userPrompt: string;
  primaryCwd: string;
  phaseCwd: string;
  input: unknown;
  config: ResolvedHarnessConfig;
  logMode: LogMode;
  planPath: string;
  plan: Plan;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  updatePlan: (mutator: (plan: Plan) => void) => Promise<void>;
  audit: (entry: AuditEntry) => Promise<void>;
  currentSha: () => Promise<string>;
  commit: (message: string) => Promise<string | null>;
  resetHard: (sha: string) => Promise<void>;
  cleanUntracked: () => Promise<void>;
  runPhase: <T>(args: {
    phase: PhaseName;
    prompt: string;
    outputSchema: z.ZodType<T>;
    harnessTaskId?: string | null;
    allowedTools?: string[];
    guards?: PhaseGuards;
  }) => Promise<WorkflowPhaseResult<T>>;
};

export type Workflow<TInput = unknown> = {
  id: string;
  needsBranch: boolean;
  needsWorktree: boolean;
  inputSchema?: z.ZodType<TInput>;
  /**
   * Per-phase config defaults this workflow expects. Keys are phase names
   * (e.g. "planner", "triage"). The orchestrator merges these with any
   * overrides from the project's harness.json into ctx.config.phases.
   */
  phaseDefaults: Record<string, ResolvedPhaseConfig>;
  run: (ctx: WorkflowContext) => Promise<{ status: "done" | "failed" | "exhausted" }>;
};

export function defineWorkflow<TInput = unknown>(
  def: Workflow<TInput>,
): Workflow<TInput> {
  return def;
}
