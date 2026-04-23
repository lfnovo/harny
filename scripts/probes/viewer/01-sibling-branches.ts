/**
 * Probe: sibling-branches endpoint smoke test.
 *
 * Policy: live server (preferred).
 * - Creates a tmp git repo with two branches touching the same file.
 * - Starts the viewer on a random port.
 * - Curls /api/runs/:cwdHash/my-probe-run/sibling-branches.
 * - Asserts the sibling branch + overlapping file appear in the response.
 *
 * Fallback: if the server cannot start in time the probe exits 1 with details.
 * Promise.race against 8s ensures we never block the outer `timeout 10` call.
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

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-sibling-'));
  const g = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
  g('git init -b main');
  g('git config user.email test@harny.local');
  g('git config user.name "Harny Test"');
  writeFileSync(join(dir, 'alpha.txt'), 'initial\n');
  g('git add alpha.txt');
  g('git commit -m "initial commit"');
  // sibling branch touches alpha.txt
  g('git checkout -b sibling');
  writeFileSync(join(dir, 'alpha.txt'), 'sibling change\n');
  g('git commit -am "sibling changes alpha"');
  // run branch (main) also touches alpha.txt — this is the commit the endpoint inspects
  g('git checkout main');
  writeFileSync(join(dir, 'alpha.txt'), 'main change\n');
  g('git commit -am "main changes alpha"');
  return dir;
}

function writeStateJson(tmpDir: string): void {
  const runDir = join(tmpDir, '.harny', 'my-probe-run');
  mkdirSync(runDir, { recursive: true });
  const state = {
    schema_version: 1,
    run_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    origin: {
      prompt: 'probe test',
      workflow: 'feature-dev',
      task_slug: 'my-probe-run',
      started_at: '2026-01-01T00:00:00.000Z',
      host: 'test-host',
      user: 'test-user',
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
  };
  writeFileSync(join(runDir, 'state.json'), JSON.stringify(state, null, 2));
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

async function main(): Promise<void> {
  const tmpDir = makeTmpRepo();
  writeStateJson(tmpDir);

  const port = 4200 + Math.floor(Math.random() * 800);
  const server = Bun.spawn(['bun', RUNNER_PATH, 'ui', '--no-open', `--port=${port}`], {
    cwd: HARNESS_ROOT,
    env: { ...process.env, HARNY_UI_PORT: String(port) },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  try {
    await pollHealth(port, 5000);

    const cwdHash = Buffer.from(tmpDir).toString('base64url');
    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${cwdHash}/my-probe-run/sibling-branches`);

    if (!res.ok) {
      throw new Error(`endpoint returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as { siblingBranches: Array<{ branch: string; files: string[] }> };

    if (!Array.isArray(data.siblingBranches)) {
      throw new Error(`siblingBranches is not an array: ${JSON.stringify(data)}`);
    }

    const sibling = data.siblingBranches.find((s) => s.branch === 'sibling');
    if (!sibling) {
      throw new Error(`expected branch 'sibling' in response, got: ${JSON.stringify(data.siblingBranches)}`);
    }

    if (!sibling.files.includes('alpha.txt')) {
      throw new Error(`expected 'alpha.txt' in sibling files, got: ${JSON.stringify(sibling.files)}`);
    }

    console.log('PASS sibling-branches');
  } finally {
    server.kill();
    rmSync(tmpDir, { recursive: true });
  }
}

const deadline = (ms: number) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms));

await Promise.race([main(), deadline(8000)]).catch((e: unknown) => {
  console.log(`FAIL sibling-branches: ${(e as Error).message}`);
  process.exit(1);
});

process.exit(0);
