import { z } from "zod";
import { AgentUsageSchema } from "../providers/types.js";

const JsonObjectSchema = z.record(z.string(), z.unknown());

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), prompt: z.string(), systemPrompt: z.string().optional(), model: z.string().optional(), tools: z.array(z.string()).optional(), guards: z.array(z.string()).optional() }),
  z.object({ type: z.literal("lifecycle"), scope: z.enum(["session", "turn"]), status: z.enum(["started", "completed", "paused", "failed", "cancelled"]), sessionId: z.string().optional(), message: z.string().optional() }),
  z.object({ type: z.literal("message"), role: z.enum(["user", "assistant"]), text: z.string(), id: z.string().optional() }),
  z.object({ type: z.literal("reasoning"), text: z.string(), id: z.string().optional() }),
  z.object({ type: z.literal("tool"), id: z.string(), name: z.string(), kind: z.enum(["tool", "command", "mcp", "web_search"]), status: z.enum(["started", "updated", "completed", "failed", "cancelled"]), input: z.unknown().optional(), output: z.unknown().optional(), error: z.string().optional() }),
  z.object({ type: z.literal("file_change"), id: z.string(), status: z.enum(["started", "updated", "completed", "failed"]), changes: z.array(z.object({ path: z.string(), kind: z.enum(["add", "delete", "update"]) })) }),
  z.object({ type: z.literal("plan"), id: z.string(), status: z.enum(["started", "updated", "completed"]), items: z.array(z.object({ text: z.string(), completed: z.boolean() })) }),
  z.object({ type: z.literal("usage"), usage: AgentUsageSchema }),
  z.object({ type: z.literal("status"), name: z.string(), data: JsonObjectSchema.optional() }),
  z.object({ type: z.literal("error"), message: z.string(), retryable: z.boolean().optional() }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventSink = (event: AgentEvent) => void | Promise<void>;

export const TranscriptRecordSchema = z.object({
  version: z.literal(1),
  seq: z.number().int().positive(),
  at: z.string(),
  provider: z.string().min(1),
  event: AgentEventSchema,
});

export type TranscriptRecord = z.infer<typeof TranscriptRecordSchema>;
export type TranscriptAttemptRef = { instanceId: string; attempt: number };
