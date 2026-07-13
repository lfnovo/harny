import type { PhaseGuards } from "../guardHooks.js";
import { runPhase, type PhaseRunResult } from "../sessionRecorder.js";
import type { LogMode, ResolvedPhaseConfig, RunMode } from "../types.js";
import type { AgentProvider, AgentRequest, AgentResult, AgentSession } from "./types.js";
import { AgentPausedError } from "./types.js";

type RunPhase = typeof runPhase;

export interface ClaudeProviderOptions {
  workflowId: string;
  runId: string;
  taskSlug: string;
  primaryCwd: string;
  mode?: RunMode;
  logMode?: LogMode;
  runPhase?: RunPhase;
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
  readonly id = "claude";
  readonly capabilities = { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true } as const;

  constructor(private readonly options: ClaudeProviderOptions) {}

  run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    return this.execute(request);
  }

  async resume<T>(session: AgentSession, request: AgentRequest<T>): Promise<AgentResult<T>> {
    if (session.provider !== this.id) throw new Error(`cannot resume ${session.provider} session with ${this.id}`);
    return await this.execute(request, session.id);
  }

  private async execute<T>(request: AgentRequest<T>, resumeSessionId?: string): Promise<AgentResult<T>> {
    if (request.signal?.aborted) throw request.signal.reason ?? new Error("agent request aborted");
    const phase = request.phase ?? "agent";
    const result = await raceAbort((this.options.runPhase ?? runPhase)({
      phase,
      phaseConfig: {
        ...DEFAULT_CONFIG,
        prompt: request.systemPrompt ?? "",
        allowedTools: request.allowedTools ?? [],
        model: request.model as ResolvedPhaseConfig["model"],
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
    }), request.signal);
    return normalizeResult(result);
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise; if (signal.aborted) return Promise.reject(signal.reason ?? new Error("agent request aborted"));
  return new Promise((resolve, reject) => { const abort = () => reject(signal.reason ?? new Error("agent request aborted")); signal.addEventListener("abort", abort, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); });
}

function toPhaseGuards(guards: string[] | undefined): PhaseGuards {
  const set = new Set(guards ?? []);
  return { readOnly: set.has("read_only"), noPlanWrites: set.has("no_plan_writes"), noGitHistory: set.has("no_git_history"), noForgeEffects: set.has("no_forge_effects") };
}

function normalizeResult<T>(result: PhaseRunResult<T>): AgentResult<T> {
  if (result.status === "paused_for_user_input") {
    const question = result.parked?.askUserInput.questions.map((item) => item.question).join("\n") ?? "Agent needs input";
    throw new AgentPausedError({ id: result.sessionId, provider: "claude" }, question, result.parked?.askUserInput.questions);
  }
  if (result.status === "error" || result.structuredOutput == null) throw new Error(result.error ?? "Claude returned no structured output");
  return {
    output: result.structuredOutput,
    session: result.sessionId ? { id: result.sessionId, provider: "claude" } : undefined,
    transcript: result.events.map((event) => JSON.stringify(event)).join("\n"),
  };
}
