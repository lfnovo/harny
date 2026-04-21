import {
  DeveloperVerdictSchema,
  type DeveloperVerdict,
  type ValidatorVerdict,
} from "../verdicts.js";
import { writeProblems } from "../../../state/problem.js";
import { buildFreshPrompt, buildResumePrompt } from "../plan.js";
import type { Plan, PlanTask } from "../../../types.js";
import type { WorkflowContext } from "../../../workflow.js";

export async function runDeveloper(args: {
  ctx: WorkflowContext;
  plan: Plan;
  task: PlanTask;
  resume?: {
    sessionId: string;
    lastValidator: ValidatorVerdict;
  } | null;
}): Promise<{ sessionId: string; verdict: DeveloperVerdict }> {
  const { ctx, plan, task, resume } = args;
  const prompt = resume
    ? buildResumePrompt(resume.lastValidator)
    : buildFreshPrompt(plan, task);

  const result = await ctx.runPhase({
    phase: "developer",
    prompt,
    outputSchema: DeveloperVerdictSchema,
    harnessTaskId: task.id,
    resumeSessionId: resume?.sessionId ?? null,
    guards: { noPlanWrites: true, noGitHistory: true },
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`developer phase failed: ${result.error ?? "unknown"}`);
  }
  const verdict = result.structuredOutput;
  if (verdict.task_id !== task.id) {
    throw new Error(
      `developer returned task_id "${verdict.task_id}" but current task is "${task.id}"`,
    );
  }
  if (verdict.status === "blocked" && !verdict.blocked_reason) {
    throw new Error("developer returned status=blocked without blocked_reason");
  }
  if (verdict.problems && verdict.problems.length > 0) {
    await writeProblems({
      primaryCwd: ctx.primaryCwd,
      taskSlug: ctx.taskSlug,
      phase: "developer",
      sessionId: result.sessionId,
      taskId: task.id,
      problems: verdict.problems,
    });
  }
  return { sessionId: result.sessionId, verdict };
}
