import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runHarness } from "./orchestrator.js";
import { tmpGitRepo } from "./testing/index.js";
import type { State } from "./state/schema.js";
import type { AgentProvider, AgentRequest, AgentResult } from "./providers/types.js";
import { setRegistryDirForTesting } from "./state/registry.js";
import { handleAnswer } from "../runner/answer.js";
import { FilesystemRunStoreV3 } from "./state/v3/store.js";
import { MockGitOps } from "./testing/mockGitOps.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  setRegistryDirForTesting(null);
  while (cleanups.length > 0) {
    const c = cleanups.pop()!;
    await c().catch(() => {});
  }
});

class OrchestratorProvider implements AgentProvider {
  id = "claude"; capabilities = { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true };
  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    let output: unknown;
    if (request.phase === "planner") output = { summary: "test", tasks: [{ id: "t1", title: "Build", description: "Build", acceptance: ["works"] }] };
    else if (request.phase === "developer") { writeFileSync(join(request.cwd, "built.txt"), "done\n"); output = { task_id: "t1", status: "done", summary: "done", commit_message: "feat: build" }; }
    else if (request.phase === "writer") output = { message: "written" };
    else output = { verdict: "pass", reasons: ["verified"] };
    return { output: request.schema.parse(output), session: { id: `${request.phase}-session`, provider: this.id } };
  }
}

test("default runtime completes feature-dev with authoritative v3 state", async () => {
  const repo = await prepRepo();
  const result = await runHarness({ cwd: repo.path, userPrompt: "build", taskSlug: "next-default", isolation: "inline", mode: "silent", logMode: "quiet", agentProvider: new OrchestratorProvider() });
  expect(result.status).toBe("done"); expect(result.state?.schema_version).toBe(3); expect(statSync(join(repo.path, ".harny/next-default/run.json")).isFile()).toBe(true);
  expect(() => statSync(join(repo.path, ".harny/next-default/state.json"))).toThrow();
});

test("async human node parks in v3 and harny answer resumes the same run", async () => {
  const repo = await prepRepo(); const registry = join(repo.path, "registry"); setRegistryDirForTesting(registry); mkdirSync(join(repo.path, ".harny/workflows"), { recursive: true });
  writeFileSync(join(repo.path, ".harny/workflows/feature-dev.yaml"), `version: 1\nname: feature-dev\ndefaults: { provider: claude, timeout: 60000 }\nworkspace: { isolation: inline }\noutcome: { type: branch }\nnodes:\n  - { id: planner, type: agent, command: planner, requires: [structured_output] }\n  - { id: persist_plan, type: command, command: [persist_plan], depends_on: [planner] }\n  - id: tasks\n    type: foreach\n    items: "\${{ nodes.planner.outputs.tasks }}"\n    as: task\n    max_items: 5\n    depends_on: [persist_plan]\n    steps:\n      - { id: developer, type: agent, command: developer, requires: [structured_output, tool_guards], guards: [no_git_history] }\n      - { id: validator, type: agent, command: validator, depends_on: [developer], requires: [structured_output, tool_guards], guards: [read_only] }\n      - { id: commit, type: commit, message: done, changeset: developer, depends_on: [validator] }\n  - { id: approval, type: human, question: "Approve?", timeout: 60000, depends_on: [tasks] }\n`);
  for (const args of [["add", ".harny/workflows/feature-dev.yaml"], ["commit", "-m", "test workflow"]]) { const proc = Bun.spawn(["git", ...args], { cwd: repo.path, stdout: "ignore", stderr: "ignore" }); expect(await proc.exited).toBe(0); }
  const parked = await runHarness({ cwd: repo.path, userPrompt: "build", taskSlug: "human", isolation: "inline", mode: "async", logMode: "quiet", agentProvider: new OrchestratorProvider() });
  expect(parked.status).toBe("waiting_human"); expect(parked.state?.schema_version === 3 ? parked.state.pending_human?.question : null).toBe("Approve?");
  await handleAnswer({ kind: "answer", runId: parked.state!.schema_version === 3 ? parked.state!.run.id : "", text: "yes" });
  const final = await new FilesystemRunStoreV3(repo.path, "human").load(); expect(final?.run.status).toBe("done"); expect(final?.pending_human).toBeNull();
});

test("expired human fallback resumes without asking for an answer", async () => {
  const repo = await prepRepo(); setRegistryDirForTesting(join(repo.path, "registry")); const path = join(repo.path, "fallback.yaml");
  writeFileSync(path, `version: 1\nname: fallback\ndefaults: { provider: claude }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: approval, type: human, question: "Approve?", timeout: 1, fallback: continue }\n  - { id: finish, type: command, command: [touch, fallback-finished.txt], depends_on: [approval] }\n`);
  for (const args of [["add", "fallback.yaml"], ["commit", "-m", "fallback workflow"]]) { const proc = Bun.spawn(["git", ...args], { cwd: repo.path, stdout: "ignore", stderr: "ignore" }); expect(await proc.exited).toBe(0); }
  const parked = await runHarness({ cwd: repo.path, userPrompt: "fallback", workflowId: path, taskSlug: "fallback", isolation: "inline", mode: "async", logMode: "quiet" }); expect(parked.status).toBe("waiting_human");
  await new Promise((resolve) => setTimeout(resolve, 5)); const id = parked.state?.schema_version === 3 ? parked.state.run.id : ""; await handleAnswer({ kind: "answer", runId: id });
  const final = await new FilesystemRunStoreV3(repo.path, "fallback").load(); expect(final?.run.status).toBe("done"); expect(existsSync(join(repo.path, "fallback-finished.txt"))).toBe(true);
});

test("explicit command-only YAML executes through the generic declarative runner", async () => {
  const repo = await prepRepo(); const path = join(repo.path, "custom.yaml"); writeFileSync(path, `version: 1\nname: custom\ndefaults: { provider: claude, timeout: 60000 }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: create, type: command, command: [touch, custom-output.txt] }\n`);
  const add = Bun.spawn(["git", "add", "custom.yaml"], { cwd: repo.path, stdout: "ignore", stderr: "ignore" }); expect(await add.exited).toBe(0); const commit = Bun.spawn(["git", "commit", "-m", "custom workflow"], { cwd: repo.path, stdout: "ignore", stderr: "ignore" }); expect(await commit.exited).toBe(0);
  const result = await runHarness({ cwd: repo.path, userPrompt: "run", taskSlug: "custom", workflowId: path, isolation: "inline", mode: "silent", logMode: "quiet" });
  expect(result.status).toBe("done"); expect(statSync(join(repo.path, "custom-output.txt")).isFile()).toBe(true); expect(result.state?.schema_version).toBe(3);
});

test("worktree isolation is honored even when the workflow has no branch outcome", async () => {
  const repo = await prepRepo(); const path = join(repo.path, "isolated.yaml"); writeFileSync(path, `version: 1\nname: isolated\ndefaults: { provider: claude }\nworkspace: { isolation: worktree }\noutcome: { type: none }\nnodes:\n  - { id: check, type: command, command: ["true"] }\n`);
  for (const args of [["add", "isolated.yaml"], ["commit", "-m", "isolated workflow"]]) { const proc = Bun.spawn(["git", ...args], { cwd: repo.path, stdout: "ignore", stderr: "ignore" }); expect(await proc.exited).toBe(0); }
  const result = await runHarness({ cwd: repo.path, userPrompt: "isolate", workflowId: path, taskSlug: "isolated", mode: "silent", logMode: "quiet" });
  const state = result.state?.schema_version === 3 ? result.state : null; expect(result.status).toBe("done"); expect(state?.workspace.isolation).toBe("worktree"); expect(state?.workspace.worktree_path).not.toBeNull(); expect(existsSync(state!.workspace.worktree_path!)).toBe(false);
});

test("generic YAML agent resolves a Markdown command and validates structured output", async () => {
  const repo = await prepRepo(); mkdirSync(join(repo.path, ".harny/workflows"), { recursive: true }); mkdirSync(join(repo.path, ".harny/commands"), { recursive: true });
  writeFileSync(join(repo.path, ".harny/commands/write.md"), "Return a structured message."); writeFileSync(join(repo.path, ".harny/workflows/custom-agent.yaml"), `version: 1\nname: custom-agent\ndefaults: { provider: claude, timeout: 60000 }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - id: writer\n    type: agent\n    command: write\n    requires: [structured_output]\n    output_schema:\n      type: object\n      required: [message]\n`);
  for (const args of [["add", ".harny"], ["commit", "-m", "agent workflow"]]) { const proc = Bun.spawn(["git", ...args], { cwd: repo.path, stdout: "ignore", stderr: "ignore" }); expect(await proc.exited).toBe(0); }
  const result = await runHarness({ cwd: repo.path, userPrompt: "write", taskSlug: "agent", workflowId: "custom-agent", isolation: "inline", mode: "silent", logMode: "quiet", agentProvider: new OrchestratorProvider() });
  expect(result.status).toBe("done"); const state = result.state?.schema_version === 3 ? result.state : null; const snapshot = state?.artifacts["runtime-snapshot"]?.value as { nodes?: Record<string, { output?: { message?: string } }> }; expect(snapshot.nodes?.writer?.output?.message).toBe("written");
});

test("mixed-provider YAML routes each agent node to its declared provider", async () => {
  const repo = await prepRepo(); const path = join(repo.path, "mixed.yaml");
  writeFileSync(path, `version: 1\nname: mixed\ndefaults: { provider: claude, timeout: 60000 }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: plan, type: agent, command: plan, provider: claude, requires: [structured_output] }\n  - { id: build, type: agent, command: build, provider: codex, requires: [structured_output], depends_on: [plan] }\n`);
  for (const args of [["add", "mixed.yaml"], ["commit", "-m", "mixed workflow"]]) { const proc = Bun.spawn(["git", ...args], { cwd: repo.path, stdout: "ignore", stderr: "ignore" }); expect(await proc.exited).toBe(0); }
  const calls: string[] = [];
  const fake = (id: string): AgentProvider => ({ id, capabilities: { structuredOutput: true, resume: true, toolGuards: id === "claude", interactiveQuestions: true }, async run(request) { calls.push(`${id}:${request.phase}`); return { output: request.schema.parse({ provider: id }), session: { id: `${id}-session`, provider: id } }; } });
  const result = await runHarness({ cwd: repo.path, userPrompt: "mixed", workflowId: path, taskSlug: "mixed", isolation: "inline", mode: "silent", logMode: "quiet", agentProviders: [fake("claude"), fake("codex")] });
  expect(result.status).toBe("done"); expect(calls).toEqual(["claude:plan", "codex:build"]);
});

test("provider capability mismatch fails before any Git workspace effect", async () => {
  const repo = await prepRepo(); const path = join(repo.path, "unsafe.yaml"); writeFileSync(path, `version: 1\nname: unsafe\ndefaults: { provider: codex }\nworkspace: { isolation: worktree }\noutcome: { type: none }\nnodes:\n  - { id: agent, type: agent, command: work, requires: [structured_output, tool_guards] }\n`); const git = new MockGitOps();
  await expect(runHarness({ cwd: repo.path, userPrompt: "x", workflowId: path, taskSlug: "unsafe", gitOps: git })).rejects.toThrow("unsupported capability tool_guards"); expect(git.calls).toHaveLength(0);
});

async function prepRepo() {
  const repo = await tmpGitRepo({ seed: {} });
  cleanups.push(repo.cleanup);
  return repo;
}

const NOW = "2026-01-01T00:00:00.000Z";

function stateJson(taskSlug: string, cwd: string, patch: Partial<State>): string {
  const base: State = {
    schema_version: 2,
    run_id: "00000000-0000-0000-0000-000000000000",
    origin: {
      prompt: "prior",
      workflow: "feature-dev",
      task_slug: taskSlug,
      started_at: NOW,
      host: "h",
      user: "u",
      features: null,
    },
    environment: {
      cwd,
      branch: `harny/${taskSlug}`,
      isolation: "worktree",
      worktree_path: null,
      mode: "silent",
    },
    lifecycle: {
      status: "running",
      current_phase: null,
      ended_at: null,
      ended_reason: null,
      pid: process.pid,
    },
    phases: [],
    history: [{ at: NOW, phase: "harness", event: "run_started" }],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
  const merged: State = {
    ...base,
    ...patch,
    lifecycle: { ...base.lifecycle, ...(patch.lifecycle ?? {}) },
  };
  return JSON.stringify(merged);
}

function writeStateJson(cwd: string, taskSlug: string, body: string) {
  const dir = join(cwd, ".harny", taskSlug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), body);
  return join(dir, "state.json");
}

describe("runHarness: existing-state guards", () => {
  test("dead pid (status=running) → materializes a terminal failure", async () => {
    const repo = await prepRepo();
    const taskSlug = "dead-pid";
    writeStateJson(
      repo.path,
      taskSlug,
      stateJson(taskSlug, repo.path, {
        lifecycle: {
          status: "running",
          current_phase: null,
          ended_at: null,
          ended_reason: null,
          pid: 99999999,
        },
      }),
    );
    const result = await runHarness({
        cwd: repo.path,
        userPrompt: "x",
        taskSlug,
        mode: "silent",
        logMode: "quiet",
      });
    expect(result.status).toBe("failed");
    expect(result.state?.schema_version === 2 ? result.state.lifecycle.ended_reason : null).toContain("process exited unexpectedly");
  });

  test("live pid (status=running) → throws 'appears to still be running'", async () => {
    const repo = await prepRepo();
    const taskSlug = "live-pid";
    writeStateJson(
      repo.path,
      taskSlug,
      stateJson(taskSlug, repo.path, {
        lifecycle: {
          status: "running",
          current_phase: null,
          ended_at: null,
          ended_reason: null,
          pid: process.pid,
        },
      }),
    );
    await expect(
      runHarness({
        cwd: repo.path,
        userPrompt: "x",
        taskSlug,
        mode: "silent",
        logMode: "quiet",
      }),
    ).rejects.toThrow(/appears to still be running/);
  });

  test("status=done → short-circuits and returns existing outcome without mutating state.json", async () => {
    const repo = await prepRepo();
    const taskSlug = "already-done";
    const statePath = writeStateJson(
      repo.path,
      taskSlug,
      stateJson(taskSlug, repo.path, {
        lifecycle: {
          status: "done",
          current_phase: null,
          ended_at: NOW,
          ended_reason: "completed",
          pid: 1,
        },
      }),
    );
    const mtimeBefore = statSync(statePath).mtimeMs;

    const result = await runHarness({
      cwd: repo.path,
      userPrompt: "x",
      taskSlug,
      mode: "silent",
      logMode: "quiet",
    });

    expect(result.status).toBe("done");
    expect(result.branch).toBe(`harny/${taskSlug}`);
    expect(statSync(statePath).mtimeMs).toBe(mtimeBefore);
  });

  test("status=failed → short-circuits and returns existing outcome", async () => {
    const repo = await prepRepo();
    const taskSlug = "already-failed";
    writeStateJson(
      repo.path,
      taskSlug,
      stateJson(taskSlug, repo.path, {
        lifecycle: {
          status: "failed",
          current_phase: null,
          ended_at: NOW,
          ended_reason: "validator-exhausted",
          pid: 1,
        },
      }),
    );
    const result = await runHarness({
      cwd: repo.path,
      userPrompt: "x",
      taskSlug,
      mode: "silent",
      logMode: "quiet",
    });
    expect(result.status).toBe("failed");
  });

  test("historical v2 status=waiting_human is explicitly non-resumable", async () => {
    const repo = await prepRepo();
    const taskSlug = "parked";
    writeStateJson(
      repo.path,
      taskSlug,
      stateJson(taskSlug, repo.path, {
        lifecycle: {
          status: "waiting_human",
          current_phase: null,
          ended_at: null,
          ended_reason: null,
          pid: 1,
        },
      }),
    );
    await expect(
      runHarness({
        cwd: repo.path,
        userPrompt: "x",
        taskSlug,
        mode: "silent",
        logMode: "quiet",
      }),
    ).rejects.toThrow(/historical state v2 and cannot be resumed/);
  });
});
