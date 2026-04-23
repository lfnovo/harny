import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Plan } from "../types.js";
import { writeJsonAtomic } from "./atomic.js";

export function planDir(primaryCwd: string, taskSlug: string): string {
  return join(primaryCwd, ".harny", taskSlug);
}

export function planFilePath(primaryCwd: string, taskSlug: string): string {
  return join(planDir(primaryCwd, taskSlug), "plan.json");
}

export function worktreePathFor(primaryCwd: string, taskSlug: string): string {
  return join(primaryCwd, ".harny", "worktrees", taskSlug);
}

// Plan schema — mirror of the Plan/PlanTask/PlanTaskHistoryEntry types in
// types.ts. loadPlan validates with safeParse and throws a clear error on
// corrupt files, matching the discipline applied to state.json. Writers go
// through savePlan which double-checks the shape before atomic rename.
const TaskStatusSchema = z.enum(["pending", "in_progress", "done", "failed"]);

const PlanTaskHistoryEntrySchema = z
  .object({
    role: z.string(),
    session_id: z.string(),
    at: z.string(),
  })
  .passthrough();

const PlanTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptance: z.array(z.string()),
  status: TaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  commit_sha: z.string().nullable(),
  history: z.array(PlanTaskHistoryEntrySchema),
  output: z.record(z.string(), z.unknown()).optional(),
});

const PlanRunStatusSchema = z.enum([
  "planning",
  "in_progress",
  "done",
  "failed",
  "exhausted",
]);

export const PlanSchema = z.object({
  schema_version: z.literal(1),
  task_slug: z.string(),
  user_prompt: z.string(),
  branch: z.string(),
  primary_cwd: z.string(),
  isolation: z.enum(["worktree", "inline"]),
  worktree_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  status: PlanRunStatusSchema,
  summary: z.string(),
  iterations_global: z.number().int().nonnegative(),
  tasks: z.array(PlanTaskSchema),
  run_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
});

export async function loadPlan(path: string): Promise<Plan> {
  const raw = await readFile(path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `plan.json at ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }
  const parsed = PlanSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `plan.json at ${path} failed schema validation (schema_version mismatch or corrupt). ` +
        `Delete the run dir or re-run with a new task slug. ` +
        `Details: ${parsed.error.message}`,
    );
  }
  return parsed.data as Plan;
}

export async function savePlan(path: string, plan: Plan): Promise<void> {
  plan.updated_at = new Date().toISOString();
  // Validate on write too — catches bad constructions (bad data from planner)
  // at the persistence boundary rather than at future load time.
  const parsed = PlanSchema.safeParse(plan);
  if (!parsed.success) {
    throw new Error(
      `savePlan refused: plan failed schema validation. ${parsed.error.message}`,
    );
  }
  await writeJsonAtomic(path, plan);
}
