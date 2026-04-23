/**
 * Probe: echo-commit workflow — 1 scenario, raced 3000ms, whole probe under 6s.
 *
 * RUN
 *   bun scripts/probes/engine/06-echo-commit-workflow.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createActor } from 'xstate';
import echoCommitWorkflow from '../../../src/harness/engine/workflows/echoCommit.ts';

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-echo-'));
  const g = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir });
  g(['init']);
  g(['config', 'user.email', 'test@harny.local']);
  g(['config', 'user.name', 'Harny Test']);
  g(['commit', '--allow-empty', '-m', 'seed']);
  return dir;
}

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
  return (await new Response(proc.stdout!).text()).trim();
}

let failures = 0;

async function main(): Promise<void> {
  const outerDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('outer 6s deadline exceeded')), 6000),
  );

  await Promise.race([runProbe(), outerDeadline]);
}

async function runProbe(): Promise<void> {
  const tmpRepo = makeTmpRepo();
  let finalSnapshot: any;

  try {
    const result = await Promise.race([
      new Promise<any>((resolve, reject) => {
        const actor = createActor(echoCommitWorkflow.machine, { input: { cwd: tmpRepo } });
        actor.subscribe((snapshot) => {
          finalSnapshot = snapshot;
          if (snapshot.status === 'done' && snapshot.value === 'done') {
            resolve(snapshot);
          } else if (snapshot.status === 'done' && snapshot.value === 'failed') {
            reject(new Error('machine reached failed state'));
          }
        });
        actor.start();
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('3000ms scenario deadline exceeded')), 3000),
      ),
    ]);

    const commitSha: string = result.context.commitSha;
    if (!/^[0-9a-f]{40}$/.test(commitSha)) {
      console.log(`FAIL echo-commit-workflow: commitSha "${commitSha}" does not match /^[0-9a-f]{40}$/`);
      failures++;
      return;
    }

    const log = await git(['log', '--oneline', '-n', '2'], tmpRepo);
    if (!log.includes('seed')) {
      console.log(`FAIL echo-commit-workflow: git log missing 'seed' commit — got: ${log}`);
      failures++;
      return;
    }
    if (!log.includes('add note')) {
      console.log(`FAIL echo-commit-workflow: git log missing 'add note' commit — got: ${log}`);
      failures++;
      return;
    }

    console.log('PASS echo-commit-workflow');
  } catch (e: any) {
    console.log(`FAIL echo-commit-workflow: ${e.message}`);
    failures++;
  } finally {
    rmSync(tmpRepo, { recursive: true });
  }
}

await main().catch((e: any) => {
  console.log(`FAIL echo-commit-workflow: ${e.message}`);
  failures++;
});

process.exit(failures > 0 ? 1 : 0);
