import type { Plan, PlanTask, PlanTaskHistoryEntry } from "../../types.js";
import type { PlannerVerdict, ValidatorVerdict } from "./verdicts.js";

// Feature-dev's typed history shapes. Core stores entries as the open
// PlanTaskHistoryEntry; we cast on read since this workflow owns these roles.
export type DeveloperHistoryEntry = PlanTaskHistoryEntry & {
  role: "developer";
  status: "done" | "blocked";
  summary: string;
  commit_message?: string;
  blocked_reason?: string;
};

export type ValidatorHistoryEntry = PlanTaskHistoryEntry & {
  role: "validator";
  verdict: "pass" | "fail";
  reasons: string[];
  evidence: string;
  recommend_reset?: boolean;
};

export function applyPlannerVerdict(
  plan: Plan,
  verdict: PlannerVerdict,
  plannerSessionId: string,
): Plan {
  plan.summary = verdict.summary;
  plan.metadata.planner_session_id = plannerSessionId;
  plan.status = "in_progress";
  plan.tasks = verdict.tasks.map<PlanTask>((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    acceptance: t.acceptance,
    status: "pending",
    attempts: 0,
    commit_sha: null,
    history: [],
  }));
  return plan;
}

export function describePlan(plan: Plan): string {
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

export function describeTask(task: PlanTask): string {
  return [
    `Current task: ${task.id} — ${task.title}`,
    `Description: ${task.description}`,
    `Acceptance criteria:`,
    ...task.acceptance.map((a, i) => `  ${i + 1}. ${a}`),
  ].join("\n");
}

export function describeTaskHistory(task: PlanTask): string {
  if (task.history.length === 0) return "";
  const parts = ["", "Previous attempts on THIS task:"];
  for (const h of task.history) {
    parts.push(formatHistoryForPrompt(h));
  }
  return parts.join("\n");
}

export function formatHistoryForPrompt(h: PlanTaskHistoryEntry): string {
  if (h.role === "developer") {
    const d = h as DeveloperHistoryEntry;
    return `- developer attempt (${d.at}): status=${d.status}${
      d.blocked_reason ? `, blocked_reason=${d.blocked_reason}` : ""
    }\n  summary: ${d.summary}`;
  }
  const v = h as ValidatorHistoryEntry;
  return `- validator verdict (${v.at}): ${v.verdict}${
    v.recommend_reset ? " (recommended reset)" : ""
  }\n  reasons:\n${v.reasons
    .map((r) => `    - ${r}`)
    .join("\n")}\n  evidence: ${v.evidence}`;
}

export function buildResumePrompt(validator: ValidatorVerdict): string {
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

export function buildFreshPrompt(plan: Plan, task: PlanTask): string {
  const history = describeTaskHistory(task);
  const body = [describePlan(plan), "", describeTask(task)];
  if (history) body.push(history);
  body.push("", "Do NOT commit. Report your outcome as structured data.");
  return body.join("\n");
}
