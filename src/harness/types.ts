import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export type PhaseName = "planner" | "developer" | "validator";

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
  planner?: PhaseConfig;
  developer?: PhaseConfig;
  validator?: PhaseConfig;
  maxIterationsPerTask?: number;
  maxIterationsGlobal?: number;
};

export type ResolvedPhaseConfig = Required<
  Omit<PhaseConfig, "mcpServers" | "model">
> & {
  model: PhaseConfig["model"];
  mcpServers: Record<string, McpServerConfig>;
};

export type ResolvedHarnessConfig = {
  planner: ResolvedPhaseConfig;
  developer: ResolvedPhaseConfig;
  validator: ResolvedPhaseConfig;
  maxIterationsPerTask: number;
  maxIterationsGlobal: number;
};

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export type PlanTaskHistoryEntry =
  | {
      role: "developer";
      session_id: string;
      at: string;
      status: "done" | "blocked";
      summary: string;
      commit_sha: string;
      blocked_reason?: string;
    }
  | {
      role: "validator";
      session_id: string;
      at: string;
      verdict: "pass" | "fail";
      reasons: string[];
      evidence: string;
    };

export type PlanTask = {
  id: string;
  title: string;
  description: string;
  acceptance: string[];
  status: TaskStatus;
  attempts: number;
  history: PlanTaskHistoryEntry[];
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
  cwd: string;
  created_at: string;
  updated_at: string;
  status: PlanRunStatus;
  summary: string;
  planner_session_id: string | null;
  iterations_global: number;
  tasks: PlanTask[];
};

