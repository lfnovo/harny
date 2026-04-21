import { z } from "zod";
import { defineWorkflow } from "../workflow.js";
import { TriageVerdictSchema } from "../verdict.js";
import {
  createTriagePlanTask,
  applyTriageVerdict,
  markTaskInProgress,
} from "../plan.js";

const TRIAGE_TOOLS = ["Bash", "Read", "WebFetch", "Grep", "Glob"];

export const issueTriage = defineWorkflow({
  id: "issue-triage",
  needsBranch: false,
  needsWorktree: false,
  inputSchema: z.object({ url: z.string() }),
  run: async (ctx) => {
    const { url } = ctx.input as { url: string };

    const task = createTriagePlanTask(url);

    await ctx.updatePlan((plan) => {
      plan.status = "in_progress";
      plan.tasks = [task];
      markTaskInProgress(plan.tasks[0]!);
      plan.iterations_global += 1;
    });

    ctx.log(`[harness] phase=triage url=${url}`);

    const prompt = buildTriagePrompt(url, ctx.userPrompt, task.id);
    const result = await ctx.runPhase({
      phase: "triage",
      prompt,
      outputSchema: TriageVerdictSchema,
      harnessTaskId: task.id,
      allowedTools: TRIAGE_TOOLS,
    });

    if (result.status === "error" || !result.structuredOutput) {
      await ctx.updatePlan((plan) => {
        plan.tasks[0]!.status = "failed";
        plan.status = "failed";
      });
      ctx.warn(`[harness] triage phase failed: ${result.error}`);
      return { status: "failed" };
    }

    const verdict = result.structuredOutput;
    await ctx.updatePlan((plan) => {
      applyTriageVerdict(plan, plan.tasks[0]!, verdict, result.sessionId);
    });

    ctx.log(`[harness] triage done action=${verdict.action} url=${verdict.target_url}`);
    return { status: "done" };
  },
});

function buildTriagePrompt(url: string, userPrompt: string, taskId: string): string {
  return [
    `You are a GitHub issue triage agent. Your task is to analyze a GitHub issue and recommend an appropriate action.`,
    ``,
    `User request: ${userPrompt}`,
    ``,
    `Issue URL: ${url}`,
    ``,
    `Steps:`,
    `1. Fetch the issue details by running:`,
    `   gh issue view ${url} --json title,body,labels,state,comments,author`,
    ``,
    `2. Read and analyze the issue content carefully.`,
    ``,
    `3. Decide on the appropriate action:`,
    `   - 'comment': Reply with a comment (provide body in payload)`,
    `   - 'label': Apply labels (provide labels array in payload)`,
    `   - 'close': Close the issue`,
    `   - 'assign': Assign to someone (provide assignees in payload)`,
    `   - 'none': No action needed`,
    ``,
    `4. Provide a detailed reasoning for your decision.`,
    ``,
    `IMPORTANT: Only DECIDE the action — do NOT execute it (do not run gh commands that modify the issue).`,
    ``,
    `Return your decision as structured output with:`,
    `- task_id: "${taskId}"`,
    `- action: one of 'comment', 'label', 'close', 'assign', 'none'`,
    `- target_url: the full issue URL`,
    `- payload: object with optional body (string), labels (string[]), assignees (string[])`,
    `- reasoning: detailed explanation of your decision`,
  ].join("\n");
}
