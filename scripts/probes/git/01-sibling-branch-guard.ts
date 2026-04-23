/**
 * Probe: sibling-branch guard — 3 scenarios, 1500ms per scenario, under 6s total.
 *
 * RUN
 *   bun scripts/probes/git/01-sibling-branch-guard.ts
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertNoSiblingBranchOwnsTouchedPaths } from "../../../src/harness/git.ts";

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms),
  );
}

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  return (await new Response(proc.stdout).text()).trim();
}

async function makeMultibranchRepo(): Promise<{ repoPath: string; mainBranch: string }> {
  const repoPath = mkdtempSync(join(tmpdir(), "harny-sibling-"));
  const g = (...args: string[]) => git(args, repoPath);
  await g("init");
  await g("config", "user.email", "test@harny.local");
  await g("config", "user.name", "Harny Test");
  writeFileSync(join(repoPath, "README.md"), "# test\n");
  await g("add", ".");
  await g("commit", "-m", "initial");
  const mainBranch = await g("branch", "--show-current");
  await g("checkout", "-b", "harny/foo");
  writeFileSync(join(repoPath, "shared.ts"), "// shared\n");
  await g("add", ".");
  await g("commit", "-m", "add shared.ts");
  await g("checkout", mainBranch);
  return { repoPath, mainBranch };
}

const startMs = Date.now();
let failures = 0;

// Scenario 1: detects-overlap
{
  const name = "detects-overlap";
  const { repoPath } = await makeMultibranchRepo();
  try {
    const g = (...args: string[]) => git(args, repoPath);
    await g("checkout", "-b", "harny/bar");
    writeFileSync(join(repoPath, "shared.ts"), "// modified by bar\n");
    await g("add", ".");
    await g("commit", "-m", "bar touches shared");
    const { warnings } = await Promise.race([
      assertNoSiblingBranchOwnsTouchedPaths(repoPath, "harny/bar", ["shared.ts"]),
      timeout(1500),
    ]);
    if (warnings.length === 1 && warnings[0].siblingBranch === "harny/foo") {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected 1 warning for harny/foo, got ${JSON.stringify(warnings)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  } finally {
    rmSync(repoPath, { recursive: true });
  }
}

// Scenario 2: no-overlap
{
  const name = "no-overlap";
  const { repoPath } = await makeMultibranchRepo();
  try {
    const g = (...args: string[]) => git(args, repoPath);
    await g("checkout", "-b", "harny/baz");
    writeFileSync(join(repoPath, "unique.ts"), "// unique\n");
    await g("add", ".");
    await g("commit", "-m", "add unique");
    const { warnings } = await Promise.race([
      assertNoSiblingBranchOwnsTouchedPaths(repoPath, "harny/baz", ["unique.ts"]),
      timeout(1500),
    ]);
    if (warnings.length === 0) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected 0 warnings, got ${JSON.stringify(warnings)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  } finally {
    rmSync(repoPath, { recursive: true });
  }
}

// Scenario 3: ignores-non-harny-branches
{
  const name = "ignores-non-harny-branches";
  const { repoPath, mainBranch } = await makeMultibranchRepo();
  try {
    const g = (...args: string[]) => git(args, repoPath);
    await g("checkout", "-b", "feature/random");
    writeFileSync(join(repoPath, "shared.ts"), "// modified by feature/random\n");
    await g("add", ".");
    await g("commit", "-m", "feature touches shared");
    await g("checkout", mainBranch);
    await g("checkout", "-b", "harny/qux");
    const { warnings } = await Promise.race([
      assertNoSiblingBranchOwnsTouchedPaths(repoPath, "harny/qux", ["shared.ts"]),
      timeout(1500),
    ]);
    const hasFeature = warnings.some(w => w.siblingBranch === "feature/random");
    if (!hasFeature) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: feature/random should not be in warnings, got ${JSON.stringify(warnings)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  } finally {
    rmSync(repoPath, { recursive: true });
  }
}

const elapsedMs = Date.now() - startMs;
console.log(`total elapsed: ${elapsedMs}ms`);
if (elapsedMs > 6000) {
  console.log("FAIL: total elapsed exceeded 6000ms");
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
