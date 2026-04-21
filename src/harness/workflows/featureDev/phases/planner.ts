import { PlannerVerdictSchema, type PlannerVerdict } from "../verdicts.js";
import type { WorkflowContext } from "../../../workflow.js";

export async function runPlanner(args: {
  ctx: WorkflowContext;
  userPrompt: string;
}): Promise<{ sessionId: string; verdict: PlannerVerdict }> {
  const prompt = `User request:
${args.userPrompt}

Produce the implementation plan as described in your instructions.`;

  const result = await args.ctx.runPhase({
    phase: "planner",
    prompt,
    outputSchema: PlannerVerdictSchema,
    guards: { readOnly: true },
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`planner phase failed: ${result.error ?? "unknown"}`);
  }
  return { sessionId: result.sessionId, verdict: result.structuredOutput };
}
