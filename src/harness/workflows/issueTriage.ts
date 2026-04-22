import { z } from "zod";
import { defineWorkflow } from "../workflow.js";
import { ProblemSchema } from "../state/problem.js";
import { markTaskInProgress } from "../state/plan.js";
import type {
  Plan,
  PlanTask,
  ResolvedPhaseConfig,
} from "../types.js";

// --- Verdict schema ---------------------------------------------------------

const PROBLEMS_FIELD_DESCRIPTION =
  "OPTIONAL. Problems encountered during this attempt that would benefit FUTURE runs of the harness if fixed at the project level. Categories: environment, design, understanding, tooling. Severity: low/medium/high. Omit if nothing noteworthy.";

export const TriageVerdictSchema = z
  .object({
    task_id: z.string(),
    action: z.enum(["comment", "label", "close", "assign", "none"]),
    target_url: z.string(),
    payload: z.object({
      body: z.string().optional(),
      labels: z.array(z.string()).optional(),
      assignees: z.array(z.string()).optional(),
    }),
    reasoning: z.string(),
    problems: z.array(ProblemSchema).optional().describe(PROBLEMS_FIELD_DESCRIPTION),
  })
  .strict();

export type TriageVerdict = z.infer<typeof TriageVerdictSchema>;

// --- Plan helpers (issue-triage specific) -----------------------------------

function createTriagePlanTask(url: string): PlanTask {
  return {
    id: "triage-1",
    title: "Triage issue",
    description: `Triage GitHub issue: ${url}`,
    acceptance: [
      "Decide an action (comment, label, close, assign, or none) for the issue based on its content.",
    ],
    status: "pending",
    attempts: 0,
    commit_sha: null,
    history: [],
  };
}

function applyTriageVerdict(
  plan: Plan,
  task: PlanTask,
  verdict: TriageVerdict,
  sessionId: string,
): void {
  task.output = {
    action: verdict.action,
    target_url: verdict.target_url,
    payload: verdict.payload,
    reasoning: verdict.reasoning,
    ...(verdict.problems ? { problems: verdict.problems } : {}),
  };
  task.history.push({
    role: "triage",
    session_id: sessionId,
    at: new Date().toISOString(),
    action: verdict.action,
    reasoning: verdict.reasoning,
  });
  task.status = "done";
  plan.status = "done";
}

// --- Default phase config ---------------------------------------------------

const TRIAGE_PROMPT = `You are an issue-triage agent in the harness. Your job is to read a GitHub issue and recommend a single appropriate action — you DO NOT execute the action.

Tools available: Bash (for \`gh\`), Read, WebFetch, Grep, Glob. You cannot Edit or Write — this is a read-only decision phase.

Report your verdict as structured data: action (comment | label | close | assign | none), target_url, payload (action-specific), and reasoning.`;

export const DEFAULT_TRIAGE: ResolvedPhaseConfig = {
  prompt: TRIAGE_PROMPT,
  allowedTools: ["Bash", "Read", "WebFetch", "Grep", "Glob"],
  permissionMode: "bypassPermissions",
  maxTurns: 50,
  effort: "high",
  model: "sonnet",
  mcpServers: {},
};

// --- Workflow ---------------------------------------------------------------

export const issueTriage = defineWorkflow({
  id: "issue-triage",
  needsBranch: false,
  needsWorktree: false,
  inputSchema: z.object({ url: z.string() }),
  phaseDefaults: { triage: DEFAULT_TRIAGE },
  run: async (ctx) => {
    const { url } = ctx.input as { url: string };

    const task = createTriagePlanTask(url);

    await ctx.updatePlan((plan) => {
      plan.status = "in_progress";
      plan.tasks = [task];
      markTaskInProgress(plan.tasks[0]!);
      plan.iterations_global += 1;
    });

    ctx.log(`[harny] phase=triage url=${url}`);

    const prompt = buildTriagePrompt(url, ctx.userPrompt, task.id);
    const result = await ctx.runPhase({
      phase: "triage",
      prompt,
      outputSchema: TriageVerdictSchema,
      harnessTaskId: task.id,
      guards: { noGitHistory: true },
    });

    if (result.status === "error" || !result.structuredOutput) {
      await ctx.updatePlan((plan) => {
        plan.tasks[0]!.status = "failed";
        plan.status = "failed";
      });
      ctx.warn(`[harny] triage phase failed: ${result.error}`);
      return { status: "failed" };
    }

    const verdict = result.structuredOutput;
    await ctx.updatePlan((plan) => {
      applyTriageVerdict(plan, plan.tasks[0]!, verdict, result.sessionId);
    });

    ctx.log(`[harny] triage done action=${verdict.action} url=${verdict.target_url}`);
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
