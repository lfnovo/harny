import { ValidatorVerdictSchema, type ValidatorVerdict } from "../verdicts.js";
import { writeProblems } from "../../../state/problem.js";
import type { Plan, PlanTask } from "../../../types.js";
import type { WorkflowContext } from "../../../workflow.js";

function describeTaskForValidation(task: PlanTask): string {
  return [
    `Task to validate: ${task.id} — ${task.title}`,
    `Description: ${task.description}`,
    `Acceptance criteria (verify EACH):`,
    ...task.acceptance.map((a, i) => `  ${i + 1}. ${a}`),
  ].join("\n");
}

export async function runValidator(args: {
  ctx: WorkflowContext;
  plan: Plan;
  task: PlanTask;
  developerSummary: string;
}): Promise<{ sessionId: string; verdict: ValidatorVerdict }> {
  const { ctx, plan, task, developerSummary } = args;
  const prompt = [
    `Plan summary: ${plan.summary}`,
    "",
    describeTaskForValidation(task),
    "",
    `Developer reports: ${developerSummary}`,
    "",
    "Changes are in the working tree and NOT yet committed. Exercise the behavior to verify each acceptance criterion.",
  ].join("\n");

  const result = await ctx.runPhase({
    phase: "validator",
    prompt,
    outputSchema: ValidatorVerdictSchema,
    harnessTaskId: task.id,
    guards: { readOnly: true },
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`validator phase failed: ${result.error ?? "unknown"}`);
  }
  const verdict = result.structuredOutput;
  if (verdict.task_id !== task.id) {
    throw new Error(
      `validator returned task_id "${verdict.task_id}" but current task is "${task.id}"`,
    );
  }
  if (verdict.problems && verdict.problems.length > 0) {
    await writeProblems({
      primaryCwd: ctx.primaryCwd,
      taskSlug: ctx.taskSlug,
      phase: "validator",
      sessionId: result.sessionId,
      taskId: task.id,
      problems: verdict.problems,
    });
  }
  return { sessionId: result.sessionId, verdict };
}
