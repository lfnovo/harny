import { runPhase } from "../sessionRecorder.js";
import { ValidatorVerdictSchema, type ValidatorVerdict } from "../verdict.js";
import type { Plan, PlanTask, ResolvedPhaseConfig } from "../types.js";

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
  cwd: string;
  taskSlug: string;
  plan: Plan;
  task: PlanTask;
  developerSummary: string;
  verbose?: boolean;
}): Promise<{ sessionId: string; verdict: ValidatorVerdict }> {
  const prompt = [
    `Plan summary: ${args.plan.summary}`,
    "",
    describeTaskForValidation(args.task),
    "",
    `Developer reports: ${args.developerSummary}`,
    "",
    "Independently verify each acceptance criterion by exercising the behavior.",
  ].join("\n");

  const result = await runPhase({
    phase: "validator",
    phaseConfig: args.phaseConfig,
    cwd: args.cwd,
    taskSlug: args.taskSlug,
    harnessTaskId: args.task.id,
    prompt,
    outputSchema: ValidatorVerdictSchema,
    verbose: args.verbose,
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
  return { sessionId: result.sessionId, verdict };
}
