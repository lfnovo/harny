import { z } from "zod";
import { ProblemSchema } from "../../problem.js";

const PROBLEMS_FIELD_DESCRIPTION =
  "OPTIONAL. Problems encountered during this attempt that would benefit FUTURE runs of the harness if fixed at the project level (not fixed within this task). Examples: missing CLAUDE.md coverage of a critical area, missing dev dependency, ambiguous acceptance criterion, agent tool you wished you had. Leave empty/omit if nothing noteworthy.";

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
    problems: z
      .array(ProblemSchema)
      .optional()
      .describe(PROBLEMS_FIELD_DESCRIPTION),
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
    problems: z
      .array(ProblemSchema)
      .optional()
      .describe(PROBLEMS_FIELD_DESCRIPTION),
  })
  .strict();

export type PlannerVerdict = z.infer<typeof PlannerVerdictSchema>;
export type DeveloperVerdict = z.infer<typeof DeveloperVerdictSchema>;
export type ValidatorVerdict = z.infer<typeof ValidatorVerdictSchema>;
