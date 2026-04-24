import { describe, test, expect } from "bun:test";
import { MockGitOps } from "./mockGitOps.js";

describe("MockGitOps: call recording", () => {
  test("records each op with its args", async () => {
    const g = new MockGitOps();
    await g.assertIsGitRepo("/repo");
    await g.assertBranchAbsent("/repo", "harny/x");
    await g.addWorktree("/repo", "/repo/.harny/worktrees/x", "harny/x");
    expect(g.calls).toEqual([
      { op: "assertIsGitRepo", cwd: "/repo" },
      { op: "assertBranchAbsent", cwd: "/repo", branch: "harny/x" },
      {
        op: "addWorktree",
        primaryCwd: "/repo",
        worktreePath: "/repo/.harny/worktrees/x",
        branch: "harny/x",
      },
    ]);
  });

  test("callNames gives op sequence", async () => {
    const g = new MockGitOps();
    await g.assertIsGitRepo("/r");
    await g.assertHasInitialCommit("/r");
    await g.createBranch("/r", "harny/s");
    expect(g.callNames()).toEqual([
      "assertIsGitRepo",
      "assertHasInitialCommit",
      "createBranch",
    ]);
  });
});

describe("MockGitOps: configured throws", () => {
  test("per-op throws fire the configured Error after recording", async () => {
    const err = new Error("branch already exists");
    const g = new MockGitOps({ throws: { assertBranchAbsent: err } });
    await g.assertIsGitRepo("/r");
    await expect(g.assertBranchAbsent("/r", "harny/x")).rejects.toThrow(
      "branch already exists",
    );
    // Still records the throwing call so tests can assert it was invoked.
    expect(g.callNames()).toEqual(["assertIsGitRepo", "assertBranchAbsent"]);
  });

  test("other ops remain unaffected", async () => {
    const g = new MockGitOps({
      throws: { assertCleanTree: new Error("dirty tree") },
    });
    await g.assertIsGitRepo("/r");
    await g.createBranch("/r", "b");
    await expect(g.assertCleanTree("/r")).rejects.toThrow("dirty tree");
  });
});
