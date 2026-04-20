import { runPhase } from "../sessionRecorder.js";
import { PlannerVerdictSchema, type PlannerVerdict } from "../verdict.js";
import type { ResolvedPhaseConfig } from "../types.js";

export async function runPlanner(args: {
  phaseConfig: ResolvedPhaseConfig;
  cwd: string;
  taskSlug: string;
  userPrompt: string;
  verbose?: boolean;
}): Promise<{ sessionId: string; verdict: PlannerVerdict }> {
  const prompt = `User request:
${args.userPrompt}

Produce the implementation plan as described in your instructions.`;

  const result = await runPhase({
    phase: "planner",
    phaseConfig: args.phaseConfig,
    cwd: args.cwd,
    taskSlug: args.taskSlug,
    harnessTaskId: null,
    prompt,
    outputSchema: PlannerVerdictSchema,
    verbose: args.verbose,
  });

  if (result.status !== "completed" || !result.structuredOutput) {
    throw new Error(`planner phase failed: ${result.error ?? "unknown"}`);
  }
  return { sessionId: result.sessionId, verdict: result.structuredOutput };
}
