import { runPhase } from "../sessionRecorder.js";
import {
  DeveloperVerdictSchema,
  type DeveloperVerdict,
  type ValidatorVerdict,
} from "../verdict.js";
import { writeProblems } from "../problem.js";
import type {
  LogMode,
  Plan,
  PlanTask,
  PlanTaskHistoryEntry,
  ResolvedPhaseConfig,
} from "../types.js";

function describePlan(plan: Plan): string {
  const lines: string[] = [
    `Plan summary: ${plan.summary}`,
    `User request: ${plan.user_prompt}`,
    "Tasks:",
  ];
  for (const t of plan.tasks) {
    const marker =
      t.status === "done" ? "[x]" : t.status === "failed" ? "[!]" : "[ ]";
    lines.push(`  ${marker} ${t.id}: ${t.title}`);
  }
  return lines.join("\n");
}

function describeTask(task: PlanTask): string {
  return [
    `Current task: ${task.id} — ${task.title}`,
    `Description: ${task.description}`,
    `Acceptance criteria:`,
    ...task.acceptance.map((a, i) => `  ${i + 1}. ${a}`),
  ].join("\n");
}

function describeTaskHistory(task: PlanTask): string {
  if (task.history.length === 0) return "";
  const parts = ["", "Previous attempts on THIS task:"];
  for (const h of task.history) {
    parts.push(formatHistoryForPrompt(h));
  }
  return parts.join("\n");
}

function formatHistoryForPrompt(h: PlanTaskHistoryEntry): string {
  if (h.role === "developer") {
    return `- developer attempt (${h.at}): status=${h.status}${
      h.blocked_reason ? `, blocked_reason=${h.blocked_reason}` : ""
    }\n  summary: ${h.summary}`;
  }
  if (h.role === "triage") {
    return `- triage decision (${h.at}): action=${h.action}`;
  }
  return `- validator verdict (${h.at}): ${h.verdict}${
    h.recommend_reset ? " (recommended reset)" : ""
  }\n  reasons:\n${h.reasons
    .map((r) => `    - ${r}`)
    .join("\n")}\n  evidence: ${h.evidence}`;
}

function buildResumePrompt(validator: ValidatorVerdict): string {
  return [
    "The validator reviewed your previous attempt and reported the following:",
    "",
    `Verdict: ${validator.verdict}`,
    "Reasons:",
    ...validator.reasons.map((r) => `  - ${r}`),
    "",
    `Evidence: ${validator.evidence}`,
    "",
    "You were not committed. The working tree still contains your previous changes. Fix exactly what the validator flagged, then report your outcome as structured data again.",
  ].join("\n");
}

function buildFreshPrompt(plan: Plan, task: PlanTask): string {
  const history = describeTaskHistory(task);
  const body = [describePlan(plan), "", describeTask(task)];
  if (history) body.push(history);
  body.push("", "Do NOT commit. Report your outcome as structured data.");
  return body.join("\n");
}

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
