import type { z } from "zod";

export interface ProviderCapabilities {
  structuredOutput: boolean;
  resume: boolean;
  toolGuards: boolean;
  interactiveQuestions: boolean;
}

export interface AgentSession {
  id: string;
  provider: string;
}

export interface AgentRequest<T> {
  phase?: string;
  taskId?: string;
  prompt: string;
  systemPrompt?: string;
  cwd: string;
  schema: z.ZodType<T>;
  allowedTools?: string[];
  guards?: string[];
  model?: string;
  signal?: AbortSignal;
}

export interface AgentResult<T> {
  output: T;
  session?: AgentSession;
  transcript?: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

export class AgentPausedError extends Error {
  constructor(public readonly session: AgentSession, public readonly question: string, public readonly options?: unknown[]) { super(`agent paused for input: ${question}`); }
}

/** Provider-neutral boundary used by workflow executors. */
export interface AgentProvider {
  id: string;
  capabilities: ProviderCapabilities;
  run<T>(request: AgentRequest<T>): Promise<AgentResult<T>>;
  resume?<T>(session: AgentSession, request: AgentRequest<T>): Promise<AgentResult<T>>;
}
