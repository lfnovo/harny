import {
  addWorktree,
  assertBranchAbsent,
  assertCleanTree,
  assertHasInitialCommit,
  assertIsGitRepo,
  assertWorktreePathAbsent,
  createBranch,
  removeWorktree,
} from "./git.js";

/**
 * DI seam for git operations consumed by the orchestrator. Interface is scoped
 * to what orchestrator.ts needs — methods only used elsewhere (stageAndCommit,
 * headSha) stay as free functions in ./git.js. Keeping the interface small
 * keeps the test mock small and intent obvious.
 */
export interface GitOps {
  assertIsGitRepo(cwd: string): Promise<void>;
  assertHasInitialCommit(cwd: string): Promise<void>;
  assertCleanTree(cwd: string): Promise<void>;
  assertBranchAbsent(cwd: string, branch: string): Promise<void>;
  assertWorktreePathAbsent(worktreePath: string): Promise<void>;
  createBranch(cwd: string, branch: string): Promise<void>;
  addWorktree(primaryCwd: string, worktreePath: string, branch: string): Promise<void>;
  removeWorktree(
    primaryCwd: string,
    worktreePath: string,
    opts?: { force?: boolean },
  ): Promise<void>;
}

export const realGitOps: GitOps = {
  assertIsGitRepo,
  assertHasInitialCommit,
  assertCleanTree,
  assertBranchAbsent,
  assertWorktreePathAbsent,
  createBranch,
  addWorktree,
  removeWorktree,
};
