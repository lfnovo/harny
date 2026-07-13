import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentProvider } from "../providers/types.js";
import { loadWorkflow, loadWorkflowFile, resolveCommand } from "./loader.js";
import { createCommandExecutor } from "./commandExecutor.js";
import { WorkflowDefinitionSchema } from "./schema.js";
import { answerWorkflow, materializeHumanExpiry, RetryWorkflowStepError, runWorkflow, type WorkflowSnapshot, type WorkflowStateStore } from "./runtime.js";
import { createHumanExecutor } from "./humanExecutor.js";
import { validateWorkflow, WorkflowValidationError } from "./validate.js";

const base = {
  version: 2 as const, name: "test-flow", defaults: { provider: "claude", timeout: 1000 },
  workspace: { isolation: "worktree" as const }, outcome: { type: "branch" as const },
  nodes: [
    { id: "develop", type: "agent" as const, command: "developer", depends_on: [], inputs: {}, guards: [], requires: ["structured_output" as const] },
    { id: "commit", type: "commit" as const, message: "done", changeset: "${{ nodes.develop.outputs.changeset }}", depends_on: ["develop"], inputs: {} },
  ],
};

const provider: AgentProvider = {
  id: "claude", connectionFingerprint: "claude:test", capabilities: { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true },
  async run(request) { return { output: request.schema.parse({}) }; },
};

describe("workflow schema and static validation", () => {
  test("rejects workflow v1 instead of silently changing its semantics", () => { expect(() => WorkflowDefinitionSchema.parse({ ...base, version: 1 })).toThrow(); });
  test("rejects unsupported references and guards before workspace creation", () => { const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{ id: "agent", type: "agent", command: "work", guards: ["no_plan_writes"], inputs: { value: "${{ run.branch }}" } }] }); expect(() => validateWorkflow(workflow)).toThrow("unsupported reference"); expect(() => validateWorkflow(workflow)).toThrow("unknown guard"); });
  test("accepts a valid provider-neutral DAG", () => {
    const workflow = WorkflowDefinitionSchema.parse(base);
    expect(() => validateWorkflow(workflow, new Map([[provider.id, provider]]))).not.toThrow();
  });

  test("reports unknown dependencies, cycles, missing outcomes, and human timeout", () => {
    const workflow = WorkflowDefinitionSchema.parse({
      ...base, defaults: { provider: "claude" }, outcome: { type: "pull_request" },
      nodes: [
        { id: "a", type: "command", command: ["true"], depends_on: ["b"], inputs: {} },
        { id: "b", type: "human", question: "continue?", depends_on: ["a", "missing"], inputs: {} },
      ],
    });
    try { validateWorkflow(workflow); throw new Error("expected failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(WorkflowValidationError);
      expect(String(error)).toContain("unknown node missing");
      expect(String(error)).toContain("requires a timeout");
      expect(String(error)).toContain("dependency cycle");
      expect(String(error)).toContain("outcome is not reachable");
    }
  });

  test("rejects unsupported provider capabilities before execution", () => {
    const workflow = WorkflowDefinitionSchema.parse(base);
    const incapable = { ...provider, capabilities: { ...provider.capabilities, structuredOutput: false } };
    expect(() => validateWorkflow(workflow, new Map([[incapable.id, incapable]]))).toThrow("unsupported capability structured_output");
  });

  test("loads and validates YAML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "harny-workflow-"));
    const path = join(dir, "flow.yaml");
    await writeFile(path, `version: 2\nname: yaml-flow\ndefaults:\n  provider: claude\nworkspace:\n  isolation: inline\noutcome:\n  type: none\nnodes:\n  - id: hello\n    type: command\n    command: [echo, hello]\n`);
    expect((await loadWorkflowFile(path)).name).toBe("yaml-flow");
  });

  test("bundled feature-dev YAML matches the normalized contract", async () => {
    const loaded = await loadWorkflow("feature-dev", { cwd: join(tmpdir(), "no-project-overrides") });
    expect(loaded.definition.name).toBe("feature-dev");
    expect(loaded.definition.nodes.map((node) => node.type)).toEqual(["agent", "foreach", "agent"]);
    expect(loaded.definition.nodes.at(-1)).toMatchObject({ id: "final_validator", depends_on: ["tasks"] });
  });

  test("rejects non-strict generic output schemas before execution", () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{ id: "inspect", type: "agent", command: "inspect", output_schema: { type: "object", required: ["summary"] } }] });
    expect(() => validateWorkflow(workflow)).toThrow("must declare object properties");
  });

  test("bundles feature-pr and review-fix with safe PR policies", async () => {
    const cwd = join(tmpdir(), "no-pr-overrides"); const featurePr = (await loadWorkflow("feature-pr", { cwd })).definition; const reviewFix = (await loadWorkflow("review-fix", { cwd })).definition;
    expect(featurePr.nodes.find((node) => node.type === "pull_request")).toMatchObject({ type: "pull_request", draft: true, existing: "allow" });
    expect(reviewFix.nodes.find((node) => node.type === "pull_request")).toMatchObject({ type: "pull_request", existing: "require" });
  });

  test("validates bounded sequential foreach steps", () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{
      id: "tasks", type: "foreach", items: ["a", "b"], as: "task", max_items: 5, depends_on: [], inputs: {},
      steps: [
        { id: "develop", type: "command", command: ["echo", "${{ task }}"], depends_on: [], inputs: {} },
        { id: "check", type: "command", command: ["true"], depends_on: ["develop"], inputs: {} },
      ],
    }] });
    expect(() => validateWorkflow(workflow)).not.toThrow();
  });
  test("rejects inline shell scripts", () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{ id: "script", type: "command", command: ["sh", "-c", "echo unsafe"], depends_on: [], inputs: {} }] });
    expect(() => validateWorkflow(workflow)).toThrow("inline shell script");
  });
  test("output references require dependency ordering", () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [
      { id: "consumer", type: "command", command: ["echo", "${{ nodes.producer.outputs.value }}"], depends_on: [], inputs: {} },
      { id: "producer", type: "command", command: ["true"], depends_on: [], inputs: {} },
    ] });
    expect(() => validateWorkflow(workflow)).toThrow("without depending on it");
  });

  test("workflow and Markdown command precedence is project > global > bundled", async () => {
    const root = await mkdtemp(join(tmpdir(), "harny-precedence-")); const cwd = join(root, "project"); const home = join(root, "home"); const bundled = join(root, "bundled");
    const yaml = (name: string) => `version: 2\nname: ${name}\ndefaults: { provider: claude }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: run, type: command, command: [echo] }\n`;
    for (const dir of [join(cwd, ".harny/workflows"), join(home, ".harny/workflows"), bundled, join(cwd, ".harny/commands"), join(home, ".harny/commands"), join(bundled, "commands")]) await mkdir(dir, { recursive: true });
    await writeFile(join(bundled, "sample.yaml"), yaml("bundled")); await writeFile(join(home, ".harny/workflows/sample.yaml"), yaml("global")); await writeFile(join(cwd, ".harny/workflows/sample.yaml"), yaml("project"));
    await writeFile(join(bundled, "commands/build.md"), "bundled"); await writeFile(join(home, ".harny/commands/build.md"), "global"); await writeFile(join(cwd, ".harny/commands/build.md"), "project");
    expect((await loadWorkflow("sample", { cwd, home, bundledDir: bundled })).definition.name).toBe("project");
    expect((await resolveCommand("build", { cwd, home, bundledDir: bundled })).content).toBe("project");
  });
});

class MemoryStore implements WorkflowStateStore {
  state: WorkflowSnapshot | null = null;
  writes: WorkflowSnapshot[] = [];
  async load() { return this.state ? structuredClone(this.state) : null; }
  async save(value: WorkflowSnapshot) { this.state = structuredClone(value); this.writes.push(structuredClone(value)); }
}

describe("persistent sequential scheduler", () => {
  test("notifies an observer without making it authoritative", async () => {
    const store = new MemoryStore(); const events: string[] = [];
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{ id: "one", type: "command", command: ["true"] }] });
    const result = await runWorkflow({ workflow, store, observer: { observe(event) { events.push(event.type); if (event.type === "node.completed") throw new Error("observer offline"); } }, executors: { command: async () => ({ ok: true }) } });
    expect(result.status).toBe("done"); expect(events).toEqual(["node.started", "node.completed", "run.finished"]);
  });

  test("runs ready nodes in declaration order and persists each boundary", async () => {
    const store = new MemoryStore(); const calls: string[] = [];
    const result = await runWorkflow({ workflow: WorkflowDefinitionSchema.parse(base), store, executors: {
      agent: async (node) => { calls.push(node.id); return { changeset: "abc" }; },
      commit: async (node) => { calls.push(node.id); return { sha: "123" }; },
    } });
    expect(calls).toEqual(["develop", "commit"]);
    expect(result.status).toBe("done");
    expect(store.writes.length).toBeGreaterThanOrEqual(5);
  });

  test("retries within the configured bound and recovers from persisted state", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, nodes: [{ ...base.nodes[0], retry: { max_attempts: 2 } }, base.nodes[1]] });
    const store = new MemoryStore(); let calls = 0;
    const result = await runWorkflow({ workflow, store, executors: {
      agent: async () => { if (++calls === 1) throw new Error("transient"); return { changeset: "abc" }; },
      commit: async () => ({}),
    } });
    expect(result.status).toBe("done");
    expect(result.nodes.develop?.attempts).toBe(2);
  });

  test("persists provider usage on every attempt before retry and derives no aggregate state", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, nodes: [{ ...base.nodes[0], retry: { max_attempts: 2 } }, base.nodes[1]] });
    const store = new MemoryStore(); let calls = 0;
    const result = await runWorkflow({ workflow, store, executors: {
      agent: async (_node, context) => {
        calls++;
        await context.reportAttempt({ session: { id: `session-${calls}`, provider: "codex", connectionFingerprint: "codex:test" }, usage: { provider: "codex", model: "gpt-test", inputTokens: calls * 10, outputTokens: calls } });
        if (calls === 1) throw new Error("retry after billed attempt");
        return { changeset: "abc" };
      },
      commit: async () => ({}),
    } });
    expect(result.nodes.develop?.attemptHistory?.map((attempt) => ({ status: attempt.status, input: attempt.usage?.inputTokens, session: attempt.session?.id }))).toEqual([
      { status: "failed", input: 10, session: "session-1" },
      { status: "completed", input: 20, session: "session-2" },
    ]);
    expect("usage" in result).toBe(false);
    expect(store.writes.some((write) => write.nodes.develop?.attemptHistory?.[0]?.status === "running" && write.nodes.develop?.attemptHistory?.[0]?.usage?.inputTokens === 10)).toBe(true);
  });

  test("fails after retries are exhausted", async () => {
    const store = new MemoryStore();
    const result = await runWorkflow({ workflow: WorkflowDefinitionSchema.parse(base), store, executors: {
      agent: async () => { throw new Error("blocked"); }, commit: async () => ({}),
    } });
    expect(result.status).toBe("failed");
    expect(result.nodes.develop?.error).toContain("blocked");
  });

  test("foreach executes every step sequentially for every item", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{
      id: "tasks", type: "foreach", items: ["one", "two"], as: "task", max_items: 2, depends_on: [], inputs: {},
      steps: [
        { id: "develop", type: "command", command: ["echo", "${{ task }}"], depends_on: [], inputs: {} },
        { id: "validate", type: "command", command: ["check", "${{ task }}"], depends_on: ["develop"], inputs: {} },
      ],
    }] });
    const store = new MemoryStore(); const calls: string[] = [];
    const result = await runWorkflow({ workflow, store, executors: { command: async (node) => { if (node.type === "command") calls.push(node.command.join(" ")); return {}; } } });
    expect(calls).toEqual(["echo one", "check one", "echo two", "check two"]);
    expect(result.status).toBe("done");
  });

  test("assigns stable transcript identities to top-level and foreach attempts", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [
      { id: "prepare", type: "command", command: ["true"], depends_on: [], inputs: {}, retry: { max_attempts: 2 } },
      { id: "tasks", type: "foreach", items: ["one", "two"], as: "task", max_items: 2, depends_on: ["prepare"], inputs: {}, steps: [
        { id: "work", type: "command", command: ["true"], depends_on: [], inputs: {} },
      ] },
    ] });
    const attempts: Array<{ instanceId: string; attempt: number }> = []; let prepareCalls = 0;
    const result = await runWorkflow({ workflow, store: new MemoryStore(), executors: { command: async (node, context) => {
      attempts.push(context.attempt);
      if (node.id === "prepare" && ++prepareCalls === 1) throw new Error("retry");
      return {};
    } } });
    expect(result.status).toBe("done");
    expect(attempts).toEqual([
      { instanceId: "prepare", attempt: 1 },
      { instanceId: "prepare", attempt: 2 },
      { instanceId: "tasks:0:work", attempt: 1 },
      { instanceId: "tasks:1:work", attempt: 1 },
    ]);
  });

  test("foreach enforces max_items before executing a step", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{
      id: "tasks", type: "foreach", items: [1, 2], as: "task", max_items: 1, depends_on: [], inputs: {},
      steps: [{ id: "work", type: "command", command: ["true"], depends_on: [], inputs: {} }],
    }] });
    const result = await runWorkflow({ workflow, store: new MemoryStore(), executors: { command: async () => ({}) } });
    expect(result.status).toBe("failed");
    expect(result.nodes.tasks?.error).toContain("limit is 1");
  });

  test("recovery does not repeat checkpointed foreach steps", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{
      id: "tasks", type: "foreach", items: ["one"], as: "task", max_items: 1, depends_on: [], inputs: {},
      steps: [
        { id: "first", type: "command", command: ["first"], depends_on: [], inputs: {} },
        { id: "second", type: "command", command: ["second"], depends_on: ["first"], inputs: {} },
      ],
    }] });
    const store = new MemoryStore();
    store.state = { workflow: "test-flow", status: "running", nodes: { tasks: { id: "tasks", status: "running", attempts: 1, steps: {
      "0.first": { id: "0.first", status: "completed", attempts: 1, output: { safe: true } },
    } } } };
    const calls: string[] = [];
    const result = await runWorkflow({ workflow, store, executors: { command: async (node) => { if (node.type === "command") calls.push(node.id); return {}; } } });
    expect(calls).toEqual(["second"]);
    expect(result.status).toBe("done");
  });

  test("bounded retry can return to an earlier foreach step", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{
      id: "tasks", type: "foreach", items: ["one"], as: "task", max_items: 1, depends_on: [], inputs: {},
      steps: [
        { id: "develop", type: "command", command: ["develop"], depends_on: [], inputs: {} },
        { id: "validate", type: "command", command: ["validate"], depends_on: ["develop"], inputs: {}, retry: { max_attempts: 2, return_to: "develop" } },
      ],
    }] });
    const store = new MemoryStore(); let validations = 0; const calls: string[] = [];
    const result = await runWorkflow({ workflow, store, executors: { command: async (node) => {
      if (node.type !== "command") return {};
      calls.push(node.id);
      if (node.id === "validate" && ++validations === 1) throw new RetryWorkflowStepError("develop", "try again");
      return {};
    } } });
    expect(calls).toEqual(["develop", "validate", "develop", "validate"]);
    expect(result.status).toBe("done");
  });

  test("command executor captures output and rejects non-zero exit", async () => {
    const executor = createCommandExecutor(process.cwd()); const controller = new AbortController();
    const ok = await executor(WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{ id: "run", type: "command", command: ["printf", "hello"], depends_on: [], inputs: {} }] }).nodes[0]!, { snapshot: { workflow: "x", status: "running", nodes: {} }, signal: controller.signal, attempt: { instanceId: "run", attempt: 1 }, reportAttempt: async () => {} });
    expect(ok).toEqual({ stdout: "hello", stderr: "", exit_code: 0 });
    expect(executor(WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{ id: "bad", type: "command", command: ["false"], depends_on: [], inputs: {} }] }).nodes[0]!, { snapshot: { workflow: "x", status: "running", nodes: {} }, signal: controller.signal, attempt: { instanceId: "bad", attempt: 1 }, reportAttempt: async () => {} })).rejects.toThrow("exit 1");
  });

  test("human node parks asynchronously and resumes from persisted answer", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, defaults: { provider: "claude", timeout: 60_000 }, outcome: { type: "none" }, nodes: [
      { id: "review", type: "human", question: "Ship it?", depends_on: [], inputs: {} },
      { id: "after", type: "command", command: ["true"], depends_on: ["review"], inputs: {} },
    ] });
    const store = new MemoryStore(); let after = 0;
    const executors = { human: createHumanExecutor({ mode: "async", async ask() { throw new Error("not called"); } }, 60_000), command: async () => { after++; return {}; } };
    const parked = await runWorkflow({ workflow, store, executors });
    expect(parked.status).toBe("paused"); expect(parked.pendingHuman?.question).toBe("Ship it?"); expect(after).toBe(0);
    await answerWorkflow(store, { approved: true });
    const resumed = await runWorkflow({ workflow, store, executors });
    expect(resumed.status).toBe("done"); expect(resumed.nodes.review?.output).toEqual({ approved: true }); expect(after).toBe(1);
  });

  test("human expiry fails without fallback and resumes with fallback", async () => {
    const expired = (fallback?: string) => ({ workflow: "flow", status: "paused" as const, nodes: { review: { id: "review", status: "paused" as const, attempts: 1 } }, pendingHuman: { nodeId: "review", question: "?", askedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:01:00.000Z", fallback } });
    const failed = new MemoryStore(); failed.state = expired(); expect((await materializeHumanExpiry(failed, new Date("2020-01-02")))?.status).toBe("failed");
    const resumed = new MemoryStore(); resumed.state = expired("continue"); const value = await materializeHumanExpiry(resumed, new Date("2020-01-02"));
    expect(value?.status).toBe("running"); expect(value?.nodes.review?.output).toEqual({ expired: true, fallback: "continue" });
  });
  test("cancel is a finite built-in terminal outcome", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [{ id: "stop", type: "cancel", reason: "user requested", depends_on: [], inputs: {} }] });
    const result = await runWorkflow({ workflow, store: new MemoryStore(), executors: {} }); expect(result.status).toBe("cancelled"); expect(result.nodes.stop?.output).toEqual({ reason: "user requested" });
  });
  test("resolves typed outputs in inputs, command args, and structured predicates", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, outcome: { type: "none" }, nodes: [
      { id: "producer", type: "command", command: ["produce"], depends_on: [], inputs: {} },
      { id: "consumer", type: "command", command: ["consume", "${{ nodes.producer.outputs.name }}", "${{ inputs.suffix }}"], depends_on: ["producer"], inputs: { count: "${{ nodes.producer.outputs.count }}", initial: "${{ inputs.count }}" }, when: { equals: ["${{ nodes.producer.outputs.enabled }}", true] } },
    ] });
    const seen: unknown[] = []; const result = await runWorkflow({ workflow, store: new MemoryStore(), inputs: { suffix: "tail", count: 1 }, executors: { command: async (node) => { if (node.id === "producer") return { name: "item", count: 2, enabled: true }; seen.push(node); return {}; } } });
    expect(result.status).toBe("done"); expect(seen[0]).toMatchObject({ command: ["consume", "item", "tail"], inputs: { count: 2, initial: 1 } });
  });
  test("timeout fails even when an executor ignores AbortSignal", async () => {
    const workflow = WorkflowDefinitionSchema.parse({ ...base, defaults: { provider: "claude", timeout: 20 }, outcome: { type: "none" }, nodes: [{ id: "hang", type: "command", command: ["hang"], depends_on: [], inputs: {} }] });
    const result = await runWorkflow({ workflow, store: new MemoryStore(), executors: { command: async () => await new Promise(() => {}) } }); expect(result.status).toBe("failed"); expect(result.nodes.hang?.error).toContain("timed out");
  });
});
