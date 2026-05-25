import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runHarness, applyTerminalState, installExitHandlers } from "./orchestrator.js";
import { tmpGitRepo } from "./testing/index.js";
import { MockStateStore } from "./testing/mockStateStore.js";
import type { State } from "./state/schema.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop()!;
    await c().catch(() => {});
  }
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
  test("dead pid (status=running) → throws 'crashed mid-execution'", async () => {
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
    await expect(
      runHarness({
        cwd: repo.path,
        userPrompt: "x",
        taskSlug,
        mode: "silent",
        logMode: "quiet",
      }),
    ).rejects.toThrow(/crashed mid-execution/);
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

  test("status=waiting_human → throws 'don\\'t yet support resume' (RFC #20)", async () => {
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
    ).rejects.toThrow(/don't yet support resume/);
  });
});

function minimalRunningState(): State {
  return {
    schema_version: 2,
    run_id: "test-run-id",
    origin: {
      prompt: "p",
      workflow: "feature-dev",
      task_slug: "t",
      started_at: "2026-01-01T00:00:00.000Z",
      host: "h",
      user: "u",
      features: null,
    },
    environment: {
      cwd: "/tmp",
      branch: "main",
      isolation: "inline",
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
    history: [],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
}

// --- L2: applyTerminalState ---

describe("applyTerminalState (L2)", () => {
  test("status=running → store ends up status=failed with ended_reason set", async () => {
    const store = new MockStateStore(minimalRunningState());
    await applyTerminalState(store, "SIGTERM");
    expect(store.state!.lifecycle.status).toBe("failed");
    expect(store.state!.lifecycle.ended_reason).toBe("SIGTERM");
    expect(store.state!.lifecycle.ended_at).not.toBeNull();
  });

  test("idempotent: second call after status=failed does not mutate store", async () => {
    const store = new MockStateStore(minimalRunningState());
    await applyTerminalState(store, "SIGTERM");
    const callsBefore = store.calls.length;
    await applyTerminalState(store, "SIGTERM");
    // getState is called again but updateLifecycle should not be called again
    const updateCalls = store.calls.filter((c) => c.op === "updateLifecycle");
    expect(updateCalls).toHaveLength(1);
    // total calls grew by exactly 1 (only getState, no updateLifecycle)
    expect(store.calls.length).toBe(callsBefore + 1);
  });

  test("status=done → store is unchanged (no clobber)", async () => {
    const store = new MockStateStore({
      ...minimalRunningState(),
      lifecycle: {
        status: "done",
        current_phase: null,
        ended_at: "2026-01-01T00:01:00.000Z",
        ended_reason: "done",
        pid: process.pid,
      },
    });
    const callsBefore = store.calls.length;
    await applyTerminalState(store, "SIGTERM");
    const updateCalls = store.calls.filter((c) => c.op === "updateLifecycle");
    expect(updateCalls).toHaveLength(0);
    // only getState was called
    expect(store.calls.length).toBe(callsBefore + 1);
    expect(store.state!.lifecycle.status).toBe("done");
  });
});

// --- L2: installExitHandlers listener cleanup ---

describe("installExitHandlers listener cleanup (L2)", () => {
  test("removeHandlers() restores SIGINT and SIGTERM listener counts", () => {
    const store = new MockStateStore(minimalRunningState());
    const beforeSigint = process.listenerCount("SIGINT");
    const beforeSigterm = process.listenerCount("SIGTERM");

    const remove = installExitHandlers(store);
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint + 1);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm + 1);

    remove();
    expect(process.listenerCount("SIGINT")).toBe(beforeSigint);
    expect(process.listenerCount("SIGTERM")).toBe(beforeSigterm);
  });
});

// --- L3: subprocess SIGTERM ---

describe("exit handler: L3 subprocess SIGTERM", () => {
  test("SIGTERM → state.json ends up status=failed, ended_reason=SIGTERM", async () => {
    const repo = await prepRepo();
    const taskSlug = `sigterm-test-${Date.now()}`;
    const statePath = join(repo.path, ".harny", taskSlug, "state.json");
    const fixtureScript = `${import.meta.dir}/testing/fixtures/sigterm-fixture.ts`;

    const child = Bun.spawn(
      ["bun", fixtureScript, repo.path, taskSlug],
      { stdout: "pipe", stderr: "pipe" },
    );

    // Poll until state.json appears with status=running
    const deadline = Date.now() + 15_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const raw = readFileSync(statePath, "utf8");
        const st = JSON.parse(raw) as { lifecycle: { status: string } };
        if (st.lifecycle.status === "running") { ready = true; break; }
      } catch { /* not yet */ }
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    if (!ready) {
      child.kill();
      await child.exited;
      throw new Error("state.json did not reach status=running within 15s");
    }

    child.kill();
    await child.exited;

    const raw = readFileSync(statePath, "utf8");
    const st = JSON.parse(raw) as State;
    expect(st.lifecycle.status).toBe("failed");
    expect(st.lifecycle.ended_reason).toBe("SIGTERM");
    expect(st.lifecycle.ended_at).not.toBeNull();
  }, 20_000);
});
