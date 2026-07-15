import { expect, test } from "bun:test";
import type { RunSnapshot } from "./runSchema.js";
import { summarizeExecution, toRunView } from "./runView.js";

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

/**
 * The run list draws its pipeline from these two fields. They used to be the
 * constants `null` and `0`, which pinned every running run's pipeline to Planner.
 */
function snap(nodes: RunSnapshot["execution"]["nodes"], status: RunSnapshot["execution"]["status"] = "running"): RunSnapshot {
  return {
    schema_version: 4,
    run: { id: "run", task_slug: "sum", workflow: "feature-dev", started_at: "2026-01-01T00:00:00.000Z", ended_at: null, ended_reason: null, pid: 1, parent_run_id: null },
    origin: { prompt: "x", workflow_source: "feature-dev", cwd: "/repo", host: "h", user: "u" },
    workspace: { isolation: "inline", primary_cwd: "/repo", cwd: "/repo", branch: "", worktree_path: null, reserved: true },
    inputs: {}, changesets: {},
    execution: { workflow: "feature-dev", status, nodes },
  };
}
const node = (id: string, status: string, attempts = 1) => ({ id, status, attempts } as never);

test("summarizeExecution reports the planner while it plans", () => {
  const s = summarizeExecution(snap({ planner: node("planner", "running"), final_validator: node("final_validator", "pending", 0) }));
  expect(s.current_phase).toBe("planner");
});

test("summarizeExecution names a nested developer and validator by their scoped path", () => {
  // `tasks:0.developer` is what the viewer matches its pipeline roles on.
  const dev = summarizeExecution(snap({
    planner: node("planner", "completed"),
    tasks: { id: "tasks", status: "running", attempts: 1, steps: { "0.developer": node("developer", "running"), "0.validator": node("validator", "pending", 0) } } as never,
  }));
  expect(dev.current_phase).toBe("tasks:0.developer");
  const val = summarizeExecution(snap({
    planner: node("planner", "completed"),
    tasks: { id: "tasks", status: "running", attempts: 1, steps: { "0.developer": node("developer", "completed"), "0.validator": node("validator", "running") } } as never,
  }));
  expect(val.current_phase).toBe("tasks:0.validator");
});

test("summarizeExecution never reports the foreach container", () => {
  // `tasks` reports running for as long as any child runs; naming it would make
  // every task phase look like it was sitting in a node that does no work.
  const s = summarizeExecution(snap({
    tasks: { id: "tasks", status: "running", attempts: 1, steps: { "0.developer": node("developer", "running") } } as never,
  }));
  expect(s.current_phase).toBe("tasks:0.developer");
});

test("summarizeExecution reports the final validator", () => {
  const s = summarizeExecution(snap({
    planner: node("planner", "completed"),
    tasks: { id: "tasks", status: "completed", attempts: 1, steps: { "0.developer": node("developer", "completed") } } as never,
    final_validator: node("final_validator", "running"),
  }));
  expect(s.current_phase).toBe("final_validator");
});

test("summarizeExecution reports a paused node, so a parked run does not read as Planner", () => {
  const s = summarizeExecution(snap({ planner: node("planner", "completed"), approval: node("approval", "paused") }, "paused"));
  expect(s.current_phase).toBe("approval");
});

test("summarizeExecution falls back to the last phase that did something", () => {
  // Done and failed runs have nothing running; the truthful answer is where it
  // stopped, which still beats falling back to the first pip.
  const done = summarizeExecution(snap({ planner: node("planner", "completed"), final_validator: node("final_validator", "completed") }, "done"));
  expect(done.current_phase).toBe("final_validator");
  const failed = summarizeExecution(snap({ planner: node("planner", "completed"), final_validator: node("final_validator", "failed") }, "failed"));
  expect(failed.current_phase).toBe("final_validator");
});

test("summarizeExecution counts attempts beyond the first, and never the container's", () => {
  const s = summarizeExecution(snap({
    planner: node("planner", "completed", 1),
    tasks: { id: "tasks", status: "running", attempts: 3, steps: { "0.developer": node("developer", "completed", 3), "0.validator": node("validator", "running", 2) } } as never,
  }));
  // 2 from the developer + 1 from the validator; the container's 3 are its children's.
  expect(s.retries).toBe(3);
});

test("summarizeExecution reports nothing for a run that has not started", () => {
  const s = summarizeExecution(snap({ planner: node("planner", "pending", 0) }));
  expect(s.current_phase).toBeNull();
  expect(s.retries).toBe(0);
});
