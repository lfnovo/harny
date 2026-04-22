import { z } from "zod";
import type { Plan } from "./types.js";
import type { AuditEntry } from "./state/audit.js";
import type { PhaseGuards } from "./guardHooks.js";
import type {
  LogMode,
  PhaseName,
  ResolvedHarnessConfig,
  ResolvedPhaseConfig,
  RunMode,
} from "./types.js";

export type WorkflowPhaseResult<T> = {
  sessionId: string;
  status: "completed" | "error";
  structuredOutput: T | null;
  error: string | null;
};

export type AskUserResult =
  | { answered: false; runId: string; questionId: string }
  | { answered: true; answer: string };

export type WorkflowContext = {
  taskSlug: string;
  userPrompt: string;
  primaryCwd: string;
  phaseCwd: string;
  input: unknown;
  config: ResolvedHarnessConfig;
  logMode: LogMode;
  mode: RunMode;
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
    resumeSessionId?: string | null;
  }) => Promise<WorkflowPhaseResult<T>>;
  askUser: (args: {
    prompt: string;
    options?: string[];
  }) => Promise<AskUserResult>;
  /**
   * Populated only when the harness is resuming a parked AskUserQuestion
   * batch (Tier 3b async mode). Lets the workflow know which phase to
   * re-invoke and which SDK session_id to resume with. Absent for fresh runs
   * and for code-side ctx.askUser resumes.
   */
  resumeMeta?: {
    phaseName: string;
    phaseSessionId: string;
    toolUseId: string | null;
  };
};

export type Workflow<TInput = unknown> = {
  id: string;
  needsBranch: boolean;
  needsWorktree: boolean;
  inputSchema?: z.ZodType<TInput>;
  /**
   * Per-phase config defaults this workflow expects. Keys are phase names
   * (e.g. "planner", "triage"). The orchestrator merges these with any
   * overrides from the project's harny.json into ctx.config.phases.
   */
  phaseDefaults: Record<string, ResolvedPhaseConfig>;
  /**
   * Optional default run mode when the CLI/file don't specify one. CLI flag
   * and harny.json defaultMode override this.
   */
  defaultMode?: RunMode;
  run: (ctx: WorkflowContext) => Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human" }>;
  /**
   * Resumes a parked run with the user's answer. The answer is a string for
   * code-side ctx.askUser parks, or a Record<question, label> map for
   * AskUserQuestion batch parks (Tier 3b).
   */
  resumeFromAnswer?: (
    ctx: WorkflowContext,
    answer: string | Record<string, string>,
  ) => Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human" }>;
};

export function defineWorkflow<TInput = unknown>(
  def: Workflow<TInput>,
): Workflow<TInput> {
  return def;
}
