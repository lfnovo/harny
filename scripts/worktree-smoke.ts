/**
 * End-to-end smoke test for worktree isolation primitives.
 *
 * Tests:
 *  1. Git worktree primitives (add, assert-absent, remove, idempotent remove)
 *  2. Sequential runs: create worktree A, commit inside, remove, create worktree
 *     B on same path — no conflict
 *  3. Concurrent runs: two worktrees on different paths from the same primary
 *     repo simultaneously — no collision
 *
 * Does NOT exercise the full SDK-driven phase loop (that needs model calls).
 * It DOES exercise everything in the orchestrator's lifecycle scaffolding
 * that can fail independently of the agent.
 */

import { mkdtemp, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  addWorktree,
  assertWorktreePathAbsent,
  commitComposed,
  removeWorktree,
} from "../src/harness/git.js";

function runCmd(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(`${cmd} ${args.join(" ")} -> exit ${code}: ${stderr}`)),
    );
  });
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "harness-wt-smoke-"));
  await runCmd("git", ["init", "-b", "main"], dir);
  await runCmd("git", ["config", "user.email", "smoke@test"], dir);
  await runCmd("git", ["config", "user.name", "smoke"], dir);
  await writeFile(join(dir, "seed.txt"), "seed\n", "utf8");
  await runCmd("git", ["add", "-A"], dir);
  await runCmd("git", ["commit", "-m", "seed"], dir);
  return dir;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function test1_primitives() {
  console.log("--- test 1: primitives ---");
  const repo = await initRepo();
  const wtPath = join(repo, ".harness", "worktrees", "t1");

  await assertWorktreePathAbsent(wtPath);
  console.log("  assertWorktreePathAbsent: pass on absent path");

  await addWorktree(repo, wtPath, "harness/t1");
  if (!(await pathExists(wtPath))) throw new Error("worktree path not created");
  console.log("  addWorktree: created");

  // Verify branch exists
  const branches = await runCmd("git", ["branch", "--list", "harness/t1"], repo);
  if (!branches.includes("harness/t1")) throw new Error("branch not created");
  console.log("  addWorktree: branch harness/t1 exists");

  // Commit inside the worktree
  await writeFile(join(wtPath, "hello.txt"), "hi\n", "utf8");
  const sha = await commitComposed(wtPath, "chore: hello");
  if (!sha) throw new Error("commitComposed returned null on real change");
  console.log(`  commitComposed in worktree: sha=${sha.slice(0, 8)}`);

  // Verify commit is on the branch in the primary
  const log = await runCmd("git", ["log", "harness/t1", "--oneline"], repo);
  if (!log.includes("hello")) throw new Error("commit not visible on branch");
  console.log("  commit visible on branch from primary");

  // Verify primary's working tree is untouched (still just seed.txt)
  const primaryFiles = await runCmd("ls", [repo], repo);
  // .harness/ and seed.txt should be there. Critical: no hello.txt in primary.
  if (primaryFiles.includes("hello.txt")) {
    throw new Error("primary has hello.txt — worktree leaked into primary");
  }
  console.log("  primary tree untouched");

  await removeWorktree(repo, wtPath, { force: true });
  if (await pathExists(wtPath)) throw new Error("worktree path not removed");
  console.log("  removeWorktree: path cleaned");

  // Branch should still exist after worktree removal
  const branchesAfter = await runCmd(
    "git",
    ["branch", "--list", "harness/t1"],
    repo,
  );
  if (!branchesAfter.includes("harness/t1"))
    throw new Error("branch gone after worktree removal");
  console.log("  branch preserved after removal");

  // Idempotent remove
  await removeWorktree(repo, wtPath, { force: true });
  console.log("  removeWorktree on absent path: silent no-op");

  await rm(repo, { recursive: true, force: true });
  console.log("  test 1: PASS");
}

async function test2_sequential() {
  console.log("--- test 2: sequential worktrees ---");
  const repo = await initRepo();
  const wtPath = join(repo, ".harness", "worktrees", "t2");

  // Run A
  await addWorktree(repo, wtPath, "harness/t2-a");
  await writeFile(join(wtPath, "a.txt"), "a\n", "utf8");
  const shaA = await commitComposed(wtPath, "chore: a");
  await removeWorktree(repo, wtPath, { force: true });
  console.log(`  run A: committed ${shaA!.slice(0, 8)}, worktree removed`);

  // Run B on same worktree path (different branch)
  await assertWorktreePathAbsent(wtPath);
  await addWorktree(repo, wtPath, "harness/t2-b");
  await writeFile(join(wtPath, "b.txt"), "b\n", "utf8");
  const shaB = await commitComposed(wtPath, "chore: b");
  await removeWorktree(repo, wtPath, { force: true });
  console.log(`  run B: committed ${shaB!.slice(0, 8)}, worktree removed`);

  // Verify each branch has its own commit
  const logA = await runCmd("git", ["log", "harness/t2-a", "--oneline"], repo);
  const logB = await runCmd("git", ["log", "harness/t2-b", "--oneline"], repo);
  if (!logA.includes("chore: a")) throw new Error("t2-a missing its commit");
  if (!logB.includes("chore: b")) throw new Error("t2-b missing its commit");
  if (logA.includes("chore: b") || logB.includes("chore: a")) {
    throw new Error("branch commits leaked across runs");
  }
  console.log("  branches isolated, no leakage");

  await rm(repo, { recursive: true, force: true });
  console.log("  test 2: PASS");
}

async function test3_concurrent() {
  console.log("--- test 3: concurrent worktrees ---");
  const repo = await initRepo();
  const wtA = join(repo, ".harness", "worktrees", "t3-a");
  const wtB = join(repo, ".harness", "worktrees", "t3-b");

  // Run both worktree creations + commits in parallel
  const [resultA, resultB] = await Promise.allSettled([
    (async () => {
      await addWorktree(repo, wtA, "harness/t3-a");
      await writeFile(join(wtA, "a.txt"), "a\n", "utf8");
      const sha = await commitComposed(wtA, "chore: concurrent a");
      return sha;
    })(),
    (async () => {
      await addWorktree(repo, wtB, "harness/t3-b");
      await writeFile(join(wtB, "b.txt"), "b\n", "utf8");
      const sha = await commitComposed(wtB, "chore: concurrent b");
      return sha;
    })(),
  ]);

  if (resultA.status !== "fulfilled")
    throw new Error(`run A failed: ${resultA.reason}`);
  if (resultB.status !== "fulfilled")
    throw new Error(`run B failed: ${resultB.reason}`);

  console.log(`  run A: ${(resultA.value as string).slice(0, 8)}`);
  console.log(`  run B: ${(resultB.value as string).slice(0, 8)}`);

  // Both branches present, each with its own commit
  const logA = await runCmd("git", ["log", "harness/t3-a", "--oneline"], repo);
  const logB = await runCmd("git", ["log", "harness/t3-b", "--oneline"], repo);
  if (!logA.includes("concurrent a"))
    throw new Error("t3-a missing its commit");
  if (!logB.includes("concurrent b"))
    throw new Error("t3-b missing its commit");
  if (logA.includes("concurrent b") || logB.includes("concurrent a")) {
    throw new Error("concurrent commits leaked");
  }
  console.log("  concurrent branches isolated");

  await removeWorktree(repo, wtA, { force: true });
  await removeWorktree(repo, wtB, { force: true });

  await rm(repo, { recursive: true, force: true });
  console.log("  test 3: PASS");
}

async function main() {
  try {
    await test1_primitives();
    await test2_sequential();
    await test3_concurrent();
    console.log("\nALL SMOKE TESTS PASSED");
  } catch (err) {
    console.error("\nSMOKE TEST FAILED:", err);
    process.exit(1);
  }
}

main();
