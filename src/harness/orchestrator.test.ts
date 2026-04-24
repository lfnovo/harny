import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runHarness } from "./orchestrator.js";
import { tmpGitRepo } from "./testing/index.js";
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
