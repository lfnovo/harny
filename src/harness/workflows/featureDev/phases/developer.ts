import { runPhase } from "../../../sessionRecorder.js";
import {
  DeveloperVerdictSchema,
  type DeveloperVerdict,
  type ValidatorVerdict,
} from "../verdicts.js";
import { writeProblems } from "../../../problem.js";
import { buildFreshPrompt, buildResumePrompt } from "../plan.js";
import type {
  LogMode,
  Plan,
  PlanTask,
  ResolvedPhaseConfig,
} from "../../../types.js";

export async function runDeveloper(args: {
  phaseConfig: ResolvedPhaseConfig;
  primaryCwd: string;
  phaseCwd: string;
  taskSlug: string;
  plan: Plan;
  task: PlanTask;
  resume?: {
    sessionId: string;
    lastValidator: ValidatorVerdict;
  } | null;
  logMode?: LogMode;
}): Promise<{ sessionId: string; verdict: DeveloperVerdict }> {
  const prompt = args.resume
    ? buildResumePrompt(args.resume.lastValidator)
    : buildFreshPrompt(args.plan, args.task);

  const result = await runPhase({
    phase: "developer",
    phaseConfig: args.phaseConfig,
    primaryCwd: args.primaryCwd,
    phaseCwd: args.phaseCwd,
    taskSlug: args.taskSlug,
    harnessTaskId: args.task.id,
    prompt,
    outputSchema: DeveloperVerdictSchema,
    resumeSessionId: args.resume?.sessionId ?? null,
    logMode: args.logMode,
    guards: { noPlanWrites: true, noGitHistory: true },
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`developer phase failed: ${result.error ?? "unknown"}`);
  }
  const verdict = result.structuredOutput;
  if (verdict.task_id !== args.task.id) {
    throw new Error(
      `developer returned task_id "${verdict.task_id}" but current task is "${args.task.id}"`,
    );
  }
  if (verdict.status === "blocked" && !verdict.blocked_reason) {
    throw new Error("developer returned status=blocked without blocked_reason");
  }
  if (verdict.problems && verdict.problems.length > 0) {
    await writeProblems({
      primaryCwd: args.primaryCwd,
      taskSlug: args.taskSlug,
      phase: "developer",
      sessionId: result.sessionId,
      taskId: args.task.id,
      problems: verdict.problems,
    });
  }
  return { sessionId: result.sessionId, verdict };
}
