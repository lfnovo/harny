import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export type LogMode = "compact" | "verbose" | "quiet";

/**
 * Open shape — workflows declare any phase name they like. Kept as a named
 * alias for documentation/discoverability; not a closed union.
 */
export type PhaseName = string;

export type IsolationMode = "worktree" | "inline";

/**
 * How the harness handles human-in-the-loop interactions:
 * - interactive: TTY readline for both ctx.askUser and AskUserQuestion.
 * - silent: no human available; AskUserQuestion is stripped from allowedTools
 *   and ctx.askUser throws SilentModeError. Agent must make a defensible default.
 * - async: park questions in pending_questions, exit waiting_human, resume
 *   later via `harny answer <runId>`.
 */
export type RunMode = "interactive" | "silent" | "async";

export type PhaseConfig = {
  prompt?: string;
  allowedTools?: string[];
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk"
    | "auto";
  maxTurns?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  model?: "opus" | "sonnet" | "haiku" | "inherit";
  mcpServers?: Record<string, McpServerConfig>;
};

export type HarnessConfigFile = {
  /**
   * Per-phase config overrides. Keys are phase names (e.g. "planner",
   * "developer", "validator", "triage"). Each entry deep-merges with the
   * defaults declared by the workflow's `phaseDefaults`.
   */
  phases?: Record<string, PhaseConfig>;
  maxIterationsPerTask?: number;
  maxIterationsGlobal?: number;
  maxRetriesBeforeReset?: number;
  isolation?: IsolationMode;
  defaultMode?: RunMode;
};

export type ResolvedPhaseConfig = Required<
  Omit<PhaseConfig, "mcpServers" | "model">
> & {
  model: PhaseConfig["model"];
  mcpServers: Record<string, McpServerConfig>;
};

export type ResolvedHarnessConfig = {
  /** Resolved per-phase configs after merging workflow defaults + file overrides. */
  phases: Record<string, ResolvedPhaseConfig>;
  maxIterationsPerTask: number;
  maxIterationsGlobal: number;
  maxRetriesBeforeReset: number;
  isolation: IsolationMode;
  mode: RunMode;
};

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

/**
 * Open shape — workflows define their own typed history entries locally and
 * cast on the way in. Core only requires the discriminator + common fields.
 */
export type PlanTaskHistoryEntry = {
  [key: string]: unknown;
  role: string;
  session_id: string;
  at: string;
};

export type PlanTask = {
  id: string;
  title: string;
  description: string;
  acceptance: string[];
  status: TaskStatus;
  attempts: number;
  commit_sha: string | null;
  history: PlanTaskHistoryEntry[];
  output?: Record<string, unknown>;
};

export type PlanRunStatus =
  | "planning"
  | "in_progress"
  | "done"
  | "failed"
  | "exhausted";

export type Plan = {
  schema_version: 1;
  task_slug: string;
  user_prompt: string;
  branch: string;
  primary_cwd: string;
  isolation: IsolationMode;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
  status: PlanRunStatus;
  summary: string;
  iterations_global: number;
  tasks: PlanTask[];
  run_id?: string;
  /**
   * Per-workflow extension bag. Workflows write their own keys here for
   * state that doesn't belong in core Plan fields (e.g. feature-dev writes
   * `planner_session_id`).
   */
  metadata: Record<string, unknown>;
};
