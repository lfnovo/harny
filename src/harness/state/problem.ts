import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

export const PROBLEM_SCHEMA_VERSION = 1;

export const ProblemCategorySchema = z.enum([
  "environment",
  "design",
  "understanding",
  "tooling",
]);

export const ProblemSeveritySchema = z.enum(["low", "medium", "high"]);

export const ProblemSchema = z
  .object({
    category: ProblemCategorySchema.describe(
      "environment: missing deps/tools/config. design: ambiguous task/plan/acceptance. understanding: insufficient context/docs. tooling: harness or agent tooling gap.",
    ),
    severity: ProblemSeveritySchema.describe(
      "low: minor friction. medium: slowed progress noticeably. high: forced workaround or blocked a criterion.",
    ),
    description: z
      .string()
      .describe(
        "1-3 sentences. What you ran into, and what would need to change at the project/config/docs/tooling level to avoid it next time. Concrete, not vague.",
      ),
  })
  .strict();

export type Problem = z.infer<typeof ProblemSchema>;
export type ProblemCategory = z.infer<typeof ProblemCategorySchema>;
export type ProblemSeverity = z.infer<typeof ProblemSeveritySchema>;

export const PersistedProblemSchema = ProblemSchema.extend({
  schema_version: z.literal(PROBLEM_SCHEMA_VERSION),
  id: z.string(),
  at: z.string(),
  phase: z.string(),
  session_id: z.string(),
  task_id: z.string().nullable(),
}).strict();

export type PersistedProblem = z.infer<typeof PersistedProblemSchema>;

export function problemsDir(primaryCwd: string, taskSlug: string): string {
  return resolve(primaryCwd, ".harny", taskSlug, "problems");
}

function generateId(): string {
  const ts = Date.now().toString(36).padStart(9, "0");
  const rand = randomBytes(5).toString("hex");
  return `${ts}_${rand}`;
}

export async function writeProblems(args: {
  primaryCwd: string;
  taskSlug: string;
  phase: string;
  sessionId: string;
  taskId: string | null;
  problems: Problem[];
}): Promise<string[]> {
  if (args.problems.length === 0) return [];
  const dir = problemsDir(args.primaryCwd, args.taskSlug);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const written: string[] = [];
  for (const p of args.problems) {
    const id = generateId();
    const record: PersistedProblem = {
      schema_version: PROBLEM_SCHEMA_VERSION,
      id,
      at: now,
      phase: args.phase,
      session_id: args.sessionId,
      task_id: args.taskId,
      ...p,
    };
    const path = join(dir, `${id}.json`);
    await writeFile(path, JSON.stringify(record, null, 2) + "\n", "utf8");
    written.push(path);
  }
  return written;
}
