/**
 * End-to-end declarative feature-dev smoke. Mock mode exercises orchestration,
 * v3 persistence, ChangeSet validation, and the privileged commit without tokens.
 * Live mode uses the configured Claude provider.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentProvider, AgentRequest, AgentResult } from '../../../src/harness/providers/types.ts';
import { runHarness } from '../../../src/harness/orchestrator.ts';

const NAME = 'feature-dev-declarative-smoke';

function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'harny-e2e-'));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode) throw new Error(new TextDecoder().decode(result.stderr));
  };
  git('init', '-q'); git('config', 'user.email', 'test@harny.local'); git('config', 'user.name', 'Harny Test');
  writeFileSync(join(cwd, 'README.md'), '# Test\n'); git('add', 'README.md'); git('commit', '-qm', 'seed');
  return cwd;
}

class FixtureProvider implements AgentProvider {
  id = 'claude';
  capabilities = { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true };
  constructor(private cwd: string) {}
  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> {
    let output: unknown;
    if (request.phase === 'planner') output = { summary: 'smoke', tasks: [{ id: 't1', title: 'Add contributing guide', description: 'Add the requested file', acceptance: ['file exists'] }] };
    else if (request.phase === 'developer') {
      writeFileSync(join(this.cwd, 'CONTRIBUTING.md'), 'Hello world.\n');
      output = { task_id: 't1', status: 'done', summary: 'added', commit_message: 'docs: add contributing guide' };
    } else output = { verdict: 'pass', reasons: ['file exists'] };
    return { output: request.schema.parse(output), session: { id: `${request.phase}-fixture`, provider: this.id } };
  }
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY && process.env.HARNY_SMOKE_MOCK !== '1') {
    console.log(`SKIP ${NAME}: no ANTHROPIC_API_KEY`); return;
  }
  const cwd = repo();
  try {
    const result = await Promise.race([
      runHarness({ cwd, userPrompt: 'Add CONTRIBUTING.md with one line: Hello world.', workflowId: 'feature-dev', isolation: 'inline', logMode: 'quiet', taskSlug: 'smoke-e2e', ...(process.env.HARNY_SMOKE_MOCK === '1' ? { agentProvider: new FixtureProvider(cwd) } : {}) }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('smoke timed out')), 300_000);
        timer.unref();
      }),
    ]);
    const count = Bun.spawnSync(['git', 'rev-list', '--count', 'HEAD'], { cwd, stdout: 'pipe' });
    if (result.status !== 'done' || new TextDecoder().decode(count.stdout).trim() !== '2' || !existsSync(join(cwd, 'CONTRIBUTING.md'))) throw new Error('declarative feature-dev assertions failed');
    if (!existsSync(join(cwd, '.harny', 'smoke-e2e', 'run.json'))) throw new Error('run.json v3 missing');
    console.log(`PASS ${NAME}`);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

await main().catch((error) => { console.error(`FAIL ${NAME}: ${(error as Error).message}`); process.exit(1); });
