import { Codex, type CodexOptions, type ThreadEvent, type ThreadOptions, type TurnOptions, type Usage } from "@openai/codex-sdk";
import { z } from "zod";
import type { AgentProvider, AgentRequest, AgentResult, AgentSession, AgentUsage } from "./types.js";
import { AgentProviderError } from "./types.js";
import type { AgentEvent } from "../transcripts/types.js";

interface CodexThread {
  readonly id: string | null;
  runStreamed(input: string, options?: TurnOptions): Promise<{ events: AsyncGenerator<ThreadEvent> }>;
}

export interface CodexClient {
  startThread(options?: ThreadOptions): CodexThread;
  resumeThread(id: string, options?: ThreadOptions): CodexThread;
}

export interface CodexProviderOptions {
  id?: string;
  connectionFingerprint?: string;
  defaultModel?: string;
  sdk?: CodexOptions;
  client?: CodexClient;
}

/** Codex SDK details terminate here; workflows only see AgentProvider. */
export class CodexProvider implements AgentProvider {
  readonly id: string;
  readonly connectionFingerprint: string;
  readonly capabilities = { structuredOutput: true, resume: true, toolGuards: false, interactiveQuestions: false } as const;
  private readonly client: CodexClient;

  constructor(private readonly options: CodexProviderOptions = {}) {
    this.id = options.id ?? "codex";
    this.connectionFingerprint = options.connectionFingerprint ?? "codex:default";
    this.client = options.client ?? new Codex(options.sdk);
  }

  run<T>(request: AgentRequest<T>) { return this.execute(request); }

  async resume<T>(session: AgentSession, request: AgentRequest<T>) {
    if (session.provider !== this.id) throw new Error(`cannot resume ${session.provider} session with ${this.id}`);
    if (session.connectionFingerprint !== this.connectionFingerprint) throw new Error(`provider connection changed for ${this.id}; refusing to resume session ${session.id}`);
    return await this.execute(request, session.id);
  }

  private async execute<T>(request: AgentRequest<T>, resumeSessionId?: string): Promise<AgentResult<T>> {
    const model = request.model ?? this.options.defaultModel;
    const threadOptions: ThreadOptions = { model, workingDirectory: request.cwd, sandboxMode: request.guards?.includes("read_only") ? "read-only" : "workspace-write" };
    const thread = resumeSessionId ? this.client.resumeThread(resumeSessionId, threadOptions) : this.client.startThread(threadOptions);
    const prompt = request.systemPrompt ? `${request.systemPrompt}\n\n${request.prompt}` : request.prompt;
    let finalResponse: string | undefined;
    let rawUsage: Usage | undefined;
    let failure: string | undefined;
    try {
      const streamed = await thread.runStreamed(prompt, { outputSchema: z.toJSONSchema(request.schema), signal: request.signal });
      for await (const event of streamed.events) {
        for (const normalized of normalizeEvent(event, this.id, model ?? null)) await request.onEvent?.(normalized);
        if (event.type === "item.completed" && event.item.type === "agent_message") finalResponse = event.item.text;
        else if (event.type === "turn.completed") rawUsage = event.usage;
        else if (event.type === "turn.failed") failure = event.error.message;
        else if (event.type === "error") failure = event.message;
      }
    } catch (error) {
      const message = failure ?? (error instanceof Error ? error.message : String(error));
      await emitFailure(request, new Error(message), thread.id);
      throw providerError(message, error, thread, normalizeUsage(rawUsage, this.id, model ?? null), this.connectionFingerprint);
    }
    const usage = normalizeUsage(rawUsage, this.id, model ?? null);
    if (failure) throw providerError(failure, undefined, thread, usage, this.connectionFingerprint);
    if (!finalResponse) throw providerError("Codex returned no structured output", undefined, thread, usage, this.connectionFingerprint);
    let raw: unknown;
    try { raw = JSON.parse(finalResponse); }
    catch (error) { throw providerError(`Codex returned invalid structured output: ${String(error)}`, error, thread, usage, this.connectionFingerprint); }
    let output: T;
    try { output = request.schema.parse(raw); }
    catch (error) { throw providerError(`Codex output failed schema validation: ${String(error)}`, error, thread, usage, this.connectionFingerprint); }
    return { output, session: session(thread, this.id, this.connectionFingerprint), usage };
  }
}

async function emitFailure<T>(request: AgentRequest<T>, error: unknown, sessionId: string | null): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (request.signal?.aborted) await request.onEvent?.({ type: "lifecycle", scope: "turn", status: "cancelled", ...(sessionId ? { sessionId } : {}), message });
    else {
      await request.onEvent?.({ type: "error", message });
      await request.onEvent?.({ type: "lifecycle", scope: "turn", status: "failed", ...(sessionId ? { sessionId } : {}), message });
    }
  } catch {
    // Preserve the original provider/abort failure if the secondary event write fails.
  }
}

function normalizeUsage(value: Usage | undefined, provider: string, model: string | null): AgentUsage | undefined {
  if (!value) return undefined;
  return { provider, model, inputTokens: value.input_tokens, outputTokens: value.output_tokens, cacheReadInputTokens: value.cached_input_tokens, reasoningOutputTokens: value.reasoning_output_tokens };
}

function session(thread: CodexThread, provider: string, connectionFingerprint: string): AgentSession | undefined {
  return thread.id ? { id: thread.id, provider, connectionFingerprint } : undefined;
}

function providerError(message: string, cause: unknown, thread: CodexThread, usage: AgentUsage | undefined, connectionFingerprint: string): AgentProviderError {
  return new AgentProviderError(message, { session: session(thread, usage?.provider ?? "codex", connectionFingerprint), usage }, cause === undefined ? undefined : { cause });
}

function normalizeEvent(event: ThreadEvent, provider: string, model: string | null): AgentEvent[] {
  if (event.type === "thread.started") return [{ type: "lifecycle", scope: "session", status: "started", sessionId: event.thread_id }];
  if (event.type === "turn.started") return [{ type: "lifecycle", scope: "turn", status: "started" }];
  if (event.type === "turn.completed") { const usage = normalizeUsage(event.usage, provider, model)!; return [{ type: "usage", usage }, { type: "lifecycle", scope: "turn", status: "completed" }]; }
  if (event.type === "turn.failed") return [{ type: "error", message: event.error.message }, { type: "lifecycle", scope: "turn", status: "failed", message: event.error.message }];
  if (event.type === "error") return [{ type: "error", message: event.message }];
  const status = event.type === "item.started" ? "started" : event.type === "item.updated" ? "updated" : "completed";
  const item = event.item;
  if (item.type === "agent_message") return event.type === "item.completed" ? [{ type: "message", role: "assistant", text: item.text, id: item.id }] : [];
  if (item.type === "reasoning") return [{ type: "reasoning", text: item.text, id: item.id }];
  if (item.type === "command_execution") return [{ type: "tool", id: item.id, name: "shell", kind: "command", status: item.status === "failed" ? "failed" : status, input: { command: item.command }, output: item.aggregated_output, ...(item.exit_code !== undefined && item.exit_code !== 0 ? { error: `exit ${item.exit_code}` } : {}) }];
  if (item.type === "mcp_tool_call") return [{ type: "tool", id: item.id, name: `${item.server}/${item.tool}`, kind: "mcp", status: item.status === "failed" ? "failed" : status, input: item.arguments, output: item.result, ...(item.error ? { error: item.error.message } : {}) }];
  if (item.type === "web_search") return [{ type: "tool", id: item.id, name: "web_search", kind: "web_search", status, input: { query: item.query } }];
  if (item.type === "file_change") return [{ type: "file_change", id: item.id, status: item.status === "failed" ? "failed" : status, changes: item.changes }];
  if (item.type === "todo_list") return [{ type: "plan", id: item.id, status, items: item.items }];
  return [{ type: "error", message: item.message }];
}
