import { runHarness } from "../harness/orchestrator.js";
import { getWorkflow } from "../harness/workflows/index.js";
import { resolveAssistant } from "./context.js";
import type { RunnerContext } from "./context.js";
import type { IsolationMode, RunMode } from "../harness/types.js";

type RunArgs = {
  workflow: string | null;
  task: string | null;
  isolation: IsolationMode | null;
  mode: RunMode | null;
  prompt: string;
};

export async function handleRun(parsed: RunArgs, ctx: RunnerContext): Promise<void> {
  const workflowArgRaw = parsed.workflow ?? "feature-dev";
  const [workflowId = "feature-dev", variant] = workflowArgRaw.split(":");
  try {
    getWorkflow(workflowId);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  if (!parsed.prompt) throw new Error("a prompt is required (describe the work in quotes)");
  const assistant = await resolveAssistant(ctx.assistantName);
  const result = await runHarness({
    cwd: assistant.cwd,
    userPrompt: parsed.prompt,
    taskSlug: parsed.task ?? undefined,
    workflowId,
    variant,
    isolation: parsed.isolation ?? undefined,
    mode: parsed.mode ?? undefined,
    logMode: ctx.logMode,
  });
  if (ctx.logMode === "quiet") {
    console.log(`[harny] status=${result.status} branch=${result.branch}`);
  } else {
    console.log(`[harny] finished status=${result.status} branch=${result.branch}`);
  }
}
