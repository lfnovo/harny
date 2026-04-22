import { z } from "zod";
import { defineWorkflow, type WorkflowContext } from "../workflow.js";
import { ProblemSchema } from "../state/problem.js";
import {
  markTaskInProgress,
  markTaskDone,
  markTaskFailed,
} from "../state/plan.js";
import type { PlanTask, ResolvedPhaseConfig } from "../types.js";

// --- Verdict schemas (local — not in core) ----------------------------------

const PROBLEMS_FIELD_DESCRIPTION =
  "OPTIONAL. Problems encountered during this attempt that would benefit FUTURE runs of the harness if fixed at the project level. Categories: environment, design, understanding, tooling. Severity: low/medium/high. Omit if nothing noteworthy.";

export const WriterVerdictSchema = z
  .object({
    status: z.enum(["done", "blocked"]),
    commit_message: z
      .string()
      .describe(
        "Proposed conventional-commit message. The harness will commit on your behalf after the reviewer approves. Empty string if status is blocked.",
      ),
    summary: z.string().describe("2-3 sentence description of what was documented"),
    files_written: z
      .array(z.string())
      .describe("List of file paths that were created or modified"),
    blocked_reason: z.string().optional().describe("Required when status is blocked"),
    problems: z.array(ProblemSchema).optional().describe(PROBLEMS_FIELD_DESCRIPTION),
  })
  .strict();

export const ReviewerVerdictSchema = z
  .object({
    verdict: z.enum(["pass", "fail"]),
    reasons: z
      .array(z.string())
      .describe("Specific, actionable reasons for the verdict"),
    evidence: z
      .string()
      .describe("What was actually read or observed to reach this verdict"),
    problems: z.array(ProblemSchema).optional().describe(PROBLEMS_FIELD_DESCRIPTION),
  })
  .strict();

export type WriterVerdict = z.infer<typeof WriterVerdictSchema>;
export type ReviewerVerdict = z.infer<typeof ReviewerVerdictSchema>;

// --- Phase configs ----------------------------------------------------------

const WRITER_PROMPT = `You are a documentation writer agent in the harness. Your job is to create or update documentation files based on the given intent.

## Documentation architecture principles

- One cohesive document per concept. Don't combine unrelated topics in one file.
- Prefer Markdown (.md) files with concrete examples and code snippets.
- Place files near related source code (e.g. next to src/harness/ for harness internals), or in a top-level docs/ directory if one exists.
- Name files clearly and descriptively (e.g. CLI-FLAGS.md, WORKFLOW-AUTHORING.md — not docs.md or output.md).
- Cross-link between documents when relevant (use relative links).
- Include concrete examples: CLI invocations, config snippets, code excerpts — avoid vague descriptions.

## Your workflow

1. Read the intent carefully to understand what needs to be documented.
2. Explore the relevant source files (Read, Grep, Glob, Bash) to understand actual behavior.
3. Decide how many files to create and where to place them, based on what makes sense for good doc architecture.
4. Write the documentation — accurate, complete, and newcomer-friendly.
5. Report what you wrote: files_written (list of created/modified paths), a conventional commit_message, and a summary.

## Quality bar

The reviewer will check:
- Completeness: does it cover what the intent asked for?
- Clarity: could a new contributor follow it?
- Accuracy: does it match the actual code and behavior?
- Structure: good organization, headings, examples?

If the reviewer rejects your docs, you will receive their specific feedback. Apply it directly and update the docs.

Do NOT commit. Report your result as structured output.`;

const REVIEWER_PROMPT = `You are a documentation reviewer agent in the harness. Your job is to review documentation files and decide whether they meet the quality bar.

You are READ-ONLY — do not edit or write any files.

## What to evaluate

1. **Completeness**: Does the documentation cover what the intent asked for? Are there missing sections or topics?
2. **Clarity**: Could a new contributor understand and follow this documentation? Is the language clear and well-organized?
3. **Accuracy**: Does the content match the actual code behavior? Verify claims by reading source files.
4. **Structure**: Good organization, appropriate headings, helpful examples and code snippets?

## How to review

- Read the documentation files listed in the writer's summary.
- Cross-check claims against the actual source files using Read, Grep, Glob, Bash.
- Do NOT edit or write any files — your role is purely evaluative.

## Verdict

- **pass**: The documentation meets the quality bar. Approve it.
- **fail**: The documentation has specific gaps or issues. Provide ACTIONABLE feedback the writer can apply directly:
  - Name the specific sections or claims that are wrong or missing.
  - Give concrete direction: "add an example showing X", "the description of Y flag is wrong — it actually does Z", "section on Z is missing entirely".
  - Do not give vague feedback like "could be clearer" — say exactly what needs to change and how.`;

export const DEFAULT_WRITER: ResolvedPhaseConfig = {
  prompt: WRITER_PROMPT,
  allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  permissionMode: "bypassPermissions",
  maxTurns: 150,
  effort: "high",
  model: "sonnet",
  mcpServers: {},
};

export const DEFAULT_REVIEWER: ResolvedPhaseConfig = {
  prompt: REVIEWER_PROMPT,
  allowedTools: ["Read", "Grep", "Glob", "Bash"],
  permissionMode: "bypassPermissions",
  maxTurns: 50,
  effort: "high",
  model: "sonnet",
  mcpServers: {},
};

// --- Commit message composer ------------------------------------------------

function composeCommitMessage(
  taskId: string,
  writerMessage: string,
  evidence: string,
): string {
  const header = writerMessage.trim() || `docs: ${taskId}`;
  return `${header}\n\ntask=${taskId}\nreviewer: ${evidence.trim()}`;
}

// --- Prompt builders --------------------------------------------------------

function buildWriterPrompt(
  intent: string,
  taskId: string,
  reviewerFeedback: ReviewerVerdict | null,
): string {
  const lines: string[] = [
    `You are a documentation writer. Your task is described below.`,
    ``,
    `Task ID: ${taskId}`,
    ``,
    `Documentation intent:`,
    intent,
    ``,
  ];

  if (reviewerFeedback) {
    lines.push(
      `## Reviewer feedback from previous attempt`,
      ``,
      `The reviewer rejected your previous documentation. Here is their specific feedback:`,
      ``,
      `Reasons:`,
      ...reviewerFeedback.reasons.map((r) => `- ${r}`),
      ``,
      `Evidence the reviewer gathered: ${reviewerFeedback.evidence}`,
      ``,
      `Please update your documentation to address this feedback directly and specifically.`,
      ``,
    );
  }

  lines.push(
    `Follow the documentation architecture principles in your system prompt.`,
    `Explore the codebase, write the docs, and report your result as structured output.`,
    ``,
    `Return your result as structured output with:`,
    `- status: "done" (or "blocked" if you truly cannot proceed)`,
    `- commit_message: a conventional-commit message (e.g. "docs: document CLI flags and assistant config")`,
    `- summary: 2-3 sentences describing what you documented`,
    `- files_written: list of file paths you created or modified`,
    `- blocked_reason: (only if status=blocked) explain why`,
  );

  return lines.join("\n");
}

function buildReviewerPrompt(
  intent: string,
  taskId: string,
  writerVerdict: WriterVerdict,
): string {
  return [
    `You are a documentation reviewer. Review the documentation created by the writer.`,
    ``,
    `Task ID: ${taskId}`,
    ``,
    `Documentation intent:`,
    intent,
    ``,
    `Writer summary: ${writerVerdict.summary}`,
    `Files written:`,
    ...writerVerdict.files_written.map((f) => `- ${f}`),
    ``,
    `## Your job`,
    ``,
    `1. Read each file listed above.`,
    `2. Cross-check claims against actual source files using Read, Grep, Glob, Bash.`,
    `3. Evaluate: completeness, clarity, accuracy, and structure.`,
    `4. Return a verdict.`,
    ``,
    `Do NOT edit or write any files — you are read-only.`,
    ``,
    `Return your result as structured output with:`,
    `- verdict: "pass" or "fail"`,
    `- reasons: list of specific, actionable reasons (what is good or what specifically needs fixing)`,
    `- evidence: what you actually read and checked to reach this verdict`,
  ].join("\n");
}

// --- Core write-review loop -------------------------------------------------

async function runWriteReviewLoop(
  ctx: WorkflowContext,
  intent: string,
): Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human" }> {
  const plan = ctx.plan;

  const task: PlanTask = {
    id: "docs-1",
    title: intent.slice(0, 80),
    description: intent,
    acceptance: ["Reviewer approves with verdict=pass"],
    status: "pending",
    attempts: 0,
    commit_sha: null,
    history: [],
  };

  await ctx.updatePlan((p) => {
    p.status = "in_progress";
    p.tasks = [task];
  });

  const writerPhaseConfig: ResolvedPhaseConfig =
    ctx.config.phases["writer"] ?? DEFAULT_WRITER;
  const reviewerPhaseConfig: ResolvedPhaseConfig =
    ctx.config.phases["reviewer"] ?? DEFAULT_REVIEWER;

  let pendingResume: {
    sessionId: string;
    reviewer: ReviewerVerdict;
  } | null = null;

  while (true) {
    if (plan.iterations_global >= ctx.config.maxIterationsGlobal) {
      await ctx.updatePlan((p) => {
        p.status = "exhausted";
      });
      ctx.log(`[harny] global iteration cap reached.`);
      return { status: "exhausted" };
    }

    const prePhaseSha = await ctx.currentSha();

    await ctx.updatePlan((p) => {
      const t = p.tasks.find((x) => x.id === task.id)!;
      markTaskInProgress(t);
      p.iterations_global += 1;
    });

    ctx.log(
      `[harny] phase=writer task=${task.id} attempt=${task.attempts}${pendingResume ? " (resuming)" : ""}`,
    );

    const writerPrompt = buildWriterPrompt(
      intent,
      task.id,
      pendingResume?.reviewer ?? null,
    );

    const writerResult: import("../workflow.js").WorkflowPhaseResult<WriterVerdict> = await ctx.runPhase({
      phase: "writer",
      prompt: writerPrompt,
      outputSchema: WriterVerdictSchema,
      harnessTaskId: task.id,
      resumeSessionId: pendingResume?.sessionId ?? null,
      allowedTools: writerPhaseConfig.allowedTools,
      guards: { noPlanWrites: true, noGitHistory: true },
    });

    await ctx.updatePlan((p) => {
      const t = p.tasks.find((x) => x.id === task.id)!;
      t.history.push({
        role: "writer",
        session_id: writerResult.sessionId,
        at: new Date().toISOString(),
        status: writerResult.structuredOutput?.status ?? "error",
        summary: writerResult.structuredOutput?.summary ?? "",
        files_written: writerResult.structuredOutput?.files_written ?? [],
        ...(writerResult.structuredOutput?.commit_message
          ? { commit_message: writerResult.structuredOutput.commit_message }
          : {}),
        ...(writerResult.structuredOutput?.blocked_reason
          ? { blocked_reason: writerResult.structuredOutput.blocked_reason }
          : {}),
      });
    });

    await ctx.audit({
      phase: "writer",
      event: "completed",
      session_id: writerResult.sessionId,
      task_id: task.id,
      attempt: task.attempts,
      status: writerResult.structuredOutput?.status ?? "error",
      summary: writerResult.structuredOutput?.summary ?? "",
      ...(writerResult.structuredOutput?.files_written
        ? { files_written: writerResult.structuredOutput.files_written }
        : {}),
      ...(writerResult.structuredOutput?.blocked_reason
        ? { blocked_reason: writerResult.structuredOutput.blocked_reason }
        : {}),
    });

    pendingResume = null;

    if (writerResult.status !== "completed" || !writerResult.structuredOutput) {
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        markTaskFailed(t);
        p.status = "failed";
      });
      await ctx.resetHard(prePhaseSha);
      await ctx.cleanUntracked();
      ctx.log(`[harny] writer phase error: ${writerResult.error}`);
      return { status: "failed" };
    }

    const writerVerdict = writerResult.structuredOutput;

    if (writerVerdict.status === "blocked") {
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        markTaskFailed(t);
        p.status = "failed";
      });
      await ctx.audit({
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "blocked_fatal",
        rationale: `writer reported blocked: ${writerVerdict.blocked_reason}`,
      });
      await ctx.resetHard(prePhaseSha);
      await ctx.cleanUntracked();
      ctx.log(
        `[harny] writer reported blocked — plan marked failed. Reason: ${writerVerdict.blocked_reason}`,
      );
      return { status: "failed" };
    }

    ctx.log(`[harny] phase=reviewer task=${task.id}`);

    const reviewerPrompt = buildReviewerPrompt(intent, task.id, writerVerdict);

    const reviewerResult = await ctx.runPhase({
      phase: "reviewer",
      prompt: reviewerPrompt,
      outputSchema: ReviewerVerdictSchema,
      harnessTaskId: task.id,
      allowedTools: reviewerPhaseConfig.allowedTools,
      guards: { readOnly: true },
    });

    await ctx.updatePlan((p) => {
      const t = p.tasks.find((x) => x.id === task.id)!;
      t.history.push({
        role: "reviewer",
        session_id: reviewerResult.sessionId,
        at: new Date().toISOString(),
        verdict: reviewerResult.structuredOutput?.verdict ?? "error",
        reasons: reviewerResult.structuredOutput?.reasons ?? [],
        evidence: reviewerResult.structuredOutput?.evidence ?? "",
      });
    });

    await ctx.audit({
      phase: "reviewer",
      event: "completed",
      session_id: reviewerResult.sessionId,
      task_id: task.id,
      attempt: task.attempts,
      verdict: reviewerResult.structuredOutput?.verdict ?? "error",
      reasons: reviewerResult.structuredOutput?.reasons ?? [],
      evidence: reviewerResult.structuredOutput?.evidence ?? "",
    });

    if (reviewerResult.status !== "completed" || !reviewerResult.structuredOutput) {
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        markTaskFailed(t);
        p.status = "failed";
      });
      await ctx.resetHard(prePhaseSha);
      await ctx.cleanUntracked();
      ctx.log(`[harny] reviewer phase error: ${reviewerResult.error}`);
      return { status: "failed" };
    }

    const reviewerVerdict = reviewerResult.structuredOutput;

    ctx.log(
      `[harny] reviewer task=${task.id} verdict=${reviewerVerdict.verdict} reasons=${reviewerVerdict.reasons.length}`,
    );

    if (reviewerVerdict.verdict === "pass") {
      const message = composeCommitMessage(
        task.id,
        writerVerdict.commit_message,
        reviewerVerdict.evidence,
      );
      const sha = await ctx.commit(message);
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        t.commit_sha = sha ?? null;
        markTaskDone(t);
        p.status = "done";
      });
      await ctx.audit({
        phase: "harness",
        event: "commit_executed",
        task_id: task.id,
        attempt: task.attempts,
        commit_sha: sha ?? "",
        message,
      });
      ctx.log(
        `[harny] task ${task.id} committed sha=${(sha ?? "").slice(0, 8) || "(empty)"}`,
      );
      return { status: "done" };
    }

    // Reviewer rejected — check retry budget
    if (task.attempts >= ctx.config.maxIterationsPerTask) {
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        markTaskFailed(t);
        p.status = "failed";
      });
      await ctx.resetHard(prePhaseSha);
      await ctx.cleanUntracked();
      await ctx.audit({
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "failed",
        rationale: `task exceeded maxIterationsPerTask=${ctx.config.maxIterationsPerTask}`,
      });
      ctx.log(
        `[harny] task ${task.id} exceeded retry budget; tree reset`,
      );
      return { status: "failed" };
    }

    await ctx.audit({
      phase: "harness",
      event: "decision",
      task_id: task.id,
      attempt: task.attempts,
      action: "retry",
      rationale: "reviewer rejected, resuming writer session with feedback",
    });
    pendingResume = {
      sessionId: writerResult.sessionId,
      reviewer: reviewerVerdict,
    };
    ctx.log(
      `[harny] task ${task.id} will retry (resume writer session with reviewer feedback)`,
    );
  }
}

// --- Workflow ----------------------------------------------------------------

export const docs = defineWorkflow({
  id: "docs",
  needsBranch: true,
  needsWorktree: true,
  inputSchema: z.object({ intent: z.string() }),
  phaseDefaults: {
    writer: DEFAULT_WRITER,
    reviewer: DEFAULT_REVIEWER,
  },
  run: async (ctx) => {
    const rawInput = ctx.input as { intent?: string } | null | undefined;
    let intent = rawInput?.intent?.trim() ?? "";

    if (intent.length < 10) {
      const ask = await ctx.askUser({
        prompt: 'Please describe what to document (e.g. "document the CLI flags and assistant config format")',
      });
      if (!ask.answered) {
        return { status: "waiting_human" };
      }
      intent = ask.answer.trim();
    }

    return runWriteReviewLoop(ctx, intent);
  },
  resumeFromAnswer: async (ctx, answer) => {
    const intent =
      typeof answer === "string"
        ? answer.trim()
        : Object.values(answer).join(" ").trim();
    return runWriteReviewLoop(ctx, intent);
  },
});
