import { runPhase } from "../sessionRecorder.js";
import { PlannerVerdictSchema, type PlannerVerdict } from "../verdict.js";
import type { LogMode, ResolvedPhaseConfig } from "../types.js";

export async function runPlanner(args: {
  phaseConfig: ResolvedPhaseConfig;
  primaryCwd: string;
  phaseCwd: string;
  taskSlug: string;
  userPrompt: string;
  logMode?: LogMode;
}): Promise<{ sessionId: string; verdict: PlannerVerdict }> {
  const prompt = `User request:
${args.userPrompt}

Produce the implementation plan as described in your instructions.`;

  const result = await runPhase({
    phase: "planner",
    phaseConfig: args.phaseConfig,
    primaryCwd: args.primaryCwd,
    phaseCwd: args.phaseCwd,
    taskSlug: args.taskSlug,
    harnessTaskId: null,
    prompt,
    outputSchema: PlannerVerdictSchema,
    logMode: args.logMode,
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`planner phase failed: ${result.error ?? "unknown"}`);
  }
  return { sessionId: result.sessionId, verdict: result.structuredOutput };
}
