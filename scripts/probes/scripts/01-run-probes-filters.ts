import { spawn } from 'node:child_process';

const DEADLINE_MS = 1500;
const ROOT = new URL('../../..', import.meta.url).pathname;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', ['scripts/run-probes.ts', ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

async function scenario(name: string, check: () => Promise<void>): Promise<boolean> {
  try {
    await Promise.race([check(), hardDeadline()]);
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${(error as Error).message}`);
    return false;
  }
}

const results = await Promise.all([
  scenario('subdir-list-selects-only-viewer', async () => {
    const result = await run(['--subdir', 'viewer', '--list']);
    if (result.exitCode !== 0) throw new Error(result.stderr.trim());
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    if (lines.length === 0 || lines.some((line) => !line.startsWith('scripts/probes/viewer/'))) {
      throw new Error(`unexpected output: ${result.stdout.trim()}`);
    }
  }),
  scenario('only-selects-exact-probe-index', async () => {
    const result = await run(['--only', 'orchestrator/03', '--list']);
    if (result.exitCode !== 0) throw new Error(result.stderr.trim());
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    if (lines.length !== 1 || lines[0] !== 'scripts/probes/orchestrator/03-declarative-phoenix-wrap.ts') {
      throw new Error(`unexpected output: ${result.stdout.trim()}`);
    }
  }),
  scenario('conflicting-filters-fail', async () => {
    const result = await run(['--subdir', 'viewer', '--only', 'orchestrator/03', '--list']);
    if (result.exitCode === 0) throw new Error('expected non-zero exit code');
    if (!result.stderr.includes('--subdir and --only cannot be combined')) {
      throw new Error(`unexpected stderr: ${result.stderr.trim()}`);
    }
  }),
]);

process.exit(results.every(Boolean) ? 0 : 1);
