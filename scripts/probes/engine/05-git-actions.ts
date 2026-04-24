/**
 * Probe: git-effect actions — 4 scenarios with 1500ms hard deadline per scenario, whole probe under 8s.
 *
 * RUN
 *   bun scripts/probes/engine/05-git-actions.ts
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitCommit, gitResetTree, gitCleanUntracked } from '../../../src/harness/engine/harnyActions.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
  return (await new Response(proc.stdout!).text()).trim();
}

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-git-'));
  const g = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir });
  g(['init']);
  g(['config', 'user.email', 'test@harny.local']);
  g(['config', 'user.name', 'Harny Test']);
  g(['commit', '--allow-empty', '-m', 'seed']);
  return dir;
}

let failures = 0;

// Scenario 1: commit-happy
{
  const name = 'commit-happy';
  const cwd = makeTmpRepo();
  try {
    writeFileSync(join(cwd, 'file.txt'), 'hi\n');
    await git(['add', 'file.txt'], cwd);
    const controller = new AbortController();
    const result = await Promise.race([
      gitCommit({ cwd, message: 'add file' }, controller.signal),
      hardDeadline(),
    ]);
    const head = await git(['rev-parse', 'HEAD'], cwd);
    if (result.sha === head) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: sha mismatch — got ${result.sha}, HEAD is ${head}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  } finally {
    rmSync(cwd, { recursive: true });
  }
}

// Scenario 2: commit-no-changes
{
  const name = 'commit-no-changes';
  const cwd = makeTmpRepo();
  try {
    const controller = new AbortController();
    const result = await Promise.race([
      gitCommit({ cwd, message: 'nothing' }, controller.signal),
      hardDeadline(),
    ]);
    if (result.sha === null) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected sha null for no-op, got ${result.sha}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: unexpected throw — ${e.message}`);
    failures++;
  } finally {
    rmSync(cwd, { recursive: true });
  }
}

// Scenario 3: reset-tree
{
  const name = 'reset-tree';
  const cwd = makeTmpRepo();
  try {
    const pre = await git(['rev-parse', 'HEAD'], cwd);
    writeFileSync(join(cwd, 'extra.txt'), 'extra\n');
    await git(['add', 'extra.txt'], cwd);
    await git(['commit', '-m', 'extra commit'], cwd);
    const controller = new AbortController();
    await Promise.race([
      gitResetTree({ cwd, sha: pre }, controller.signal),
      hardDeadline(),
    ]);
    const head = await git(['rev-parse', 'HEAD'], cwd);
    if (head === pre) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: HEAD is ${head}, expected ${pre}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  } finally {
    rmSync(cwd, { recursive: true });
  }
}

// Scenario 4: clean-untracked
{
  const name = 'clean-untracked';
  const cwd = makeTmpRepo();
  try {
    const junk = join(cwd, 'junk.txt');
    writeFileSync(junk, '\n');
    const controller = new AbortController();
    await Promise.race([
      gitCleanUntracked({ cwd }, controller.signal),
      hardDeadline(),
    ]);
    if (!existsSync(junk)) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: junk.txt still exists`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  } finally {
    rmSync(cwd, { recursive: true });
  }
}

// Scenario 5: commit-stages-before
{
  const name = 'commit-stages-before';
  const cwd = makeTmpRepo();
  try {
    writeFileSync(join(cwd, 'untracked.txt'), 'auto-staged\n');
    const controller = new AbortController();
    const result = await Promise.race([
      gitCommit({ cwd, message: 'auto stage' }, controller.signal),
      hardDeadline(),
    ]);
    const showOut = await git(['show', '--name-only', '--format=%H', 'HEAD'], cwd);
    if (showOut.includes('untracked.txt')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: untracked.txt not in commit (sha=${result.sha}); show output: ${showOut}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  } finally {
    rmSync(cwd, { recursive: true });
  }
}

// Scenario 6: commit-empty-fails
{
  const name = 'commit-empty-fails';
  const cwd = makeTmpRepo();
  try {
    const controller = new AbortController();
    const result = await Promise.race([
      gitCommit({ cwd, message: 'empty' }, controller.signal),
      hardDeadline(),
    ]);
    if (result.sha === null) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected sha null for empty commit, got ${result.sha}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: unexpected throw — ${e.message}`);
    failures++;
  } finally {
    rmSync(cwd, { recursive: true });
  }
}

process.exit(failures > 0 ? 1 : 0);
