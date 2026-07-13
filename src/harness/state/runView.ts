import type { RunEvent, RunSnapshot } from "./runSchema.js";
import type { NodeInstance } from "../workflow/runtime.js";
import { summarizeAttempts, summarizeRunUsage, type UsageSummary, type UsageTotals } from "./usage.js";

export interface RunView {
  run_id: string;
  origin: { prompt: string; workflow: string; task_slug: string; started_at: string; host: string; user: string };
  environment: { cwd: string; branch: string; isolation: string; worktree_path: string | null; mode: string };
  lifecycle: { status: string; current_phase: string | null; ended_at: string | null; ended_reason: string | null; pid: number };
  phases: Array<{ name: string; instance_id: string; attempt: number; started_at: string; ended_at: string | null; status: string; verdict: string | null; session_id: string | null; usage: UsageTotals | null; attempts_detail: Array<{ number: number; status: string; started_at: string; ended_at: string | null; error: string | null; usage: import("../providers/types.js").AgentUsage | null; transcript_available: boolean }> }>;
  history: RunEvent[];
  pending_question: null | { id: string; kind: string; prompt: string; options?: unknown[]; asked_at: string; phase_session_id: string | null; phase_name: string };
  plan: null | { summary?: string; iterations_global: number; tasks: Array<Record<string, unknown>> };
  usage: UsageSummary;
}

export function toRunView(run: RunSnapshot, events: RunEvent[] = []): RunView {
  const phases: RunView["phases"] = [];
  const add = (name: string, instanceId: string, node: NodeInstance) => { const attempt = node.attemptHistory?.at(-1); phases.push({ name, instance_id: instanceId, attempt: attempt?.number ?? (node.attempts || 1), started_at: attempt?.startedAt ?? run.run.started_at, ended_at: attempt?.endedAt ?? null, status: node.status === "paused" ? "parked" : node.status === "skipped" ? "completed" : node.status, verdict: node.output === undefined ? null : JSON.stringify(node.output), session_id: attempt?.session?.id ?? null, usage: summarizeAttempts(node.attemptHistory), attempts_detail: (node.attemptHistory ?? []).map((item) => ({ number: item.number, status: item.status, started_at: item.startedAt, ended_at: item.endedAt ?? null, error: item.error ?? null, usage: item.usage ?? null, transcript_available: false })) }); };
  for (const node of Object.values(run.execution.nodes)) { add(node.id, node.id, node); for (const [key, step] of Object.entries(node.steps ?? {})) { const [index, stepId] = key.split("."); add(`${node.id}:${key}`, `${node.id}:${index}:${stepId}`, step); } }
  const planner = run.execution.nodes.planner?.output as { summary?: string; tasks?: Array<Record<string, unknown>> } | undefined;
  const taskNode = Object.values(run.execution.nodes).find((node) => node.steps);
  const tasks = planner?.tasks?.map((task, index) => { const commit = taskNode?.steps?.[`${index}.commit`]; const developer = taskNode?.steps?.[`${index}.developer`]; return { ...task, status: commit?.status === "completed" ? "done" : developer?.status === "failed" ? "failed" : developer?.status === "running" ? "in_progress" : "pending", attempts: developer?.attempts ?? 0, commit_sha: (commit?.output as { sha?: string } | undefined)?.sha ?? null }; }) ?? [];
  const pending = run.execution.pendingHuman;
  return {
    run_id: run.run.id,
    origin: { prompt: run.origin.prompt, workflow: run.run.workflow, task_slug: run.run.task_slug, started_at: run.run.started_at, host: run.origin.host, user: run.origin.user },
    environment: { cwd: run.workspace.primary_cwd, branch: run.workspace.branch, isolation: run.workspace.isolation, worktree_path: run.workspace.worktree_path, mode: "async" },
    lifecycle: { status: run.execution.status === "paused" ? "waiting_human" : run.execution.status, current_phase: phases.find((phase) => phase.status === "running")?.name ?? null, ended_at: run.run.ended_at, ended_reason: run.run.ended_reason, pid: run.run.pid },
    phases, history: events,
    pending_question: pending ? { id: pending.nodeId, kind: "user_input", prompt: pending.question, options: pending.options, asked_at: pending.askedAt, phase_session_id: pending.session?.id ?? null, phase_name: pending.nodeId } : null,
    plan: planner ? { summary: planner.summary, iterations_global: Object.values(taskNode?.steps ?? {}).filter((step) => step.id.endsWith("developer")).reduce((sum, step) => sum + step.attempts, 0), tasks } : null,
    usage: summarizeRunUsage(run.execution.nodes),
  };
}
