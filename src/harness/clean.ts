import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { removeWorktree } from "./git.js";
import { worktreePathFor, runDir } from "./state/paths.js";
import { deletePointer, listPointers, registryDir, type RunPointer } from "./state/registry.js";
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

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM means the process exists but we can't signal it
    if (code === "EPERM") return true;
    return false;
  }
}

async function sendSignalToGroup(pid: number, signal: NodeJS.Signals): Promise<void> {
  try {
    process.kill(-pid, signal);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      // Process group doesn't exist (no separate pgid); fall back to direct pid
      try {
        process.kill(pid, signal);
      } catch (err2: unknown) {
        if ((err2 as NodeJS.ErrnoException).code !== "ESRCH") throw err2;
      }
    } else {
      throw err;
    }
  }
}

async function waitForDeath(pid: number, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await new Promise<void>((r) => setTimeout(r, 250));
  }
  return !isPidAlive(pid);
}

export type CleanOptions = { force?: boolean; kill?: boolean };

export async function cleanRun(
  primaryCwd: string,
  slug: string,
  verbose: boolean,
  options: CleanOptions = {},
): Promise<void> {
  const { force = false, kill = false } = options;
  const worktreePath = worktreePathFor(primaryCwd, slug);
  const stateDir = runDir(primaryCwd, slug);
  const branch = `harny/${slug}`;
  const runPath = join(stateDir, "run.json");

  let stateRaw: string | null = null;
  try {
    stateRaw = await readFile(runPath, "utf8");
  } catch { /* no readable run state */ }

  if (stateRaw !== null) {
    let state: { run?: { pid?: number }; execution?: { status?: string }; workspace?: { branch?: string; worktree_path?: string | null } } = {};
    try {
      state = JSON.parse(stateRaw) as typeof state;
    } catch {
      // malformed run.json — proceed with cleanup
    }

    const status = state.execution?.status;
    const pid = state.run?.pid;

    if (status === "running" && typeof pid === "number" && pid > 0) {
      if (!isPidAlive(pid)) {
        console.warn(
          `[clean] warning: stale pid ${pid} in run.json (process no longer alive); proceeding`,
        );
      } else if (!force) {
        throw new Error(
          `refusing to clean: run ${slug} is active (pid ${pid}). Use --force to terminate and clean.`,
        );
      } else {
        if (verbose) console.log(`[clean] sending SIGTERM to pid ${pid}`);
        await sendSignalToGroup(pid, "SIGTERM");
        const dead = await waitForDeath(pid, 5000);
        if (!dead) {
          if (kill) {
            if (verbose)
              console.log(`[clean] process still alive after SIGTERM, escalating to SIGKILL`);
            await sendSignalToGroup(pid, "SIGKILL");
            await waitForDeath(pid, 2000);
          } else if (verbose) {
            console.log(`[clean] process did not exit within 5s; continuing cleanup`);
          }
        }
      }
    }
  }

  if (verbose) console.log(`[clean] removing worktree: ${worktreePath}`);
  await removeWorktree(primaryCwd, worktreePath, { force: true });

  if (verbose) console.log(`[clean] deleting branch: ${branch}`);
  await deleteLocalBranch(primaryCwd, branch);

  if (verbose) console.log(`[clean] removing state dir: ${stateDir}`);
  await rm(stateDir, { recursive: true, force: true });

  // Best-effort: drop the matching pointer from the cross-project registry.
  // Multiple pointers may reference this slug if the same run was attempted
  // in different cwds; only delete those pointing at this cwd.
  try {
    const pointers: RunPointer[] = await listPointers();
    for (const p of pointers) {
      if (p.cwd === primaryCwd && p.task_slug === slug) {
        await deletePointer(p.run_id);
        if (verbose) console.log(`[clean] removed pointer: ${p.run_id}`);
      }
    }
  } catch {
    // pointer registry is an index; failure to clean here is non-fatal
  }
}

/**
 * Prune pointers in `~/.harny/runs/` whose underlying run.json is
 * unreachable (project deleted, run dir removed manually). Returns the count
 * removed.
 */
export async function pruneRegistry(verbose: boolean): Promise<number> {
  if (!existsSync(registryDir())) return 0;
  const pointers = await listPointers();
  let removed = 0;
  for (const p of pointers) {
    const sourcePath = join(p.cwd, ".harny", p.task_slug, "run.json");
    if (!existsSync(sourcePath)) {
      await deletePointer(p.run_id);
      removed++;
      if (verbose) console.log(`[clean] pruned unreachable pointer: ${p.run_id} (${p.cwd})`);
    }
  }
  return removed;
}
