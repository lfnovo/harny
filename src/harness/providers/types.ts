import { z } from "zod";
import type { AgentEventSink } from "../transcripts/types.js";

export const UsageMetricsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative().optional(),
  cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  reasoningOutputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

export const AgentUsageSchema = UsageMetricsSchema.extend({
  provider: z.string().min(1),
  model: z.string().nullable(),
  models: z.record(z.string(), UsageMetricsSchema).optional(),
});

export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

export interface ProviderCapabilities {
  structuredOutput: boolean;
  resume: boolean;
  toolGuards: boolean;
  interactiveQuestions: boolean;
}

export interface AgentSession {
  id: string;
  provider: string;
  connectionFingerprint: string;
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
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  onEvent?: AgentEventSink;
}

export interface AgentResult<T> {
  output: T;
  session?: AgentSession;
  usage?: AgentUsage;
}

export class AgentProviderError extends Error {
  constructor(message: string, public readonly metadata: { session?: AgentSession; usage?: AgentUsage } = {}, options?: ErrorOptions) {
    super(message, options);
  }
}

export class AgentPausedError extends Error {
  constructor(public readonly session: AgentSession, public readonly question: string, public readonly options?: unknown[], public readonly metadata: { usage?: AgentUsage } = {}) { super(`agent paused for input: ${question}`); }
}

/** Provider-neutral boundary used by workflow executors. */
export interface AgentProvider {
  id: string;
  connectionFingerprint: string;
  capabilities: ProviderCapabilities;
  run<T>(request: AgentRequest<T>): Promise<AgentResult<T>>;
  resume?<T>(session: AgentSession, request: AgentRequest<T>): Promise<AgentResult<T>>;
}
