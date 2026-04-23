/**
 * Probe: gitLog preserves real git stderr in the error field.
 *
 * Creates a valid repo, calls gitLog with a nonexistent branch, and asserts
 * that the returned error string contains actual git diagnostic text rather
 * than the bare placeholder 'git log failed'.
 *
 * Raced against 5000ms.
 *
 * RUN
 *   bun scripts/probes/viewer/03-git-log-stderr-preserved.ts
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
    await runScenario('stderr-preserved-in-error', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'harny-gitlog-stderr-'));
      tmpDirs.push(dir);
      const g = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
      g('git init -b main');
      g('git config user.email test@harny.local');
      g('git config user.name "Harny Test"');
      writeFileSync(join(dir, 'file.txt'), 'initial\n');
      g('git add file.txt');
      g('git commit -m "initial commit"');

      const result = await gitLog(dir, 'nonexistent-branch');

      if (result.error === undefined) {
        throw new Error('expected result.error to be defined for nonexistent branch');
      }
      if (typeof result.error !== 'string') {
        throw new Error(`expected result.error to be a string, got ${typeof result.error}`);
      }
      if (result.error === 'git log failed') {
        throw new Error('result.error is the bare placeholder string — real stderr was not preserved');
      }
      const hasGitDiagnostic =
        result.error.includes('unknown revision') ||
        result.error.includes('ambiguous argument') ||
        result.error.includes('bad revision') ||
        result.error.includes('not a tree object');
      if (!hasGitDiagnostic) {
        throw new Error(`result.error does not contain git diagnostic text: ${JSON.stringify(result.error)}`);
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
