import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { planDir } from "./plan.js";

/**
 * Open shape — workflows declare their own typed audit shapes locally and
 * pass them through. Core requires only the discriminator pair (phase, event)
 * and an `at` timestamp the appendAudit() helper injects.
 */
export type AuditEntry = {
  [key: string]: unknown;
  phase: string;
  event: string;
};

export function auditPath(primaryCwd: string, taskSlug: string): string {
  return join(planDir(primaryCwd, taskSlug), "audit.jsonl");
}

export async function appendAudit(
  primaryCwd: string,
  taskSlug: string,
  entry: AuditEntry,
): Promise<void> {
  const path = auditPath(primaryCwd, taskSlug);
  await mkdir(planDir(primaryCwd, taskSlug), { recursive: true });
  const line =
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(path, line, "utf8");
}
