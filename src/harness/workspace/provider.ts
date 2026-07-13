import { coldInstallWorktree } from "../coldInstall.js";
import type { GitOps } from "../gitOps.js";
import { worktreePathFor } from "../state/plan.js";
import type { IsolationMode } from "../types.js";

export interface Workspace {
  primaryCwd: string;
  cwd: string;
  isolation: IsolationMode;
  branch: string;
  worktreePath: string | null;
}

export interface WorkspaceProvider {
  prepare(request: { primaryCwd: string; taskSlug: string; isolation: IsolationMode; needsBranch: boolean }): Promise<Workspace>;
  release(workspace: Workspace, outcome: "done" | "failed" | "exhausted" | "waiting_human"): Promise<void>;
}

/** Local-first Git branch/worktree implementation. */
export class LocalWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly git: GitOps, private readonly install = coldInstallWorktree) {}

  async prepare(request: { primaryCwd: string; taskSlug: string; isolation: IsolationMode; needsBranch: boolean }): Promise<Workspace> {
    const branch = request.needsBranch ? `harny/${request.taskSlug}` : "";
    if (!request.needsBranch) {
      await this.git.assertCleanTree(request.primaryCwd);
      return { primaryCwd: request.primaryCwd, cwd: request.primaryCwd, isolation: request.isolation, branch, worktreePath: null };
    }
    await this.git.assertBranchAbsent(request.primaryCwd, branch);
    if (request.isolation === "worktree") {
      const worktreePath = worktreePathFor(request.primaryCwd, request.taskSlug);
      await this.git.assertWorktreePathAbsent(worktreePath);
      await this.git.addWorktree(request.primaryCwd, worktreePath, branch);
      await this.install({ worktreePath, primaryCwd: request.primaryCwd });
      return { primaryCwd: request.primaryCwd, cwd: worktreePath, isolation: request.isolation, branch, worktreePath };
    }
    await this.git.assertCleanTree(request.primaryCwd); await this.git.createBranch(request.primaryCwd, branch);
    return { primaryCwd: request.primaryCwd, cwd: request.primaryCwd, isolation: request.isolation, branch, worktreePath: null };
  }

  async release(workspace: Workspace, outcome: "done" | "failed" | "exhausted" | "waiting_human"): Promise<void> {
    if (workspace.worktreePath && outcome === "done") await this.git.removeWorktree(workspace.primaryCwd, workspace.worktreePath, { force: true });
  }
}
