import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a disposable Git repository; cleanup is idempotent. */
export async function tmpGitRepo(opts?: {
  seed?: { name?: string; email?: string; initialCommit?: boolean };
}): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "harny-test-"));
  const run = async (args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { cwd: path, stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${path} (exit ${proc.exitCode})`);
  };
  await run(["init"]);
  if (opts?.seed) {
    await run(["config", "user.email", opts.seed.email ?? "test@harny.local"]);
    await run(["config", "user.name", opts.seed.name ?? "harny test"]);
    if (opts.seed.initialCommit !== false) await run(["commit", "--allow-empty", "-m", "seed"]);
  }
  let cleaned = false;
  return { path, cleanup: async () => { if (cleaned) return; cleaned = true; await rm(path, { recursive: true, force: true }); } };
}
