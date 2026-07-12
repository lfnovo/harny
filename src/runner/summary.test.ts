import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
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

function makeMinimalPlan(tasks: Array<{ id: string; status: string }>): object {
  return {
    task_slug: "test-task",
    user_prompt: "test prompt",
    branch: "harny/test-task",
    primary_cwd: "/tmp/test",
    isolation: "worktree",
    worktree_path: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    status: "done",
    summary: "test summary",
    iterations_global: 0,
    tasks: tasks.map(t => ({
      id: t.id,
      title: `Task ${t.id}`,
      description: `Description for ${t.id}`,
      acceptance: [],
      status: t.status,
      attempts: 1,
      commit_sha: null,
      history: [],
    })),
    metadata: {},
  };
}

describe("parseGitHubCompareUrl", () => {
  test("HTTPS GitHub URL returns correct compare URL", () => {
    const url = parseGitHubCompareUrl(
      "https://github.com/owner/repo.git",
      "harny/my-feature",
      "main",
    );
    expect(url).toBe("https://github.com/owner/repo/compare/main...harny/my-feature?expand=1");
  });

  test("SSH GitHub URL returns correct compare URL", () => {
    const url = parseGitHubCompareUrl(
      "git@github.com:owner/repo.git",
      "harny/my-feature",
      "main",
    );
    expect(url).toBe("https://github.com/owner/repo/compare/main...harny/my-feature?expand=1");
  });

  test("non-GitHub URL returns null", () => {
    const url = parseGitHubCompareUrl(
      "https://gitlab.com/owner/repo.git",
      "harny/my-feature",
      "main",
    );
    expect(url).toBeNull();
  });

  test("null origin URL returns null", () => {
    const url = parseGitHubCompareUrl(null, "harny/my-feature", "main");
    expect(url).toBeNull();
  });

  test("HTTPS GitHub URL with master base branch returns correct compare URL", () => {
    const url = parseGitHubCompareUrl(
      "https://github.com/owner/repo.git",
      "harny/my-feature",
      "master",
    );
    expect(url).toBe("https://github.com/owner/repo/compare/master...harny/my-feature?expand=1");
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

  test("done status: output contains tasks line when valid planPath provided", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "harny-summary-test-"));
    const planPath = join(tmpDir, "plan.json");
    const plan = makeMinimalPlan([
      { id: "task-1", status: "done" },
      { id: "task-2", status: "done" },
      { id: "task-3", status: "pending" },
    ]);
    writeFileSync(planPath, JSON.stringify(plan));

    const state = makeState({ status: "done", ended_reason: "done" });
    const cap = captureConsole();
    try {
      await printRunSummary(
        { status: "done", branch: "harny/my-task-slug", state, planPath },
        tmpDir,
      );
    } finally {
      cap.restore();
      rmSync(tmpDir, { recursive: true, force: true });
    }

    const output = cap.lines.join("\n");
    expect(output).toContain("tasks:     2/3 done");
  });

  test("done status: output contains commit line when cwd is a real git repo with a commit", async () => {
    const gitDir = mkdtempSync(join(tmpdir(), "harny-summary-git-"));
    try {
      execSync("git init", { cwd: gitDir, stdio: "pipe" });
      execSync("git config user.email 'test@test.com'", { cwd: gitDir, stdio: "pipe" });
      execSync("git config user.name 'Test User'", { cwd: gitDir, stdio: "pipe" });
      writeFileSync(join(gitDir, "test.txt"), "hello\n");
      execSync("git add test.txt", { cwd: gitDir, stdio: "pipe" });
      execSync("git commit -m 'initial commit'", { cwd: gitDir, stdio: "pipe" });

      const branchName = execSync("git rev-parse --abbrev-ref HEAD", { cwd: gitDir })
        .toString()
        .trim();

      const state = makeState({ status: "done", ended_reason: "done" });
      const cap = captureConsole();
      try {
        await printRunSummary(
          { status: "done", branch: branchName, state },
          gitDir,
        );
      } finally {
        cap.restore();
      }

      const output = cap.lines.join("\n");
      expect(output).toContain("commit:");
      // Ensure a non-empty SHA appears after "commit:"
      const commitLine = cap.lines.find(l => l.startsWith("commit:"));
      expect(commitLine).toBeDefined();
      expect(commitLine!.replace("commit:", "").trim().length).toBeGreaterThan(0);
    } finally {
      rmSync(gitDir, { recursive: true, force: true });
    }
  });

  test("done status with non-git dir: does not throw and summary block appears", async () => {
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
    expect(output).toContain("status:");
    expect(output).toContain("branch:");
    expect(output).not.toContain("commit:");
  });
});
