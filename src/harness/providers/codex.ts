import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AgentProvider, AgentRequest, AgentResult, AgentSession } from "./types.js";

export interface CodexInvocation { cwd: string; prompt: string; model?: string; schema: Record<string, unknown>; resumeSessionId?: string; readOnly: boolean; signal?: AbortSignal; }
export interface CodexInvocationResult { exitCode: number; stdout: string; stderr: string; lastMessage: string; }
export type CodexRunner = (invocation: CodexInvocation) => Promise<CodexInvocationResult>;

export class CodexProvider implements AgentProvider {
  readonly id = "codex";
  // The CLI gives us JSON Schema output, persisted sessions, cwd, cancellation
  // and a coarse read-only sandbox. It does not expose per-tool allowlists or
  // Harny's path-aware guards, so toolGuards is intentionally false.
  readonly capabilities = { structuredOutput: true, resume: true, toolGuards: false, interactiveQuestions: false } as const;
  constructor(private readonly runner: CodexRunner = runCodexCli) {}
  run<T>(request: AgentRequest<T>) { return this.execute(request); }
  async resume<T>(session: AgentSession, request: AgentRequest<T>) {
    if (session.provider !== this.id) throw new Error(`cannot resume ${session.provider} session with ${this.id}`);
    return await this.execute(request, session.id);
  }
  private async execute<T>(request: AgentRequest<T>, resumeSessionId?: string): Promise<AgentResult<T>> {
    const jsonSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    const prompt = request.systemPrompt ? `${request.systemPrompt}\n\n${request.prompt}` : request.prompt;
    const result = await raceAbort(this.runner({ cwd: request.cwd, prompt, model: request.model, schema: jsonSchema, resumeSessionId, readOnly: request.guards?.includes("read_only") ?? false, signal: request.signal }), request.signal);
    if (result.exitCode !== 0) throw new Error(`codex exec failed (exit ${result.exitCode}): ${result.stderr.trim()}`);
    let raw: unknown; try { raw = JSON.parse(result.lastMessage); } catch (error) { throw new Error(`Codex returned invalid structured output: ${String(error)}`); }
    const output = request.schema.parse(raw); const events = parseJsonLines(result.stdout); const sessionId = findString(events, ["thread_id", "session_id", "conversation_id"]);
    return { output, session: sessionId ? { id: sessionId, provider: this.id } : undefined, transcript: result.stdout, usage: findUsage(events) };
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> { if (!signal) return promise; if (signal.aborted) return Promise.reject(signal.reason ?? new Error("agent request aborted")); return new Promise((resolve, reject) => { const abort = () => reject(signal.reason ?? new Error("agent request aborted")); signal.addEventListener("abort", abort, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); }); }

async function runCodexCli(invocation: CodexInvocation): Promise<CodexInvocationResult> {
  const dir = await mkdtemp(join(tmpdir(), "harny-codex-")); const schemaPath = join(dir, "schema.json"); const outputPath = join(dir, "output.json");
  await writeFile(schemaPath, JSON.stringify(invocation.schema));
  const common = ["--json", "--output-schema", schemaPath, "--output-last-message", outputPath, ...(invocation.model ? ["--model", invocation.model] : [])];
  const args = invocation.resumeSessionId
    ? ["codex", "exec", "resume", ...common, invocation.resumeSessionId, invocation.prompt]
    : ["codex", "exec", ...common, "--cd", invocation.cwd, "--sandbox", invocation.readOnly ? "read-only" : "workspace-write", invocation.prompt];
  const proc = Bun.spawn(args, { cwd: invocation.cwd, stdout: "pipe", stderr: "pipe" }); const abort = () => proc.kill("SIGKILL"); invocation.signal?.addEventListener("abort", abort, { once: true });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (invocation.signal?.aborted) throw invocation.signal.reason ?? new Error("Codex request aborted");
    const lastMessage = await readFile(outputPath, "utf8").catch(() => ""); return { exitCode, stdout, stderr, lastMessage };
  } finally { invocation.signal?.removeEventListener("abort", abort); await rm(dir, { recursive: true, force: true }); }
}

function parseJsonLines(value: string): unknown[] { return value.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
function findString(values: unknown[], keys: string[]): string | undefined {
  for (const value of values) { const found = walk(value); if (found) return found; } return undefined;
  function walk(value: unknown): string | undefined { if (!value || typeof value !== "object") return undefined; for (const [key, child] of Object.entries(value)) { if (keys.includes(key) && typeof child === "string") return child; const nested = walk(child); if (nested) return nested; } return undefined; }
}
function findUsage(events: unknown[]): AgentResult<unknown>["usage"] {
  let inputTokens: number | undefined; let outputTokens: number | undefined;
  const walk = (value: unknown) => { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if ((key === "input_tokens" || key === "inputTokens") && typeof child === "number") inputTokens = child; else if ((key === "output_tokens" || key === "outputTokens") && typeof child === "number") outputTokens = child; else walk(child); } };
  events.forEach(walk); return inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens };
}
