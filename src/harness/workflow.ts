import { z } from "zod";
import type { Plan } from "./types.js";
import type { AuditEntry } from "./audit.js";
import type { LogMode, ResolvedHarnessConfig } from "./types.js";

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
};

export type Workflow<TInput = unknown> = {
  id: string;
  needsBranch: boolean;
  needsWorktree: boolean;
  inputSchema?: z.ZodType<TInput>;
  run: (ctx: WorkflowContext) => Promise<{ status: "done" | "failed" | "exhausted" }>;
};

export function defineWorkflow<TInput = unknown>(
  def: Workflow<TInput>,
): Workflow<TInput> {
  return def;
}
