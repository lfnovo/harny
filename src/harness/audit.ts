import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { planDir } from "./plan.js";

type HarnessDecision = "commit" | "retry" | "reset" | "failed" | "blocked_fatal";

export type AuditEntry =
  | {
      phase: "planner";
      event: "completed";
      session_id: string;
      task_count: number;
    }
  | {
      phase: "developer";
      event: "completed";
      session_id: string;
      task_id: string;
      attempt: number;
      status: "done" | "blocked";
      summary: string;
      commit_message?: string;
      blocked_reason?: string;
    }
  | {
      phase: "validator";
      event: "completed";
      session_id: string;
      task_id: string;
      attempt: number;
      verdict: "pass" | "fail";
      reasons: string[];
      evidence: string;
      recommend_reset?: boolean;
    }
  | {
      phase: "harness";
      event: "decision";
      task_id: string;
      attempt: number;
      action: HarnessDecision;
      rationale: string;
    }
  | {
      phase: "harness";
      event: "reset_executed";
      task_id: string;
      attempt: number;
      head_before: string;
      head_after: string;
    }
  | {
      phase: "harness";
      event: "commit_executed";
      task_id: string;
      attempt: number;
      commit_sha: string;
      message: string;
    };

export function auditPath(cwd: string, taskSlug: string): string {
  return join(planDir(cwd, taskSlug), "audit.jsonl");
}

export async function appendAudit(
  cwd: string,
  taskSlug: string,
  entry: AuditEntry,
): Promise<void> {
  const path = auditPath(cwd, taskSlug);
  await mkdir(planDir(cwd, taskSlug), { recursive: true });
  const line =
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(path, line, "utf8");
}
