import { runHarness } from "../harness/orchestrator.js";
import { resolveAssistant } from "./context.js";
import type { RunnerContext } from "./context.js";
import type { IsolationMode, RunMode } from "../harness/types.js";
import { printRunSummary } from "./summary.js";
import { loadWorkflow } from "../harness/workflow/loader.js";

type RunArgs = {
  workflow: string | null;
  name: string | null;
  isolation: IsolationMode | null;
  mode: RunMode | null;
  prompt: string;
};

export async function handleRun(parsed: RunArgs, ctx: RunnerContext): Promise<void> {
  const workflowArgRaw = parsed.workflow ?? "feature-dev";
  const isPath = workflowArgRaw.startsWith(".") || workflowArgRaw.startsWith("/") || /\.ya?ml$/i.test(workflowArgRaw);
  const [workflowId = "feature-dev", variant] = isPath ? [workflowArgRaw, undefined] : workflowArgRaw.split(":");
  try {
    await loadWorkflow(workflowId, { cwd: (await resolveAssistant(ctx.assistantName)).cwd });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  if (!parsed.prompt) throw new Error("a prompt is required (describe the work in quotes)");
  const assistant = await resolveAssistant(ctx.assistantName);
  const result = await runHarness({
    cwd: assistant.cwd,
    userPrompt: parsed.prompt,
    taskSlug: parsed.name ?? undefined,
    workflowId,
    variant,
    isolation: parsed.isolation ?? undefined,
    mode: parsed.mode ?? undefined,
    logMode: ctx.logMode,
  });
  if (ctx.logMode === "quiet") {
    console.log(`[harny] status=${result.status} branch=${result.branch}`);
  } else {
    await printRunSummary(result, assistant.cwd);
  }
}
