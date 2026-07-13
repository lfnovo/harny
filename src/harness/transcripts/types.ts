import { z } from "zod";
import { AgentUsageSchema } from "../providers/types.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]));
const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint" || typeof value === "symbol") return String(value);
  if (value === undefined || typeof value === "function") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof URL || value instanceof RegExp) return String(value);
  if (seen.has(value)) return "<circular>";
  seen.add(value);
  if (value instanceof Error) return Object.fromEntries(Object.entries({ ...value, name: value.name, message: value.message, stack: value.stack, cause: value.cause }).map(([key, child]) => [key, toJsonValue(child, seen)]));
  if (value instanceof Map) return [...value.entries()].map(([key, child]) => [toJsonValue(key, seen), toJsonValue(child, seen)]);
  if (value instanceof Set) return [...value].map((child) => toJsonValue(child, seen));
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, seen));
  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (typeof toJSON === "function") { try { return toJsonValue(toJSON.call(value), seen); } catch { return null; } }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toJsonValue(child, seen)]));
}
export function toJsonObject(value: Record<string, unknown>): { [key: string]: JsonValue } { return toJsonValue(value) as { [key: string]: JsonValue }; }

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), prompt: z.string(), systemPrompt: z.string().optional(), model: z.string().optional(), tools: z.array(z.string()).optional(), guards: z.array(z.string()).optional() }),
  z.object({ type: z.literal("lifecycle"), scope: z.enum(["session", "turn"]), status: z.enum(["started", "completed", "paused", "failed", "cancelled"]), sessionId: z.string().optional(), message: z.string().optional() }),
  z.object({ type: z.literal("message"), role: z.enum(["user", "assistant"]), text: z.string(), id: z.string().optional() }),
  z.object({ type: z.literal("reasoning"), text: z.string(), id: z.string().optional() }),
  z.object({ type: z.literal("tool"), id: z.string(), name: z.string(), kind: z.enum(["tool", "command", "mcp", "web_search"]), status: z.enum(["started", "updated", "completed", "failed", "cancelled"]), input: JsonValueSchema.optional(), output: JsonValueSchema.optional(), error: z.string().optional() }),
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
