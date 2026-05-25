import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { isPidAlive } from "./pid.js";
import { handleLs } from "../runner/ls.js";
import { handleShow } from "../runner/show.js";
import { setRegistryDirForTesting } from "./state/registry.js";

// --- L1: isPidAlive unit tests ---

describe("isPidAlive", () => {
  test("returns true for the current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("returns false for a freshly-exited child process (ESRCH path)", async () => {
    const child = spawn("true", [], { shell: false });
    const deadPid = child.pid!;
    await new Promise<void>((resolve) => child.on("close", resolve));
    // Brief wait for the OS to fully reap the process
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(isPidAlive(deadPid)).toBe(false);
  });
});

// --- helpers shared by L3 tests ---

function captureConsole(): { restore: () => void; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

async function getDeadPid(): Promise<number> {
  const child = spawn("true", [], { shell: false });
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.on("close", resolve));
  await new Promise<void>((r) => setTimeout(r, 50));
  return pid;
}

// --- L3: stale-display integration tests ---

describe("stale running display", () => {
  let tmpCwd: string;
  let tmpRegistry: string;

  beforeEach(() => {
    tmpCwd = mkdtempSync(join(tmpdir(), "harny-pid-test-cwd-"));
    tmpRegistry = mkdtempSync(join(tmpdir(), "harny-pid-test-reg-"));
    setRegistryDirForTesting(tmpRegistry);
  });

  afterEach(() => {
    setRegistryDirForTesting(null);
    rmSync(tmpCwd, { recursive: true, force: true });
    rmSync(tmpRegistry, { recursive: true, force: true });
  });

  function writeSyntheticState(deadPid: number): { runId: string } {
    const runId = "aaaabbbb-cccc-dddd-1111-222233334444";
    const slug = "test-stale-run";
    const stateDir = join(tmpCwd, ".harny", slug);
    mkdirSync(stateDir, { recursive: true });

    const state = {
      schema_version: 2,
      run_id: runId,
      origin: {
        prompt: "test prompt",
        workflow: "feature-dev",
        task_slug: slug,
        started_at: "2026-01-01T00:00:00.000Z",
        host: "testhost",
        user: "testuser",
        features: null,
      },
      environment: {
        cwd: tmpCwd,
        branch: "harny/test-stale-run",
        isolation: "worktree",
        worktree_path: null,
        mode: "silent",
      },
      lifecycle: {
        status: "running",
        current_phase: "developer",
        ended_at: null,
        ended_reason: null,
        pid: deadPid,
      },
      phases: [],
      history: [],
      pending_question: null,
      workflow_state: {},
      workflow_chosen: null,
    };

    writeFileSync(join(stateDir, "state.json"), JSON.stringify(state));

    const pointer = {
      schema_version: 1,
      run_id: runId,
      cwd: tmpCwd,
      task_slug: slug,
      workflow: "feature-dev",
      started_at: "2026-01-01T00:00:00.000Z",
      status: "running",
      ended_at: null,
    };

    writeFileSync(join(tmpRegistry, `${runId}.json`), JSON.stringify(pointer));

    return { runId };
  }

  test("handleLs shows 'running (stale)' for a run with a dead pid", async () => {
    const deadPid = await getDeadPid();
    writeSyntheticState(deadPid);

    const cap = captureConsole();
    try {
      await handleLs({ kind: "ls" });
    } finally {
      cap.restore();
    }

    expect(cap.logs.join("\n")).toContain("running (stale)");
  });

  test("handleLs --status running still lists stale runs", async () => {
    const deadPid = await getDeadPid();
    writeSyntheticState(deadPid);

    const cap = captureConsole();
    try {
      await handleLs({ kind: "ls", status: "running" });
    } finally {
      cap.restore();
    }

    const output = cap.logs.join("\n");
    expect(output).not.toContain("No runs found");
    expect(output).toContain("running (stale)");
  });

  test("handleShow shows 'Status:    running (stale)' for a run with a dead pid", async () => {
    const deadPid = await getDeadPid();
    const { runId } = writeSyntheticState(deadPid);

    const cap = captureConsole();
    try {
      await handleShow({ kind: "show", runId });
    } finally {
      cap.restore();
    }

    expect(cap.logs.join("\n")).toContain("Status:    running (stale)");
  });
});
