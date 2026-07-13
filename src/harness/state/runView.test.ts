import { expect, test } from "bun:test";
import type { RunSnapshot } from "./runSchema.js";
import { toRunView } from "./runView.js";

test("run view derives provider totals while retaining attempt and model detail", () => {
  const run: RunSnapshot = {
    schema_version: 4,
    run: { id: "run", task_slug: "usage", workflow: "mixed", started_at: "2026-01-01T00:00:00.000Z", ended_at: null, ended_reason: null, pid: 1, parent_run_id: null },
    origin: { prompt: "x", workflow_source: "mixed", cwd: "/repo", host: "host", user: "user" },
    workspace: { isolation: "inline", primary_cwd: "/repo", cwd: "/repo", branch: "", worktree_path: null, reserved: true },
    inputs: {}, changesets: {},
    execution: { workflow: "mixed", status: "running", nodes: { planner: { id: "planner", status: "completed", attempts: 1, attemptHistory: [{ number: 1, status: "completed", startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:01:00.000Z", session: { id: "session", provider: "claude_proxy", connectionFingerprint: "fingerprint" }, usage: { provider: "claude_proxy", model: "claude-test", inputTokens: 9, outputTokens: 2, costUsd: 0.01, models: { "claude-test": { inputTokens: 9, outputTokens: 2, costUsd: 0.01 } } } }], output: { summary: "plan", tasks: [] } } } },
  };
  const view = toRunView(run);
  expect(view.usage.by_provider.claude_proxy).toMatchObject({ input_tokens: 9, output_tokens: 2, cost_usd: 0.01, cost_coverage: "complete" });
  expect(view.phases[0]).toMatchObject({ session_id: "session", usage: { input_tokens: 9 }, attempts_detail: [{ usage: { model: "claude-test", models: { "claude-test": { inputTokens: 9 } } } }] });
  expect("usage" in run).toBe(false);
});

test("run view keeps pending attempts honest and tolerates malformed planner tasks", () => {
  const run: RunSnapshot = { schema_version: 4, run: { id: "run", task_slug: "view", workflow: "flow", started_at: "2026-01-01T00:00:00.000Z", ended_at: null, ended_reason: null, pid: 1, parent_run_id: null }, origin: { prompt: "x", workflow_source: "flow", cwd: "/repo", host: "h", user: "u" }, workspace: { isolation: "inline", primary_cwd: "/repo", cwd: "/repo", branch: "", worktree_path: null, reserved: true }, inputs: {}, changesets: {}, execution: { workflow: "flow", status: "running", nodes: { planner: { id: "planner", status: "completed", attempts: 1, output: { tasks: "not-an-array" } }, pending: { id: "pending", status: "pending", attempts: 0 } } } };
  const view = toRunView(run); expect(view.phases.find((phase) => phase.name === "pending")).toMatchObject({ attempt: 0, started_at: null }); expect(view.plan?.tasks).toEqual([]);
});
