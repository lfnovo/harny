import { z } from "zod";
import { resolve } from "node:path";

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
