import type { NodeExecutor } from "./runtime.js";

const MAX_CAPTURE_BYTES = 1024 * 1024;

export function createCommandExecutor(cwd: string): NodeExecutor {
  return async (node, { signal }) => {
    if (node.type !== "command") throw new Error("command executor received a non-command node");
    if (!node.command.length) throw new Error(`command node ${node.id} is empty`);
    const proc = Bun.spawn(node.command, { cwd, stdout: "pipe", stderr: "pipe", detached: true });
    const abort = () => { try { if (process.platform !== "win32") process.kill(-proc.pid, "SIGKILL"); else proc.kill("SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch {} } }; signal.addEventListener("abort", abort, { once: true });
    try {
      const [stdout, stderr, exitCode] = await Promise.all([readLimited(proc.stdout), readLimited(proc.stderr), proc.exited]);
      if (signal.aborted) throw signal.reason ?? new Error(`command ${node.id} aborted`);
      if (exitCode !== 0) throw new Error(`command ${node.id} failed (exit ${exitCode}): ${stderr.trim()}`);
      return { stdout, stderr, exit_code: exitCode };
    } finally { signal.removeEventListener("abort", abort); }
  };
}

async function readLimited(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let captured = 0; let truncated = false;
  while (true) { const { done, value } = await reader.read(); if (done) break; if (captured < MAX_CAPTURE_BYTES) { const remaining = MAX_CAPTURE_BYTES - captured; const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value; chunks.push(chunk); captured += chunk.byteLength; if (chunk.byteLength < value.byteLength) truncated = true; } else truncated = true; }
  const text = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))); return truncated ? `${text}\n[harny: output truncated at ${MAX_CAPTURE_BYTES} bytes]` : text;
}
