import type { PhaseGuards } from "../guardHooks.js";
import { runPhase, type PhaseRunResult } from "../sessionRecorder.js";
import type { LogMode, ResolvedPhaseConfig, RunMode } from "../types.js";
import type { AgentProvider, AgentRequest, AgentResult, AgentSession } from "./types.js";
import { AgentPausedError, AgentProviderError, type AgentUsage } from "./types.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { toJsonObject, toJsonValue, type AgentEventSink } from "../transcripts/types.js";

type RunPhase = typeof runPhase;

export interface ClaudeProviderOptions {
  id?: string;
  connectionFingerprint?: string;
  workflowId: string;
  runId: string;
  taskSlug: string;
  primaryCwd: string;
  mode?: RunMode;
  logMode?: LogMode;
  runPhase?: RunPhase;
  defaultModel?: string;
  env?: Record<string, string | undefined>;
}

const DEFAULT_CONFIG: ResolvedPhaseConfig = {
  prompt: "",
  allowedTools: [],
  permissionMode: "default",
  maxTurns: 50,
  effort: "high",
  model: undefined,
  mcpServers: {},
  guards: {},
};

/** Claude SDK details terminate here; workflow executors only see AgentProvider. */
export class ClaudeProvider implements AgentProvider {
  readonly id: string;
  readonly connectionFingerprint: string;
  readonly capabilities = { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true } as const;

  constructor(private readonly options: ClaudeProviderOptions) {
    this.id = options.id ?? "claude";
    this.connectionFingerprint = options.connectionFingerprint ?? "claude:default";
  }

  run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    return this.execute(request);
  }

  async resume<T>(session: AgentSession, request: AgentRequest<T>): Promise<AgentResult<T>> {
    if (session.provider !== this.id) throw new Error(`cannot resume ${session.provider} session with ${this.id}`);
    if (session.connectionFingerprint !== this.connectionFingerprint) throw new Error(`provider connection changed for ${this.id}; refusing to resume session ${session.id}`);
    return await this.execute(request, session.id);
  }

  private async execute<T>(request: AgentRequest<T>, resumeSessionId?: string): Promise<AgentResult<T>> {
    const phase = request.phase ?? "agent";
    let liveSessionId = resumeSessionId;
    if (request.signal?.aborted) {
      await request.onEvent?.({ type: "lifecycle", scope: "turn", status: "cancelled", ...(resumeSessionId ? { sessionId: resumeSessionId } : {}), message: abortMessage(request.signal.reason) });
      throw request.signal.reason ?? new Error("agent request aborted");
    }
    await request.onEvent?.({ type: "lifecycle", scope: "turn", status: "started", ...(resumeSessionId ? { sessionId: resumeSessionId } : {}) });
    try {
      const result = await raceAbort((this.options.runPhase ?? runPhase)({
        phase,
        phaseConfig: {
          ...DEFAULT_CONFIG,
          prompt: request.systemPrompt ?? "",
          allowedTools: request.allowedTools ?? [],
          maxTurns: request.maxTurns ?? DEFAULT_CONFIG.maxTurns,
          model: (request.model ?? this.options.defaultModel) as ResolvedPhaseConfig["model"],
          guards: toPhaseGuards(request.guards),
        },
        primaryCwd: this.options.primaryCwd,
        phaseCwd: request.cwd,
        taskSlug: this.options.taskSlug,
        harnessTaskId: request.taskId ?? null,
        prompt: request.prompt,
        outputSchema: request.schema,
        resumeSessionId,
        logMode: this.options.logMode ?? "compact",
        mode: this.options.mode ?? "silent",
        guards: toPhaseGuards(request.guards),
        workflowId: this.options.workflowId,
        runId: this.options.runId,
        env: request.env ? { ...process.env, ...this.options.env, ...request.env } : this.options.env,
        signal: request.signal,
        onMessage: (message) => { liveSessionId = sessionIdFromMessage(message) ?? liveSessionId; return emitClaudeMessage(message, request.onEvent); },
      }), request.signal);
      return await normalizeResult(result, this.id, this.connectionFingerprint, request.model ?? this.options.defaultModel ?? null, request.onEvent);
    } catch (error) {
      if (request.signal?.aborted) {
        await request.onEvent?.({ type: "lifecycle", scope: "turn", status: "cancelled", ...(liveSessionId ? { sessionId: liveSessionId } : {}), message: abortMessage(request.signal.reason) });
        throw request.signal.reason ?? error;
      }
      if (error instanceof AgentProviderError || error instanceof AgentPausedError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await request.onEvent?.({ type: "error", message });
      await request.onEvent?.({ type: "lifecycle", scope: "turn", status: "failed", ...(liveSessionId ? { sessionId: liveSessionId } : {}), message });
      throw new AgentProviderError(message, liveSessionId ? { session: { id: liveSessionId, provider: this.id, connectionFingerprint: this.connectionFingerprint } } : {}, { cause: error });
    }
  }
}

function sessionIdFromMessage(message: SDKMessage): string | undefined { const value = message as unknown as Record<string, unknown>; return value.type === "system" && value.subtype === "init" && typeof value.session_id === "string" ? value.session_id : undefined; }

function abortMessage(reason: unknown): string { return reason instanceof Error ? reason.message : reason === undefined ? "agent request aborted" : String(reason); }

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise; if (signal.aborted) return Promise.reject(signal.reason ?? new Error("agent request aborted"));
  return new Promise((resolve, reject) => { const abort = () => reject(signal.reason ?? new Error("agent request aborted")); signal.addEventListener("abort", abort, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); });
}

function toPhaseGuards(guards: string[] | undefined): PhaseGuards {
  const set = new Set(guards ?? []);
  return { readOnly: set.has("read_only"), noGitHistory: set.has("no_git_history"), noForgeEffects: set.has("no_forge_effects") };
}

async function normalizeResult<T>(result: PhaseRunResult<T>, provider: string, connectionFingerprint: string, requestedModel: string | null, sink?: AgentEventSink): Promise<AgentResult<T>> {
  const usage = normalizeUsage(result, provider, requestedModel);
  const session = result.sessionId ? { id: result.sessionId, provider, connectionFingerprint } : undefined;
  if (usage) await sink?.({ type: "usage", usage });
  if (result.status === "paused_for_user_input") {
    const question = result.parked?.askUserInput.questions.map((item) => item.question).join("\n") ?? "Agent needs input";
    await sink?.({ type: "lifecycle", scope: "turn", status: "paused", sessionId: result.sessionId, message: question });
    throw new AgentPausedError({ id: result.sessionId, provider, connectionFingerprint }, question, result.parked?.askUserInput.questions, { usage });
  }
  if (result.status === "error" || result.structuredOutput == null) {
    const message = result.error ?? "Claude returned no structured output";
    await sink?.({ type: "error", message }); await sink?.({ type: "lifecycle", scope: "turn", status: "failed", ...(session ? { sessionId: session.id } : {}), message });
    throw new AgentProviderError(message, { session, usage });
  }
  await sink?.({ type: "lifecycle", scope: "turn", status: "completed", ...(session ? { sessionId: session.id } : {}) });
  return {
    output: result.structuredOutput,
    session,
    usage,
  };
}

async function emitClaudeMessage(message: SDKMessage, sink?: AgentEventSink): Promise<void> {
  if (!sink) return;
  const value = message as unknown as Record<string, unknown>;
  if (value.type === "system") {
    if (value.subtype === "init" && typeof value.session_id === "string") await sink({ type: "lifecycle", scope: "session", status: "started", sessionId: value.session_id });
    else if (typeof value.subtype === "string") await sink({ type: "status", name: value.subtype, data: toJsonObject(value) });
    return;
  }
  const blocks = ((value.message as Record<string, unknown> | undefined)?.content ?? []) as unknown[];
  if (value.type === "assistant" || value.type === "user") {
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const item = block as Record<string, unknown>;
      if (item.type === "text" && typeof item.text === "string") await sink({ type: "message", role: value.type === "assistant" ? "assistant" : "user", text: item.text, ...(typeof item.id === "string" ? { id: item.id } : {}) });
      else if ((item.type === "thinking" || item.type === "reasoning") && typeof (item.thinking ?? item.text) === "string") await sink({ type: "reasoning", text: String(item.thinking ?? item.text), ...(typeof item.id === "string" ? { id: item.id } : {}) });
      else if (item.type === "tool_use" && typeof item.id === "string") await sink({ type: "tool", id: item.id, name: typeof item.name === "string" ? item.name : "tool", kind: "tool", status: "started", input: toJsonValue(item.input) });
      else if (item.type === "tool_result" && typeof item.tool_use_id === "string") await sink({ type: "tool", id: item.tool_use_id, name: "tool", kind: "tool", status: item.is_error === true || item.isError === true ? "failed" : "completed", output: toJsonValue(item.content), ...((item.is_error === true || item.isError === true) ? { error: summarize(item.content) } : {}) });
    }
    return;
  }
  if (value.type === "tool_progress" && typeof value.tool_use_id === "string") await sink({ type: "tool", id: value.tool_use_id, name: typeof value.tool_name === "string" ? value.tool_name : "tool", kind: "tool", status: "updated", output: toJsonObject(value) });
}

function summarize(value: unknown): string { let text: string; try { const encoded = typeof value === "string" ? value : JSON.stringify(value); text = encoded === undefined ? String(value) : encoded; } catch { try { text = String(value); } catch { text = "<unserializable>"; } } return text.length > 500 ? `${text.slice(0, 500)}…` : text; }

function normalizeUsage<T>(result: PhaseRunResult<T>, provider: string, requestedModel: string | null): AgentUsage | undefined {
  if (!result.usage) return undefined;
  const models = result.usage.models;
  const modelNames = Object.keys(models ?? {});
  return { ...result.usage, provider, model: modelNames.length === 1 ? modelNames[0]! : requestedModel, ...(models && Object.keys(models).length ? { models } : {}) };
}
