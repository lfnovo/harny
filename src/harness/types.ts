import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { PhaseGuards } from "./guardHooks.js";

export type LogMode = "compact" | "verbose" | "quiet";

/**
 * Open shape — workflows declare any phase name they like. Kept as a named
 * alias for documentation/discoverability; not a closed union.
 */
export type PhaseName = string;

export type IsolationMode = "worktree" | "inline";

/**
 * How the harness handles human-in-the-loop interactions:
 * - interactive: TTY readline for AskUserQuestion tool calls.
 * - silent: AskUserQuestion is stripped from allowedTools before the SDK sees
 *   it (belt-and-suspenders deny on any stray call). Agent must make a
 *   defensible default.
 * - async: AskUserQuestion calls are parked in state.pending_question and the
 *   run exits waiting_human. NOTE: engine workflows do not yet implement
 *   resume — a parked run is currently discard-only via `harny clean <slug>`.
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
  /**
   * SDK-level PreToolUse deny hooks installed for this phase. Enforces
   * invariants agents can't be trusted to respect via prompt alone
   * (harness sole-writer of plan.json, sole-committer, validator read-only).
   * See src/harness/guardHooks.ts.
   */
  guards?: PhaseGuards;
};

export type ResolvedPhaseConfig = Required<
  Omit<PhaseConfig, "mcpServers" | "model">
> & {
  model: PhaseConfig["model"];
  mcpServers: Record<string, McpServerConfig>;
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
