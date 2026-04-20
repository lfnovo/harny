import { runPhase } from "../sessionRecorder.js";
import { DeveloperVerdictSchema, type DeveloperVerdict } from "../verdict.js";
import type {
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
  const parts = [
    `Current task: ${task.id} — ${task.title}`,
    `Description: ${task.description}`,
    `Acceptance criteria:`,
    ...task.acceptance.map((a, i) => `  ${i + 1}. ${a}`),
  ];
  if (task.attempts > 0 && task.history.length > 0) {
    parts.push("", "Previous attempts on THIS task:");
    for (const h of task.history) {
      parts.push(formatHistoryForPrompt(h));
    }
  }
  return parts.join("\n");
}

function formatHistoryForPrompt(h: PlanTaskHistoryEntry): string {
  if (h.role === "developer") {
    return `- developer attempt (${h.at}): status=${h.status}${
      h.blocked_reason ? `, blocked_reason=${h.blocked_reason}` : ""
    }\n  summary: ${h.summary}`;
  }
  return `- validator verdict (${h.at}): ${h.verdict}\n  reasons:\n${h.reasons
    .map((r) => `    - ${r}`)
    .join("\n")}\n  evidence: ${h.evidence}`;
}

export async function runDeveloper(args: {
  phaseConfig: ResolvedPhaseConfig;
  cwd: string;
  taskSlug: string;
  plan: Plan;
  task: PlanTask;
  verbose?: boolean;
}): Promise<{ sessionId: string; verdict: DeveloperVerdict }> {
  const prompt = [
    describePlan(args.plan),
    "",
    describeTask(args.task),
    "",
    `When complete, commit with a conventional message referencing ${args.task.id}.`,
  ].join("\n");

  const result = await runPhase({
    phase: "developer",
    phaseConfig: args.phaseConfig,
    cwd: args.cwd,
    taskSlug: args.taskSlug,
    harnessTaskId: args.task.id,
    prompt,
    outputSchema: DeveloperVerdictSchema,
    verbose: args.verbose,
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
  return { sessionId: result.sessionId, verdict };
}
