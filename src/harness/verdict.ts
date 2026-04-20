import { z } from "zod";

export const PlannerVerdictSchema = z
  .object({
    summary: z.string().describe("One-line description of what will be built"),
    tasks: z
      .array(
        z.object({
          id: z.string().describe("Unique task identifier in execution order (e.g. t1, t2)"),
          title: z.string().describe("Short imperative title"),
          description: z.string().describe("What to do and why"),
          acceptance: z
            .array(z.string())
            .describe("Specific, testable acceptance criteria"),
        }),
      )
      .min(1),
  })
  .strict();

export const DeveloperVerdictSchema = z
  .object({
    task_id: z.string(),
    status: z.enum(["done", "blocked"]),
    summary: z
      .string()
      .describe("2-3 sentence description of what changed"),
    commit_message: z
      .string()
      .describe(
        "Proposed conventional-commit message (subject line only, or subject + body). The harness will commit on your behalf if validation passes. Empty string if status is blocked.",
      ),
    blocked_reason: z
      .string()
      .optional()
      .describe("Required when status is blocked"),
  })
  .strict();

export const ValidatorVerdictSchema = z
  .object({
    task_id: z.string(),
    verdict: z.enum(["pass", "fail"]),
    reasons: z
      .array(z.string())
      .describe("Specific, actionable reasons for the verdict"),
    evidence: z
      .string()
      .describe("What was actually run or observed to reach this verdict"),
    recommend_reset: z
      .boolean()
      .optional()
      .describe(
        "Set to true (only when verdict is 'fail') if the developer's approach is fundamentally wrong, or if the code is so broken that a fresh start beats iterating on it.",
      ),
  })
  .strict();

export type PlannerVerdict = z.infer<typeof PlannerVerdictSchema>;
export type DeveloperVerdict = z.infer<typeof DeveloperVerdictSchema>;
export type ValidatorVerdict = z.infer<typeof ValidatorVerdictSchema>;

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // The claude-code binary silently ignores the schema when the top-level has
  // a "$schema" key, which Zod emits by default. Strip it.
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void $schema;
  return rest;
}
