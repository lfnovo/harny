import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanRun } from "./clean.js";
import { tmpGitRepo } from "./testing/index.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop()!;
    await c().catch(() => {});
  }
});

async function spawn(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

describe("cleanRun: happy path", () => {
  test("removes .harny/<slug>/ state dir and deletes the harny/<slug> branch", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    cleanups.push(repo.cleanup);
    const slug = "my-slug";

    const stateDir = join(repo.path, ".harny", slug);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "state.json"),
      JSON.stringify({
        lifecycle: { status: "done", pid: 1 },
      }),
    );
    writeFileSync(join(stateDir, "plan.json"), "{}");

    // Create the branch so cleanRun has something to delete. Check it out then
    // back to the seed branch so `branch -D` won't refuse to delete the
    // currently-checked-out branch.
    await spawn(["checkout", "-b", `harny/${slug}`], repo.path);
    await spawn(["checkout", "-"], repo.path);

    expect(existsSync(stateDir)).toBe(true);

    await cleanRun(repo.path, slug, false, {});

    expect(existsSync(stateDir)).toBe(false);

    // Verify branch is gone: `git show-ref --verify` returns non-zero for
    // absent refs.
    const verify = Bun.spawn(
      ["git", "show-ref", "--verify", `refs/heads/harny/${slug}`],
      { cwd: repo.path, stdout: "ignore", stderr: "ignore" },
    );
    await verify.exited;
    expect(verify.exitCode).not.toBe(0);
  });
});

describe("cleanRun: active-run protection", () => {
  test("refuses to clean when status=running and pid is alive, without --force", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    cleanups.push(repo.cleanup);
    const slug = "active-slug";

    const stateDir = join(repo.path, ".harny", slug);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "state.json"),
      JSON.stringify({
        lifecycle: { status: "running", pid: process.pid },
      }),
    );

    await expect(cleanRun(repo.path, slug, false, {})).rejects.toThrow(
      /refusing to clean/,
    );

    // State dir should be intact — refusal short-circuits before any removal.
    expect(existsSync(stateDir)).toBe(true);
  });
});
