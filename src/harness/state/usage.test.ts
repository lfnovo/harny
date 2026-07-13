import { expect, test } from "bun:test";
import type { NodeInstance } from "../workflow/runtime.js";
import { summarizeRunUsage } from "./usage.js";

test("usage totals include nested retries and expose exact cost coverage", () => {
  const nodes: Record<string, NodeInstance> = {
    planner: { id: "planner", status: "completed", attempts: 1, attemptHistory: [{ number: 1, status: "completed", startedAt: "start", usage: { provider: "claude", model: "claude", inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 4, costUsd: 0.01 } }] },
    tasks: { id: "tasks", status: "completed", attempts: 1, steps: {
      "0.developer": { id: "0.developer", status: "completed", attempts: 2, attemptHistory: [
        { number: 1, status: "failed", startedAt: "start", usage: { provider: "codex", model: "gpt", inputTokens: 20, outputTokens: 5, reasoningOutputTokens: 3 } },
        { number: 2, status: "completed", startedAt: "start", usage: { provider: "codex", model: "gpt", inputTokens: 30, outputTokens: 7, cacheReadInputTokens: 8 } },
      ] },
    } },
  };
  expect(summarizeRunUsage(nodes)).toEqual({
    total: { input_tokens: 60, output_tokens: 14, cache_read_input_tokens: 12, cache_creation_input_tokens: 0, reasoning_output_tokens: 3, cost_usd: 0.01, cost_coverage: "partial" },
    by_provider: {
      claude: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 4, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, cost_usd: 0.01, cost_coverage: "complete" },
      codex: { input_tokens: 50, output_tokens: 12, cache_read_input_tokens: 8, cache_creation_input_tokens: 0, reasoning_output_tokens: 3, cost_usd: null, cost_coverage: "none" },
    },
  });
});

test("a run without reported usage has zero tokens and no cost coverage", () => {
  expect(summarizeRunUsage({} ).total).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, cost_usd: null, cost_coverage: "none" });
});
