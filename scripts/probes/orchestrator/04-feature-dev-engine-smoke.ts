/**
 * Probe: feature-dev-engine-smoke — end-to-end CLI smoke test for the feature-dev-engine workflow.
 *
 * Three modes:
 *   SKIP (default, no API key):
 *       Prints "SKIP feature-dev-engine-smoke: no ANTHROPIC_API_KEY" and exits 0.
 *   MOCK (HARNY_SMOKE_MOCK=1, no real LLM call):
 *       Exercises the full orchestrator engine-routing path using echo-commit (no LLM),
 *       then verifies the probe's assertion logic with a manually-created CONTRIBUTING.md.
 *       Prints "PASS feature-dev-engine-smoke" and exits 0.
 *   LIVE (ANTHROPIC_API_KEY set):
 *       Calls runHarness with feature-dev-engine; waits up to 300s for the engine to produce
 *       a commit and CONTRIBUTING.md; asserts status=done / 2+ commits / file exists.
 *       Prints "PASS feature-dev-engine-smoke" and exits 0.
 *
 * To exercise without an API key (verifies orchestrator routing + assertion logic):
 *   HARNY_SMOKE_MOCK=1 bun scripts/probes/orchestrator/04-feature-dev-engine-smoke.ts
 *
 * RUN
 *   bun scripts/probes/orchestrator/04-feature-dev-engine-smoke.ts
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHarness } from '../../../src/harness/orchestrator.ts';

const PROBE_NAME = 'feature-dev-engine-smoke';
const LIVE_TIMEOUT_MS = 300_000;
const PROBE_DEADLINE_MS = 360_000;

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-e2e-'));
  const g = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir });
  g(['init']);
  g(['config', 'user.email', 'test@harny.local']);
  g(['config', 'user.name', 'Harny Test']);
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  g(['add', 'README.md']);
  g(['commit', '-m', 'seed']);
  return dir;
}

function gitLogCount(cwd: string): number {
  const proc = Bun.spawnSync(['git', 'log', '--oneline'], { cwd, stdout: 'pipe' });
  const out = proc.stdout ? new TextDecoder().decode(proc.stdout) : '';
  return out.trim().split('\n').filter(Boolean).length;
}

async function runMockMode(): Promise<void> {
  // Mock mode: exercises orchestrator engine-routing + probe assertion logic without an API key.
  // Uses echo-commit (a non-LLM engine workflow) to verify:
  //   1. runHarness routes engine workflows correctly
  //   2. state.json is written with status=done
  //   3. The commit-count and file-existence assertions work as expected
  const tmpDir = makeTmpRepo();
  try {
    const result = await Promise.race([
      runHarness({
        cwd: tmpDir,
        userPrompt: 'mock smoke run',
        workflowId: 'echo-commit',
        isolation: 'inline',
        mode: 'silent',
        taskSlug: 'smoke-e2e',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('mock run timed out after 30s')), 30_000),
      ),
    ]);

    if (result.status !== 'done') {
      throw new Error(`mock run: expected status 'done', got '${result.status}'`);
    }

    // Create CONTRIBUTING.md and commit it to exercise the file + commit assertion logic
    writeFileSync(join(tmpDir, 'CONTRIBUTING.md'), 'Hello world.\n');
    const addProc = Bun.spawnSync(['git', 'add', 'CONTRIBUTING.md'], { cwd: tmpDir });
    if (addProc.exitCode !== 0) {
      throw new Error(`git add CONTRIBUTING.md failed (exit ${addProc.exitCode ?? '?'})`);
    }
    const commitProc = Bun.spawnSync(
      ['git', 'commit', '-m', 'add CONTRIBUTING.md'],
      { cwd: tmpDir },
    );
    if (commitProc.exitCode !== 0) {
      throw new Error(`git commit failed (exit ${commitProc.exitCode ?? '?'})`);
    }

    const commitCount = gitLogCount(tmpDir);
    if (commitCount < 2) {
      throw new Error(`mock run: expected ≥2 commits, got ${commitCount}`);
    }

    if (!existsSync(join(tmpDir, 'CONTRIBUTING.md'))) {
      throw new Error('mock run: CONTRIBUTING.md missing');
    }

    console.log(`PASS ${PROBE_NAME}`);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
}

async function runLiveMode(): Promise<void> {
  const tmpDir = makeTmpRepo();
  try {
    const result = await Promise.race([
      runHarness({
        cwd: tmpDir,
        userPrompt: 'Add a file CONTRIBUTING.md with one line: Hello world.',
        workflowId: 'feature-dev',
        isolation: 'inline',
        mode: 'silent',
        taskSlug: 'smoke-e2e',
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`live run timed out after ${LIVE_TIMEOUT_MS}ms`)),
          LIVE_TIMEOUT_MS,
        ),
      ),
    ]);

    if (result.status !== 'done') {
      throw new Error(`live run: expected status 'done', got '${result.status}'`);
    }

    // Assert at least 2 commits: the initial seed commit + one from the engine
    const commitCount = gitLogCount(tmpDir);
    if (commitCount < 2) {
      throw new Error(`live run: expected ≥2 commits, got ${commitCount}`);
    }

    if (!existsSync(join(tmpDir, 'CONTRIBUTING.md'))) {
      throw new Error('live run: CONTRIBUTING.md missing');
    }

    console.log(`PASS ${PROBE_NAME}`);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
}

async function main(): Promise<void> {
  const outerDeadline = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`${PROBE_NAME}: outer ${PROBE_DEADLINE_MS}ms deadline exceeded`)),
      PROBE_DEADLINE_MS,
    ),
  );

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  const mockMode = process.env.HARNY_SMOKE_MOCK === '1';

  if (!hasApiKey && !mockMode) {
    console.log(`SKIP ${PROBE_NAME}: no ANTHROPIC_API_KEY`);
    process.exit(0);
  }

  await Promise.race([
    hasApiKey ? runLiveMode() : runMockMode(),
    outerDeadline,
  ]);
}

await main().catch((e: any) => {
  console.log(`FAIL ${PROBE_NAME}: ${e.message}`);
  process.exit(1);
});
