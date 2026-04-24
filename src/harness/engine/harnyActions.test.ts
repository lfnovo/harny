import { describe, test, expect } from "bun:test";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  gitCommit,
  gitResetTree,
  gitCleanUntracked,
} from "./harnyActions.js";
import { tmpGitRepo } from "../testing/index.js";

async function spawn(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  return (await new Response(proc.stdout!).text()).trim();
}

const signal = new AbortController().signal;

describe("gitCommit", () => {
  test("commits staged changes and returns HEAD sha", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      writeFileSync(join(repo.path, "file.txt"), "hi\n");
      await spawn(["add", "file.txt"], repo.path);
      const result = await gitCommit(
        { cwd: repo.path, message: "add file" },
        signal,
      );
      const head = await spawn(["rev-parse", "HEAD"], repo.path);
      expect(result.sha).toBe(head);
    } finally {
      await repo.cleanup();
    }
  });

  test("returns null sha when there are no changes to commit", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const result = await gitCommit(
        { cwd: repo.path, message: "nothing" },
        signal,
      );
      expect(result.sha).toBeNull();
    } finally {
      await repo.cleanup();
    }
  });

  test("auto-stages untracked files via `add -A` before committing", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      writeFileSync(join(repo.path, "untracked.txt"), "auto-staged\n");
      await gitCommit(
        { cwd: repo.path, message: "auto stage" },
        signal,
      );
      const show = await spawn(
        ["show", "--name-only", "--format=%H", "HEAD"],
        repo.path,
      );
      expect(show).toContain("untracked.txt");
    } finally {
      await repo.cleanup();
    }
  });

  test("returns null sha when nothing is staged and no untracked files exist", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const result = await gitCommit(
        { cwd: repo.path, message: "empty" },
        signal,
      );
      expect(result.sha).toBeNull();
    } finally {
      await repo.cleanup();
    }
  });
});

describe("gitResetTree", () => {
  test("rolls HEAD back to the provided sha", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const pre = await spawn(["rev-parse", "HEAD"], repo.path);
      writeFileSync(join(repo.path, "extra.txt"), "extra\n");
      await spawn(["add", "extra.txt"], repo.path);
      await spawn(["commit", "-m", "extra commit"], repo.path);
      await gitResetTree({ cwd: repo.path, sha: pre }, signal);
      const head = await spawn(["rev-parse", "HEAD"], repo.path);
      expect(head).toBe(pre);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("gitCleanUntracked", () => {
  test("removes untracked files (clean -fd)", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const junk = join(repo.path, "junk.txt");
      writeFileSync(junk, "\n");
      await gitCleanUntracked({ cwd: repo.path }, signal);
      expect(existsSync(junk)).toBe(false);
    } finally {
      await repo.cleanup();
    }
  });
});
