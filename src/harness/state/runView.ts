import type { RunEvent, RunSnapshot } from "./runSchema.js";
import type { NodeInstance } from "../workflow/runtime.js";
import { summarizeAttempts, summarizeRunUsage, type UsageSummary, type UsageTotals } from "./usage.js";

export interface RunView {
  run_id: string;
  origin: { prompt: string; workflow: string; task_slug: string; started_at: string; host: string; user: string };
  environment: { cwd: string; branch: string; isolation: string; worktree_path: string | null; mode: string };
  lifecycle: { status: string; current_phase: string | null; ended_at: string | null; ended_reason: string | null; pid: number };
  phases: Array<{ name: string; instance_id: string; attempt: number; started_at: string | null; ended_at: string | null; status: string; verdict: string | null; session_id: string | null; usage: UsageTotals | null; attempts_detail: Array<{ number: number; status: string; started_at: string; ended_at: string | null; error: string | null; usage: import("../providers/types.js").AgentUsage | null; transcript_available: boolean }> }>;
  history: RunEvent[];
  pending_question: null | { id: string; kind: string; prompt: string; options?: unknown[]; asked_at: string; phase_session_id: string | null; phase_name: string };
  plan: null | { summary?: string; iterations_global: number; tasks: Array<Record<string, unknown>> };
  usage: UsageSummary;
}

export interface ExecutionSummary { current_phase: string | null; retries: number }

/**
 * What the run list needs to draw a pipeline: which phase is live, and how many
 * attempts were spent beyond the first.
 *
 * It lives here rather than in the viewer because it walks nodes and steps exactly
 * the way `toRunView` does, and must name them identically -- a step is
 * `tasks:0.developer`, which is what the viewer matches its roles on. Two walks
 * would be two chances to drift.
 *
 * Only leaves count. A `foreach` container reports `running` for as long as any of
 * its children run, so counting it would make every task-phase run look like it was
 * sitting in `tasks`, and its attempts would double-count its children's.
 */
export function summarizeExecution(run: RunSnapshot): ExecutionSummary {
  let current: string | null = null;
  let last: string | null = null;
  let retries = 0;
  const leaf = (name: string, node: NodeInstance) => {
    retries += Math.max(0, (node.attemptHistory?.length ?? node.attempts) - 1);
    // First running wins: with a live node the run is there, whatever ran before.
    if (!current && (node.status === "running" || node.status === "paused")) current = name;
    if (node.status === "completed" || node.status === "failed") last = name;
  };
  for (const node of Object.values(run.execution.nodes)) {
    const steps = Object.entries(node.steps ?? {});
    if (!steps.length) leaf(node.id, node);
    else for (const [key, step] of steps) leaf(`${node.id}:${key}`, step);
  }
  // Nothing running: the run is over, or between nodes. Either way the last phase
  // that did something is the truthful answer, and it beats falling back to Planner.
  return { current_phase: current ?? last, retries };
}

export function toRunView(run: RunSnapshot, events: RunEvent[] = []): RunView {
  const phases: RunView["phases"] = [];
  const add = (name: string, instanceId: string, node: NodeInstance) => { const attempt = node.attemptHistory?.at(-1); phases.push({ name, instance_id: instanceId, attempt: attempt?.number ?? node.attempts, started_at: attempt?.startedAt ?? null, ended_at: attempt?.endedAt ?? null, status: node.status === "paused" ? "parked" : node.status === "skipped" ? "completed" : node.status, verdict: node.output === undefined ? null : JSON.stringify(node.output), session_id: attempt?.session?.id ?? null, usage: summarizeAttempts(node.attemptHistory), attempts_detail: (node.attemptHistory ?? []).map((item) => ({ number: item.number, status: item.status, started_at: item.startedAt, ended_at: item.endedAt ?? null, error: item.error ?? null, usage: item.usage ?? null, transcript_available: false })) }); };
  for (const node of Object.values(run.execution.nodes)) { add(node.id, node.id, node); for (const [key, step] of Object.entries(node.steps ?? {})) { const [index, stepId] = key.split("."); add(`${node.id}:${key}`, `${node.id}:${index}:${stepId}`, step); } }
  const plannerValue = run.execution.nodes.planner?.output; const planner = plannerValue && typeof plannerValue === "object" ? plannerValue as { summary?: string; tasks?: unknown } : undefined;
  const taskNode = Object.values(run.execution.nodes).find((node) => node.steps);
  const plannerTasks = Array.isArray(planner?.tasks) ? planner.tasks.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === "object" && !Array.isArray(task)) : [];
  const tasks = plannerTasks.map((task, index) => { const commit = taskNode?.steps?.[`${index}.commit`]; const developer = taskNode?.steps?.[`${index}.developer`]; return { ...task, status: commit?.status === "completed" ? "done" : developer?.status === "failed" ? "failed" : developer?.status === "running" ? "in_progress" : "pending", attempts: developer?.attempts ?? 0, commit_sha: (commit?.output as { sha?: string } | undefined)?.sha ?? null }; });
  const pending = run.execution.pendingHuman;
  return {
    run_id: run.run.id,
    origin: { prompt: run.origin.prompt, workflow: run.run.workflow, task_slug: run.run.task_slug, started_at: run.run.started_at, host: run.origin.host, user: run.origin.user },
    environment: { cwd: run.workspace.primary_cwd, branch: run.workspace.branch, isolation: run.workspace.isolation, worktree_path: run.workspace.worktree_path, mode: "async" },
    lifecycle: { status: run.execution.status === "paused" ? "waiting_human" : run.execution.status, current_phase: phases.find((phase) => phase.status === "running")?.name ?? null, ended_at: run.run.ended_at, ended_reason: run.run.ended_reason, pid: run.run.pid },
    phases, history: events,
    pending_question: pending ? { id: pending.nodeId, kind: "user_input", prompt: pending.question, options: pending.options, asked_at: pending.askedAt, phase_session_id: pending.session?.id ?? null, phase_name: pending.nodeId } : null,
    plan: planner ? { ...(typeof planner.summary === "string" ? { summary: planner.summary } : {}), iterations_global: Object.values(taskNode?.steps ?? {}).filter((step) => step.id.endsWith("developer")).reduce((sum, step) => sum + step.attempts, 0), tasks } : null,
    usage: summarizeRunUsage(run.execution.nodes),
  };
}
