import type { GitOps } from "../gitOps.js";

export type GitCall =
  | { op: "assertIsGitRepo"; cwd: string }
  | { op: "assertHasInitialCommit"; cwd: string }
  | { op: "assertCleanTree"; cwd: string }
  | { op: "assertBranchAbsent"; cwd: string; branch: string }
  | { op: "assertWorktreePathAbsent"; worktreePath: string }
  | { op: "createBranch"; cwd: string; branch: string }
  | {
      op: "addWorktree";
      primaryCwd: string;
      worktreePath: string;
      branch: string;
    }
  | {
      op: "removeWorktree";
      primaryCwd: string;
      worktreePath: string;
      opts: { force?: boolean } | undefined;
    };

export type MockGitOpsConfig = {
  /** If an op is present, the mock throws the configured Error on that call. */
  throws?: Partial<Record<GitCall["op"], Error>>;
};

/**
 * In-memory GitOps for L2 tests of orchestrator.ts. Records every call on
 * calls[] for sequence assertions. Configure per-op throws to exercise
 * orchestrator error paths without touching a real repo.
 */
export class MockGitOps implements GitOps {
  readonly calls: GitCall[] = [];

  constructor(private config: MockGitOpsConfig = {}) {}

  async assertIsGitRepo(cwd: string): Promise<void> {
    this.record({ op: "assertIsGitRepo", cwd });
  }

  async assertHasInitialCommit(cwd: string): Promise<void> {
    this.record({ op: "assertHasInitialCommit", cwd });
  }

  async assertCleanTree(cwd: string): Promise<void> {
    this.record({ op: "assertCleanTree", cwd });
  }

  async assertBranchAbsent(cwd: string, branch: string): Promise<void> {
    this.record({ op: "assertBranchAbsent", cwd, branch });
  }

  async assertWorktreePathAbsent(worktreePath: string): Promise<void> {
    this.record({ op: "assertWorktreePathAbsent", worktreePath });
  }

  async createBranch(cwd: string, branch: string): Promise<void> {
    this.record({ op: "createBranch", cwd, branch });
  }

  async addWorktree(
    primaryCwd: string,
    worktreePath: string,
    branch: string,
  ): Promise<void> {
    this.record({ op: "addWorktree", primaryCwd, worktreePath, branch });
  }

  async removeWorktree(
    primaryCwd: string,
    worktreePath: string,
    opts?: { force?: boolean },
  ): Promise<void> {
    this.record({ op: "removeWorktree", primaryCwd, worktreePath, opts });
  }

  /** Op names in call order. Common assertion shape: expect sequence of ops. */
  callNames(): GitCall["op"][] {
    return this.calls.map((c) => c.op);
  }

  private record(call: GitCall): void {
    this.calls.push(call);
    const err = this.config.throws?.[call.op];
    if (err) throw err;
  }
}
