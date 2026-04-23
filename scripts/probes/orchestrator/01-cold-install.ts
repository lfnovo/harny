/**
 * Probe: cold-install — 3 scenarios, 8000ms per scenario, under 25s total.
 *
 * RUN
 *   bun scripts/probes/orchestrator/01-cold-install.ts
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { coldInstallWorktree } from "../../../src/harness/coldInstall.ts";

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms),
  );
}

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} failed (exit ${code}): ${err.trim()}`);
  }
}

async function makeRepo(opts?: {
  harnyJson?: Record<string, unknown>;
}): Promise<{ primaryCwd: string; worktreePath: string }> {
  const tmpBase = mkdtempSync(join(tmpdir(), "harny-ci-"));
  const primaryCwd = join(tmpBase, "primary");
  const worktreePath = join(tmpBase, "worktree");
  mkdirSync(primaryCwd, { recursive: true });

  const g = (...args: string[]) => git(args, primaryCwd);
  await g("init");
  await g("config", "user.email", "test@harny.local");
  await g("config", "user.name", "Harny Test");

  writeFileSync(
    join(primaryCwd, "package.json"),
    JSON.stringify({ name: "test", dependencies: { ms: "2.1.3" } }, null, 2) + "\n",
  );

  await g("add", ".");
  await g("commit", "-m", "initial");

  if (opts?.harnyJson) {
    writeFileSync(
      join(primaryCwd, "harny.json"),
      JSON.stringify(opts.harnyJson, null, 2) + "\n",
    );
  }

  await g("worktree", "add", "-b", "test-branch", worktreePath);

  return { primaryCwd, worktreePath };
}

const startMs = Date.now();
let failures = 0;

// Scenario (a): installs-when-missing
{
  const name = "installs-when-missing";
  let tmpBase = "";
  try {
    const { primaryCwd, worktreePath } = await makeRepo();
    tmpBase = join(primaryCwd, "..");

    if (existsSync(join(worktreePath, "node_modules"))) {
      console.log(`FAIL ${name}: node_modules already exists before install`);
      failures++;
    } else {
      await Promise.race([
        coldInstallWorktree({ worktreePath, primaryCwd }),
        timeout(8000),
      ]);
      if (existsSync(join(worktreePath, "node_modules"))) {
        console.log(`PASS ${name}`);
      } else {
        console.log(`FAIL ${name}: node_modules not created after install`);
        failures++;
      }
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  } finally {
    if (tmpBase) rmSync(tmpBase, { recursive: true, force: true });
  }
}

// Scenario (b): skips-when-present
{
  const name = "skips-when-present";
  let tmpBase = "";
  try {
    const { primaryCwd, worktreePath } = await makeRepo();
    tmpBase = join(primaryCwd, "..");

    mkdirSync(join(worktreePath, "node_modules"), { recursive: true });
    writeFileSync(join(worktreePath, "node_modules", ".sentinel"), "skip-marker");

    await Promise.race([
      coldInstallWorktree({ worktreePath, primaryCwd }),
      timeout(8000),
    ]);

    if (existsSync(join(worktreePath, "node_modules", ".sentinel"))) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: sentinel removed — bun install ran unexpectedly`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  } finally {
    if (tmpBase) rmSync(tmpBase, { recursive: true, force: true });
  }
}

// Scenario (c): skips-when-toggle-off
{
  const name = "skips-when-toggle-off";
  let tmpBase = "";
  try {
    const { primaryCwd, worktreePath } = await makeRepo({
      harnyJson: { coldWorktreeInstall: false },
    });
    tmpBase = join(primaryCwd, "..");

    await Promise.race([
      coldInstallWorktree({ worktreePath, primaryCwd }),
      timeout(8000),
    ]);

    if (!existsSync(join(worktreePath, "node_modules"))) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: node_modules created despite coldWorktreeInstall=false`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  } finally {
    if (tmpBase) rmSync(tmpBase, { recursive: true, force: true });
  }
}

const elapsedMs = Date.now() - startMs;
console.log(`total elapsed: ${elapsedMs}ms`);
if (elapsedMs > 25000) {
  console.log("FAIL: total elapsed exceeded 25000ms");
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
