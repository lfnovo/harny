export function composeCommitMessage({
  devMessage,
  taskId,
  slug,
  planTaskCount,
  role,
  evidence,
}: {
  devMessage: string;
  taskId: string;
  slug: string;
  planTaskCount: number;
  role: "validator" | "reviewer";
  evidence: string | string[];
}): string {
  const lines = devMessage.split("\n");
  const pattern = new RegExp(`^task=.+$`);
  while (lines.length > 0 && pattern.test(lines[lines.length - 1]!.trimEnd())) {
    lines.pop();
  }
  const stripped = lines.join("\n").trimEnd();
  const fallbackPrefix = role === "reviewer" ? "docs" : "feat";
  const header = stripped || `${fallbackPrefix}: ${taskId}`;
  const taskTrailer = planTaskCount === 1 ? `task=${slug}` : `task=${slug}/${taskId}`;
  const evidenceBody = Array.isArray(evidence)
    ? `${role}:\n  - ${evidence.join("\n  - ")}`
    : `${role}: ${evidence.trim()}`;
  return `${header}\n\n${taskTrailer}\n${evidenceBody}`;
}
