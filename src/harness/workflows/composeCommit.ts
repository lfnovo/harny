export function composeCommitMessage({
  devMessage,
  taskId,
  role,
  evidence,
}: {
  devMessage: string;
  taskId: string;
  role: "validator" | "reviewer";
  evidence: string;
}): string {
  const lines = devMessage.split("\n");
  const pattern = new RegExp(`^task=\\S+\\s*$`);
  while (lines.length > 0 && pattern.test(lines[lines.length - 1]!)) {
    lines.pop();
  }
  const stripped = lines.join("\n").trimEnd();
  const fallbackPrefix = role === "reviewer" ? "docs" : "feat";
  const header = stripped || `${fallbackPrefix}: ${taskId}`;
  return `${header}\n\ntask=${taskId}\n${role}: ${evidence.trim()}`;
}
