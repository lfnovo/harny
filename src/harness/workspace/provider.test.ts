import { expect, test } from "bun:test";
import { LocalWorkspaceProvider } from "./provider.js";
import { MockGitOps } from "../testing/mockGitOps.js";

test("local workspace provider preserves failed worktrees and removes successful ones", async () => {
  const git = new MockGitOps(); const provider = new LocalWorkspaceProvider(git, async () => {});
  const workspace = await provider.prepare({ primaryCwd: "/repo", taskSlug: "task", isolation: "worktree", needsBranch: true, startPoint: "pr-head-sha" });
  expect(git.callNames()).toEqual(["assertBranchAbsent", "assertWorktreePathAbsent", "addWorktree"]);
  expect(git.calls.find((call) => call.op === "addWorktree")).toMatchObject({ startPoint: "pr-head-sha" });
  await provider.release(workspace, "failed"); expect(git.callNames()).not.toContain("removeWorktree");
  await provider.release(workspace, "done"); expect(git.callNames().at(-1)).toBe("removeWorktree");
});
