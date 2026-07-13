import type { AgentUsage } from "../providers/types.js";
import type { NodeInstance, RuntimeAttempt } from "../workflow/runtime.js";

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_output_tokens: number;
  cost_usd: number | null;
  cost_coverage: "none" | "partial" | "complete";
}

export interface UsageSummary {
  total: UsageTotals;
  by_provider: Record<string, UsageTotals>;
}

export function summarizeRunUsage(nodes: Record<string, NodeInstance>): UsageSummary {
  const usages: AgentUsage[] = [];
  const visit = (node: NodeInstance) => { for (const attempt of node.attemptHistory ?? []) if (attempt.usage) usages.push(attempt.usage); for (const step of Object.values(node.steps ?? {})) visit(step); };
  for (const node of Object.values(nodes)) visit(node);
  return summarizeUsages(usages);
}

export function summarizeAttempts(attempts: RuntimeAttempt[] = []): UsageTotals | null {
  const values = attempts.flatMap((attempt) => attempt.usage ? [attempt.usage] : []);
  return values.length ? totals(values) : null;
}

export function summarizeUsages(usages: AgentUsage[]): UsageSummary {
  const groups = new Map<string, AgentUsage[]>();
  for (const usage of usages) { const group = groups.get(usage.provider) ?? []; group.push(usage); groups.set(usage.provider, group); }
  return { total: totals(usages), by_provider: Object.fromEntries([...groups].map(([provider, values]) => [provider, totals(values)])) };
}

function totals(usages: AgentUsage[]): UsageTotals {
  const withCost = usages.filter((usage) => usage.costUsd !== undefined).length;
  return {
    input_tokens: sum(usages, "inputTokens"),
    output_tokens: sum(usages, "outputTokens"),
    cache_read_input_tokens: sum(usages, "cacheReadInputTokens"),
    cache_creation_input_tokens: sum(usages, "cacheCreationInputTokens"),
    reasoning_output_tokens: sum(usages, "reasoningOutputTokens"),
    cost_usd: withCost ? usages.reduce((total, usage) => total + (usage.costUsd ?? 0), 0) : null,
    cost_coverage: withCost === 0 ? "none" : withCost === usages.length ? "complete" : "partial",
  };
}

function sum(usages: AgentUsage[], field: "inputTokens" | "outputTokens" | "cacheReadInputTokens" | "cacheCreationInputTokens" | "reasoningOutputTokens"): number {
  return usages.reduce((total, usage) => total + (usage[field] ?? 0), 0);
}
