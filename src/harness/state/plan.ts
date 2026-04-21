import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  IsolationMode,
  Plan,
  PlanTask,
  PlanTaskHistoryEntry,
} from "../types.js";

export function planDir(primaryCwd: string, taskSlug: string): string {
  return join(primaryCwd, ".harness", taskSlug);
}

export function planFilePath(primaryCwd: string, taskSlug: string): string {
  return join(planDir(primaryCwd, taskSlug), "plan.json");
}

export function sessionsDir(primaryCwd: string, taskSlug: string): string {
  return join(planDir(primaryCwd, taskSlug), "sessions");
}

export function worktreePathFor(primaryCwd: string, taskSlug: string): string {
  return join(primaryCwd, ".harness", "worktrees", taskSlug);
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, path);
}

export async function loadPlan(path: string): Promise<Plan> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as Plan;
}

export async function savePlan(path: string, plan: Plan): Promise<void> {
  plan.updated_at = new Date().toISOString();
  await writeJsonAtomic(path, plan);
}

export function createPlanSkeleton(args: {
  taskSlug: string;
  userPrompt: string;
  branch: string;
  primaryCwd: string;
  isolation: IsolationMode;
  worktreePath: string | null;
}): Plan {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    task_slug: args.taskSlug,
    user_prompt: args.userPrompt,
    branch: args.branch,
    primary_cwd: args.primaryCwd,
    isolation: args.isolation,
    worktree_path: args.worktreePath,
    created_at: now,
    updated_at: now,
    status: "planning",
    summary: "",
    iterations_global: 0,
    tasks: [],
    metadata: {},
  };
}

export function findNextPendingTask(plan: Plan): PlanTask | null {
  return (
    plan.tasks.find((t) => t.status === "pending" || t.status === "in_progress") ??
    null
  );
}

export function appendHistory(
  task: PlanTask,
  entry: PlanTaskHistoryEntry,
): void {
  task.history.push(entry);
}

export function markTaskInProgress(task: PlanTask): void {
  task.status = "in_progress";
  task.attempts += 1;
}

export function markTaskDone(task: PlanTask): void {
  task.status = "done";
}

export function markTaskFailed(task: PlanTask): void {
  task.status = "failed";
}

export function isPlanComplete(plan: Plan): boolean {
  return plan.tasks.every((t) => t.status === "done");
}
