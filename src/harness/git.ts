import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      resolve({ code: code ?? 0, stdout, stderr }),
    );
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await runGit(cwd, args);
  if (code !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${code}): ${stderr.trim() || stdout.trim()}`,
    );
  }
  return stdout;
}

export async function assertIsGitRepo(cwd: string): Promise<void> {
  const { code } = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (code !== 0) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
}

export async function assertCleanTree(cwd: string): Promise<void> {
  const { stdout } = await runGit(cwd, ["status", "--porcelain"]);
  if (stdout.trim().length > 0) {
    throw new Error(
      `Working tree is not clean in ${cwd}. Commit or stash changes before starting the harness.`,
    );
  }
}

export async function assertBranchAbsent(
  cwd: string,
  branch: string,
): Promise<void> {
  const { code } = await runGit(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  if (code === 0) {
    throw new Error(
      `Branch "${branch}" already exists in ${cwd}. Pick a different --task slug or delete the branch.`,
    );
  }
}

export async function createBranch(cwd: string, branch: string): Promise<void> {
  await git(cwd, ["checkout", "-b", branch]);
}

export async function stageAndCommit(
  cwd: string,
  message: string,
): Promise<string | null> {
  // Stage everything under the harness dir and all tracked changes.
  await git(cwd, ["add", "-A"]);
  const { stdout } = await runGit(cwd, ["diff", "--cached", "--name-only"]);
  if (stdout.trim().length === 0) return null;
  await git(cwd, ["commit", "-m", message]);
  const sha = await git(cwd, ["rev-parse", "HEAD"]);
  return sha.trim();
}

export async function headSha(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

export async function resetHard(cwd: string, sha: string): Promise<void> {
  await git(cwd, ["reset", "--hard", sha]);
}

export async function cleanUntracked(cwd: string): Promise<void> {
  // -f to actually delete, -d to include directories. Does NOT touch
  // ignored files (.gitignore'd) so .harny/<slug>/ and its contents
  // survive the clean.
  await git(cwd, ["clean", "-fd"]);
}

export async function commitComposed(
  cwd: string,
  message: string,
): Promise<string | null> {
  await git(cwd, ["add", "-A"]);
  const { stdout } = await runGit(cwd, ["diff", "--cached", "--name-only"]);
  if (stdout.trim().length === 0) return null;
  await git(cwd, ["commit", "-m", message]);
  return (await git(cwd, ["rev-parse", "HEAD"])).trim();
}

export async function assertWorktreePathAbsent(
  worktreePath: string,
): Promise<void> {
  try {
    await stat(worktreePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  throw new Error(
    `Worktree path already exists: ${worktreePath}. Clean it up or pick a different task slug.`,
  );
}

export async function addWorktree(
  primaryCwd: string,
  worktreePath: string,
  branch: string,
): Promise<void> {
  await git(primaryCwd, ["worktree", "add", "-b", branch, worktreePath]);
}

export async function removeWorktree(
  primaryCwd: string,
  worktreePath: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const args = ["worktree", "remove"];
  if (opts.force) args.push("--force");
  args.push(worktreePath);
  try {
    await git(primaryCwd, args);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (
      msg.includes("is not a working tree") ||
      msg.includes("No such file or directory")
    ) {
      return;
    }
    throw err;
  }
}
