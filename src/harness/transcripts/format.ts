function formatTimestamp(ts: string | undefined): string {
  if (!ts) return "??:??:??";
  try {
    const d = new Date(ts);
    return [
      d.getHours().toString().padStart(2, "0"),
      d.getMinutes().toString().padStart(2, "0"),
      d.getSeconds().toString().padStart(2, "0"),
    ].join(":");
  } catch {
    return "??:??:??";
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function inputSummary(input: unknown): string {
  return truncate(JSON.stringify(input), 80);
}

function outputSummary(content: unknown): string {
  if (typeof content === "string") return truncate(content, 80);
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === "object") {
        const b = item as Record<string, unknown>;
        if (b.type === "text") {
          return truncate(typeof b.text === "string" ? b.text : JSON.stringify(b.text), 80);
        }
      }
    }
    return truncate(JSON.stringify(content), 80);
  }
  return truncate(JSON.stringify(content), 80);
}

export function formatEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const e = event as Record<string, unknown>;

  if (e.type === "assistant") {
    const msg = e.message as Record<string, unknown> | undefined;
    if (!msg) return null;
    const content = msg.content;
    if (!Array.isArray(content)) return null;

    const ts = formatTimestamp(e.timestamp as string | undefined);
    const lines: string[] = [];

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use") {
        const name = typeof b.name === "string" ? b.name : String(b.name);
        const summary = inputSummary(b.input);
        lines.push(`${ts}  ${name}  ${summary}`);
      } else if (b.type === "text") {
        const text = typeof b.text === "string" ? b.text : "";
        if (text.trim()) {
          lines.push(`${ts}  💬 ${truncate(text, 80)}`);
        }
      }
      // skip thinking blocks and others
    }

    return lines.length > 0 ? lines.join("\n") : null;
  }

  if (e.type === "user") {
    const msg = e.message as Record<string, unknown> | undefined;
    if (!msg) return null;
    const content = msg.content;
    if (!Array.isArray(content)) return null;

    const lines: string[] = [];

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "tool_result") {
        const isError = b.isError === true || b.is_error === true;
        const summary = outputSummary(b.content);
        if (isError) {
          lines.push(`             ↳ (error: ${summary})`);
        } else {
          lines.push(`             ↳ ${summary}`);
        }
      }
    }

    return lines.length > 0 ? lines.join("\n") : null;
  }

  return null;
}
