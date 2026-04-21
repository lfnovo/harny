import { rm } from "node:fs/promises";
import { removeWorktree } from "./git.js";
import { worktreePathFor, planDir } from "./plan.js";
import { spawn } from "node:child_process";

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
    proc.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function deleteLocalBranch(cwd: string, branch: string): Promise<void> {
  const { code, stderr } = await runGit(cwd, ["branch", "-D", branch]);
  if (code === 0) return;
  const msg = stderr.trim();
  if (msg.includes("not found") || msg.includes("no branch named")) return;
  throw new Error(`git branch -D ${branch} failed (exit ${code}): ${msg}`);
}

export async function cleanRun(
  primaryCwd: string,
  slug: string,
  verbose: boolean,
): Promise<void> {
  const worktreePath = worktreePathFor(primaryCwd, slug);
  const stateDir = planDir(primaryCwd, slug);
  const branch = `harness/${slug}`;

  if (verbose) console.log(`[clean] removing worktree: ${worktreePath}`);
  await removeWorktree(primaryCwd, worktreePath, { force: true });

  if (verbose) console.log(`[clean] deleting branch: ${branch}`);
  await deleteLocalBranch(primaryCwd, branch);

  if (verbose) console.log(`[clean] removing state dir: ${stateDir}`);
  await rm(stateDir, { recursive: true, force: true });
}
