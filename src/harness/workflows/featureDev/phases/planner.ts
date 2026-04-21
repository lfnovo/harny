import { PlannerVerdictSchema, type PlannerVerdict } from "../verdicts.js";
import type { WorkflowContext } from "../../../workflow.js";

export async function runPlanner(args: {
  ctx: WorkflowContext;
  userPrompt: string;
  resumeSessionId?: string | null;
  /** Q&A from a parked AskUserQuestion batch, prepended to the prompt on resume. */
  askUserAnswers?: Record<string, string>;
}): Promise<{ sessionId: string; verdict: PlannerVerdict }> {
  let prompt = `User request:
${args.userPrompt}

Produce the implementation plan as described in your instructions.`;

  if (args.askUserAnswers && Object.keys(args.askUserAnswers).length > 0) {
    const lines = Object.entries(args.askUserAnswers).map(
      ([q, a]) => `- Q: ${q}\n  A: ${a}`,
    );
    prompt = `The previous AskUserQuestion was answered by the user:
${lines.join("\n")}

Use these answers as resolved context. Do NOT call AskUserQuestion again on these topics. Continue producing the plan.

${prompt}`;
  }

  const result = await args.ctx.runPhase({
    phase: "planner",
    prompt,
    outputSchema: PlannerVerdictSchema,
    guards: { readOnly: true },
    resumeSessionId: args.resumeSessionId ?? null,
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`planner phase failed: ${result.error ?? "unknown"}`);
  }
  return { sessionId: result.sessionId, verdict: result.structuredOutput };
}
