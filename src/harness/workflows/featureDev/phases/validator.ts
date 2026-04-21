import { runPhase } from "../../../sessionRecorder.js";
import { ValidatorVerdictSchema, type ValidatorVerdict } from "../verdicts.js";
import { writeProblems } from "../../../state/problem.js";
import type { LogMode, Plan, PlanTask, ResolvedPhaseConfig } from "../../../types.js";

function describeTaskForValidation(task: PlanTask): string {
  return [
    `Task to validate: ${task.id} — ${task.title}`,
    `Description: ${task.description}`,
    `Acceptance criteria (verify EACH):`,
    ...task.acceptance.map((a, i) => `  ${i + 1}. ${a}`),
  ].join("\n");
}

export async function runValidator(args: {
  phaseConfig: ResolvedPhaseConfig;
  primaryCwd: string;
  phaseCwd: string;
  taskSlug: string;
  plan: Plan;
  task: PlanTask;
  developerSummary: string;
  logMode?: LogMode;
}): Promise<{ sessionId: string; verdict: ValidatorVerdict }> {
  const prompt = [
    `Plan summary: ${args.plan.summary}`,
    "",
    describeTaskForValidation(args.task),
    "",
    `Developer reports: ${args.developerSummary}`,
    "",
    "Changes are in the working tree and NOT yet committed. Exercise the behavior to verify each acceptance criterion.",
  ].join("\n");

  const result = await runPhase({
    phase: "validator",
    phaseConfig: args.phaseConfig,
    primaryCwd: args.primaryCwd,
    phaseCwd: args.phaseCwd,
    taskSlug: args.taskSlug,
    harnessTaskId: args.task.id,
    prompt,
    outputSchema: ValidatorVerdictSchema,
    logMode: args.logMode,
    guards: { readOnly: true },
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`validator phase failed: ${result.error ?? "unknown"}`);
  }
  const verdict = result.structuredOutput;
  if (verdict.task_id !== args.task.id) {
    throw new Error(
      `validator returned task_id "${verdict.task_id}" but current task is "${args.task.id}"`,
    );
  }
  if (verdict.problems && verdict.problems.length > 0) {
    await writeProblems({
      primaryCwd: args.primaryCwd,
      taskSlug: args.taskSlug,
      phase: "validator",
      sessionId: result.sessionId,
      taskId: args.task.id,
      problems: verdict.problems,
    });
  }
  return { sessionId: result.sessionId, verdict };
}
