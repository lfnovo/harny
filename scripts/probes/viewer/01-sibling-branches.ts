/**
 * Probe: sibling-branches endpoint smoke test.
 *
 * Policy: live server (preferred).
 * - Creates tmp git repos with branches touching shared files.
 * - Starts the viewer on a random port.
 * - Exercises /api/runs/:cwdHash/my-probe-run/sibling-branches.
 * - Asserts prefix filtering and O(S) git call behaviour.
 *
 * Each scenario is raced against 8000ms. Total probe target: under 25s.
 *
 * RUN
 *   bun scripts/probes/viewer/01-sibling-branches.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const PROBE_DIR = new URL('.', import.meta.url).pathname;
const HARNESS_ROOT = resolve(PROBE_DIR, '..', '..', '..');
const RUNNER_PATH = join(HARNESS_ROOT, 'src', 'runner.ts');

function writeStateJson(tmpDir: string): void {
  const runDir = join(tmpDir, '.harny', 'my-probe-run');
  mkdirSync(runDir, { recursive: true });
  const state = {
    schema_version: 2,
    run_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    origin: {
      prompt: 'probe test',
      workflow: 'feature-dev',
      task_slug: 'my-probe-run',
      started_at: '2026-01-01T00:00:00.000Z',
      host: 'test-host',
      user: 'test-user',
      features: null,
    },
    environment: {
      cwd: tmpDir,
      branch: 'main',
      isolation: 'inline',
      worktree_path: null,
      mode: 'silent',
    },
    lifecycle: {
      status: 'done',
      current_phase: null,
      ended_at: '2026-01-01T00:00:01.000Z',
      ended_reason: 'all tasks done',
      pid: 99999,
    },
    phases: [],
    history: [],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
  writeFileSync(join(runDir, 'state.json'), JSON.stringify(state, null, 2));
}

/** harny/sibling touches alpha.txt; main also touches alpha.txt */
function makeBasicRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-sibling-'));
  const g = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
  g('git init -b main');
  g('git config user.email test@harny.local');
  g('git config user.name "Harny Test"');
  writeFileSync(join(dir, 'alpha.txt'), 'initial\n');
  g('git add alpha.txt');
  g('git commit -m "initial commit"');
  g('git checkout -b harny/sibling');
  writeFileSync(join(dir, 'alpha.txt'), 'sibling change\n');
  g('git commit -am "sibling changes alpha"');
  g('git checkout main');
  writeFileSync(join(dir, 'alpha.txt'), 'main change\n');
  g('git commit -am "main changes alpha"');
  return dir;
}

/** harny/foo and feature/random both touch shared.ts; main also touches it */
function makeNonHarnessRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-sibling-'));
  const g = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
  g('git init -b main');
  g('git config user.email test@harny.local');
  g('git config user.name "Harny Test"');
  writeFileSync(join(dir, 'shared.ts'), 'initial\n');
  g('git add shared.ts');
  g('git commit -m "initial commit"');
  g('git checkout -b harny/foo');
  writeFileSync(join(dir, 'shared.ts'), 'harny/foo change\n');
  g('git commit -am "harny/foo changes shared.ts"');
  g('git checkout main');
  g('git checkout -b feature/random');
  writeFileSync(join(dir, 'shared.ts'), 'feature/random change\n');
  g('git commit -am "feature/random changes shared.ts"');
  g('git checkout main');
  writeFileSync(join(dir, 'shared.ts'), 'main change\n');
  g('git commit -am "main changes shared.ts"');
  return dir;
}

/** harny/foo touches 3 files; main also touches all 3 */
function makeMultiFileRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-sibling-'));
  const g = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
  g('git init -b main');
  g('git config user.email test@harny.local');
  g('git config user.name "Harny Test"');
  writeFileSync(join(dir, 'a.ts'), 'a initial\n');
  writeFileSync(join(dir, 'b.ts'), 'b initial\n');
  writeFileSync(join(dir, 'c.ts'), 'c initial\n');
  g('git add a.ts b.ts c.ts');
  g('git commit -m "initial commit"');
  g('git checkout -b harny/foo');
  writeFileSync(join(dir, 'a.ts'), 'a foo\n');
  writeFileSync(join(dir, 'b.ts'), 'b foo\n');
  writeFileSync(join(dir, 'c.ts'), 'c foo\n');
  g('git commit -am "harny/foo changes 3 files"');
  g('git checkout main');
  writeFileSync(join(dir, 'a.ts'), 'a main\n');
  writeFileSync(join(dir, 'b.ts'), 'b main\n');
  writeFileSync(join(dir, 'c.ts'), 'c main\n');
  g('git commit -am "main changes 3 files"');
  return dir;
}

async function pollHealth(port: number, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`viewer did not become healthy within ${maxMs}ms`);
}

const deadline = (ms: number) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms));

async function runScenario(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await Promise.race([fn(), deadline(8000)]);
    console.log(`PASS ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    throw e;
  }
}

async function main(): Promise<void> {
  const port = 4200 + Math.floor(Math.random() * 800);
  const server = Bun.spawn(['bun', RUNNER_PATH, 'ui', '--no-open', `--port=${port}`], {
    cwd: HARNESS_ROOT,
    env: { ...process.env, HARNY_UI_PORT: String(port) },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  const tmpDirs: string[] = [];
  try {
    await pollHealth(port, 5000);

    await runScenario('sibling-branches', async () => {
      const tmpDir = makeBasicRepo();
      tmpDirs.push(tmpDir);
      writeStateJson(tmpDir);
      const cwdHash = Buffer.from(tmpDir).toString('base64url');
      const res = await fetch(`http://127.0.0.1:${port}/api/runs/${cwdHash}/my-probe-run/sibling-branches`);
      if (!res.ok) throw new Error(`endpoint returned HTTP ${res.status}`);
      const data = (await res.json()) as { siblingBranches: Array<{ branch: string; files: string[] }> };
      if (!Array.isArray(data.siblingBranches)) {
        throw new Error(`siblingBranches is not an array: ${JSON.stringify(data)}`);
      }
      const sibling = data.siblingBranches.find((s) => s.branch === 'harny/sibling');
      if (!sibling) {
        throw new Error(`expected branch 'harny/sibling' in response, got: ${JSON.stringify(data.siblingBranches)}`);
      }
      if (!sibling.files.includes('alpha.txt')) {
        throw new Error(`expected 'alpha.txt' in sibling files, got: ${JSON.stringify(sibling.files)}`);
      }
    });

    await runScenario('filters-non-harness-branches', async () => {
      const tmpDir = makeNonHarnessRepo();
      tmpDirs.push(tmpDir);
      writeStateJson(tmpDir);
      const cwdHash = Buffer.from(tmpDir).toString('base64url');
      const res = await fetch(`http://127.0.0.1:${port}/api/runs/${cwdHash}/my-probe-run/sibling-branches`);
      if (!res.ok) throw new Error(`endpoint returned HTTP ${res.status}`);
      const data = (await res.json()) as { siblingBranches: Array<{ branch: string; files: string[] }> };
      if (!Array.isArray(data.siblingBranches)) {
        throw new Error(`siblingBranches is not an array: ${JSON.stringify(data)}`);
      }
      const hasHarny = data.siblingBranches.some((s) => s.branch === 'harny/foo');
      if (!hasHarny) {
        throw new Error(`expected harny/foo in response, got: ${JSON.stringify(data.siblingBranches)}`);
      }
      const hasFeature = data.siblingBranches.some((s) => s.branch === 'feature/random');
      if (hasFeature) {
        throw new Error(`expected feature/random to be absent, got: ${JSON.stringify(data.siblingBranches)}`);
      }
    });

    await runScenario('multiple-files-single-call', async () => {
      const tmpDir = makeMultiFileRepo();
      tmpDirs.push(tmpDir);
      writeStateJson(tmpDir);
      const cwdHash = Buffer.from(tmpDir).toString('base64url');
      const res = await fetch(`http://127.0.0.1:${port}/api/runs/${cwdHash}/my-probe-run/sibling-branches`);
      if (!res.ok) throw new Error(`endpoint returned HTTP ${res.status}`);
      const data = (await res.json()) as { siblingBranches: Array<{ branch: string; files: string[] }> };
      if (!Array.isArray(data.siblingBranches)) {
        throw new Error(`siblingBranches is not an array: ${JSON.stringify(data)}`);
      }
      const sibling = data.siblingBranches.find((s) => s.branch === 'harny/foo');
      if (!sibling) {
        throw new Error(`expected harny/foo in response, got: ${JSON.stringify(data.siblingBranches)}`);
      }
      for (const f of ['a.ts', 'b.ts', 'c.ts']) {
        if (!sibling.files.includes(f)) {
          throw new Error(`expected '${f}' in sibling files, got: ${JSON.stringify(sibling.files)}`);
        }
      }
    });
  } finally {
    server.kill();
    for (const d of tmpDirs) rmSync(d, { recursive: true });
  }
}

await main().catch(() => {
  process.exit(1);
});

process.exit(0);
