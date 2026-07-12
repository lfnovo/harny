import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitHubCompareUrl, printRunSummary } from "./summary.js";
import type { State } from "../harness/state/schema.js";

function captureConsole(): { restore: () => void; lines: string[] } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  return { lines, restore: () => { console.log = orig; } };
}

function makeState(overrides: Partial<State["lifecycle"]> = {}): State {
  return {
    schema_version: 2,
    run_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    origin: {
      prompt: "test prompt",
      workflow: "feature-dev",
      task_slug: "my-task-slug",
      started_at: "2024-01-01T00:00:00.000Z",
      host: "test-host",
      user: "test-user",
      features: null,
    },
    environment: {
      cwd: "/tmp/test",
      branch: "harny/my-task-slug",
      isolation: "worktree",
      worktree_path: null,
      mode: "silent",
    },
    lifecycle: {
      status: "done",
      current_phase: null,
      ended_at: "2024-01-01T00:05:30.000Z",
      ended_reason: "done",
      pid: 12345,
      ...overrides,
    },
    phases: [
      {
        name: "planner",
        attempt: 1,
        started_at: "2024-01-01T00:00:00.000Z",
        ended_at: "2024-01-01T00:02:00.000Z",
        status: "completed",
        verdict: null,
        session_id: null,
      },
      {
        name: "developer",
        attempt: 1,
        started_at: "2024-01-01T00:02:00.000Z",
        ended_at: "2024-01-01T00:05:30.000Z",
        status: "completed",
        verdict: null,
        session_id: null,
      },
    ],
    history: [],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
}

describe("parseGitHubCompareUrl", () => {
  test("HTTPS GitHub URL returns correct compare URL", () => {
    const url = parseGitHubCompareUrl(
      "https://github.com/owner/repo.git",
      "harny/my-feature",
    );
    expect(url).toBe("https://github.com/owner/repo/compare/harny/my-feature");
  });

  test("SSH GitHub URL returns correct compare URL", () => {
    const url = parseGitHubCompareUrl(
      "git@github.com:owner/repo.git",
      "harny/my-feature",
    );
    expect(url).toBe("https://github.com/owner/repo/compare/harny/my-feature");
  });

  test("non-GitHub URL returns null", () => {
    const url = parseGitHubCompareUrl(
      "https://gitlab.com/owner/repo.git",
      "harny/my-feature",
    );
    expect(url).toBeNull();
  });

  test("null origin URL returns null", () => {
    const url = parseGitHubCompareUrl(null, "harny/my-feature");
    expect(url).toBeNull();
  });
});

describe("printRunSummary", () => {
  // Use a temp dir that is not a git repo so resolveOriginUrl returns null.
  let tmpDir: string;

  test("done status: output contains workflow, slug, branch, harny show, git checkout", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "harny-summary-test-"));
    const state = makeState({ status: "done", ended_reason: "done" });
    const cap = captureConsole();
    try {
      await printRunSummary({ status: "done", branch: "harny/my-task-slug", state }, tmpDir);
    } finally {
      cap.restore();
      rmSync(tmpDir, { recursive: true, force: true });
    }

    const output = cap.lines.join("\n");
    expect(output).toContain("feature-dev");
    expect(output).toContain("my-task-slug");
    expect(output).toContain("harny/my-task-slug");
    expect(output).toContain("harny show my-task-slug");
    expect(output).toContain("git checkout harny/my-task-slug");
  });

  test("failed status: output contains harny show but NOT git checkout", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "harny-summary-test-"));
    const state = makeState({
      status: "failed",
      ended_reason: "developer-blocked",
      ended_at: "2024-01-01T00:03:00.000Z",
    });
    const cap = captureConsole();
    try {
      await printRunSummary({ status: "failed", branch: "harny/my-task-slug", state }, tmpDir);
    } finally {
      cap.restore();
      rmSync(tmpDir, { recursive: true, force: true });
    }

    const output = cap.lines.join("\n");
    expect(output).toContain("harny show my-task-slug");
    expect(output).not.toContain("git checkout");
  });
});
