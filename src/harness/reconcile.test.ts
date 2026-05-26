import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { reconcileStaleRun } from "./reconcile.js";
import { setRegistryDirForTesting } from "./state/registry.js";
import type { State } from "./state/schema.js";

async function getDeadPid(): Promise<number> {
  const child = spawn("true", [], { shell: false });
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.on("close", resolve));
  await new Promise<void>((r) => setTimeout(r, 50));
  return pid;
}

describe("reconcileStaleRun (L3, filesystem-backed)", () => {
  let tmpCwd: string;
  let tmpRegistry: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "harny-reconcile-cwd-"));
    tmpRegistry = mkdtempSync(join(tmpdir(), "harny-reconcile-reg-"));
    setRegistryDirForTesting(tmpRegistry);
  });

  afterEach(() => {
    setRegistryDirForTesting(null);
    rmSync(tmpCwd, { recursive: true, force: true });
    rmSync(tmpRegistry, { recursive: true, force: true });
  });

  function writeState(opts: { pid: number; status?: string }): {
    state: State;
    statePath: string;
  } {
    const runId = "11112222-3333-4444-5555-666677778888";
    const slug = "reconcile-run";
    const stateDir = join(tmpCwd, ".harny", slug);
    mkdirSync(stateDir, { recursive: true });
    const status = opts.status ?? "running";
    const state = {
      schema_version: 2,
      run_id: runId,
      origin: {
        prompt: "test",
        workflow: "feature-dev",
        task_slug: slug,
        started_at: "2026-01-01T00:00:00.000Z",
        host: "h",
        user: "u",
        features: null,
      },
      environment: {
        cwd: tmpCwd,
        branch: "harny/reconcile-run",
        isolation: "worktree",
        worktree_path: null,
        mode: "silent",
      },
      lifecycle: {
        status,
        current_phase: status === "running" ? "developer" : null,
        ended_at: status === "running" ? null : "2026-01-01T00:05:00.000Z",
        ended_reason: status === "running" ? null : status,
        pid: opts.pid,
      },
      phases: [],
      history: [],
      pending_question: null,
      workflow_state: {},
      workflow_chosen: null,
    } as unknown as State;
    const statePath = join(stateDir, "state.json");
    writeFileSync(statePath, JSON.stringify(state));
    writeFileSync(
      join(tmpRegistry, `${runId}.json`),
      JSON.stringify({
        schema_version: 1,
        run_id: runId,
        cwd: tmpCwd,
        task_slug: slug,
        workflow: "feature-dev",
        started_at: "2026-01-01T00:00:00.000Z",
        status,
        ended_at: null,
      }),
    );
    return { state, statePath };
  }

  test("running + dead pid → persisted as failed with process_died_untrapped", async () => {
    const deadPid = await getDeadPid();
    const { state, statePath } = writeState({ pid: deadPid });

    const result = await reconcileStaleRun(state);

    expect(result.lifecycle.status).toBe("failed");
    expect(result.lifecycle.ended_reason).toBe("process_died_untrapped");
    const onDisk = JSON.parse(readFileSync(statePath, "utf8"));
    expect(onDisk.lifecycle.status).toBe("failed");
    expect(onDisk.lifecycle.ended_reason).toBe("process_died_untrapped");
    // The cross-run pointer is synced too.
    const ptr = JSON.parse(
      readFileSync(join(tmpRegistry, `${state.run_id}.json`), "utf8"),
    );
    expect(ptr.status).toBe("failed");
  });

  test("running + alive pid → untouched (no write)", async () => {
    const { state, statePath } = writeState({ pid: process.pid });

    const result = await reconcileStaleRun(state);

    expect(result.lifecycle.status).toBe("running");
    expect(JSON.parse(readFileSync(statePath, "utf8")).lifecycle.status).toBe("running");
  });

  test("already terminal (done) + dead pid → not clobbered", async () => {
    const deadPid = await getDeadPid();
    const { state, statePath } = writeState({ pid: deadPid, status: "done" });

    const result = await reconcileStaleRun(state);

    expect(result.lifecycle.status).toBe("done");
    expect(JSON.parse(readFileSync(statePath, "utf8")).lifecycle.status).toBe("done");
  });
});
