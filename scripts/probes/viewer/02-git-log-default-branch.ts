/**
 * Probe: gitLog uses discoverBaseBranch instead of hard-coded 'main'.
 *
 * Scenario A: repo with default branch 'main' (no remote) — falls back to hardcoded 'main'.
 * Scenario B: repo with default branch 'master' (local config) — discovered via init.defaultBranch.
 *
 * Each scenario is raced against 5000ms.
 *
 * RUN
 *   bun scripts/probes/viewer/02-git-log-default-branch.ts
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { gitLog } from '../../../src/viewer/server.ts';

const deadline = (ms: number) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms));

async function runScenario(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await Promise.race([fn(), deadline(5000)]);
    console.log(`PASS ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    throw e;
  }
}

async function main(): Promise<void> {
  const tmpDirs: string[] = [];

  try {
    await runScenario('main-branch-default', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'harny-gitlog-'));
      tmpDirs.push(dir);
      const g = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
      g('git init -b main');
      g('git config user.email test@harny.local');
      g('git config user.name "Harny Test"');
      writeFileSync(join(dir, 'file.txt'), 'initial\n');
      g('git add file.txt');
      g('git commit -m "initial commit"');
      g('git checkout -b feature-branch');
      writeFileSync(join(dir, 'file.txt'), 'feature change\n');
      g('git commit -am "feature commit"');

      const result = await gitLog(dir, 'feature-branch');
      if (result.error) throw new Error(`unexpected error: ${result.error}`);
      if (result.commits.length !== 1) {
        throw new Error(`expected 1 commit, got ${result.commits.length}: ${JSON.stringify(result.commits)}`);
      }
    });

    await runScenario('master-branch-config', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'harny-gitlog-'));
      tmpDirs.push(dir);
      const g = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
      g('git init -b master');
      g('git config user.email test@harny.local');
      g('git config user.name "Harny Test"');
      g('git config init.defaultBranch master');
      writeFileSync(join(dir, 'file.txt'), 'initial\n');
      g('git add file.txt');
      g('git commit -m "initial commit"');
      g('git checkout -b feature-branch');
      writeFileSync(join(dir, 'file.txt'), 'feature change\n');
      g('git commit -am "feature commit"');

      const result = await gitLog(dir, 'feature-branch');
      if (result.error) throw new Error(`unexpected error: ${result.error}`);
      if (result.commits.length !== 1) {
        throw new Error(`expected 1 commit, got ${result.commits.length}: ${JSON.stringify(result.commits)}`);
      }
    });
  } finally {
    for (const d of tmpDirs) rmSync(d, { recursive: true });
  }
}

await main().catch(() => {
  process.exit(1);
});

process.exit(0);
