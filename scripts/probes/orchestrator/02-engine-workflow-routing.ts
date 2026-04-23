/**
 * Probe: engine-workflow-routing — 4 scenarios, each raced 8000ms, whole probe under 20s.
 *
 * RUN
 *   bun scripts/probes/orchestrator/02-engine-workflow-routing.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setup, fromPromise } from 'xstate';
import { runEngineWorkflow } from '../../../src/harness/engine/runtime/runEngineWorkflow.ts';
import echoCommit from '../../../src/harness/engine/workflows/echoCommit.ts';
import { isEngineWorkflow } from '../../../src/harness/workflows/index.ts';
import { featureDev } from '../../../src/harness/workflows/featureDev/index.ts';
import { docs } from '../../../src/harness/workflows/docs.ts';

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harny-probe-'));
  const g = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir });
  g(['init']);
  g(['config', 'user.email', 'test@harny.local']);
  g(['config', 'user.name', 'Harny Test']);
  g(['commit', '--allow-empty', '-m', 'seed']);
  return dir;
}

let failures = 0;

async function main(): Promise<void> {
  const outerDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('outer 20s deadline exceeded')), 20_000),
  );

  await Promise.race([runProbes(), outerDeadline]);
}

async function runProbes(): Promise<void> {
  // Scenario (a): engine-workflow-completes
  {
    const name = 'engine-workflow-completes';
    const tmpRepo = makeTmpRepo();
    try {
      const result = await Promise.race([
        runEngineWorkflow(echoCommit, {
          cwd: tmpRepo,
          taskSlug: 'probe-a',
          runId: 'probe-run-a',
          userPrompt: 'test prompt',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('8000ms scenario deadline exceeded')), 8_000),
        ),
      ]);

      if (result.status !== 'done') {
        console.log(`FAIL ${name}: expected status 'done', got '${result.status}' — ${result.error ?? ''}`);
        failures++;
      } else if (!/^[0-9a-f]{40}$/.test(result.finalContext?.commitSha ?? '')) {
        console.log(`FAIL ${name}: commitSha "${result.finalContext?.commitSha}" does not match /^[0-9a-f]{40}$/`);
        failures++;
      } else {
        console.log(`PASS ${name}`);
      }
    } catch (e: any) {
      console.log(`FAIL ${name}: ${e.message}`);
      failures++;
    } finally {
      rmSync(tmpRepo, { recursive: true });
    }
  }

  // Scenario (b): detection
  {
    const name = 'detection';
    try {
      await Promise.race([
        (async () => {
          if (!isEngineWorkflow(echoCommit)) {
            throw new Error('isEngineWorkflow(echoCommit) returned false, expected true');
          }
          if (isEngineWorkflow(featureDev as any)) {
            throw new Error('isEngineWorkflow(featureDev) returned true, expected false');
          }
          if (isEngineWorkflow(docs as any)) {
            throw new Error('isEngineWorkflow(docs) returned true, expected false');
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('8000ms scenario deadline exceeded')), 8_000),
        ),
      ]);
      console.log(`PASS ${name}`);
    } catch (e: any) {
      console.log(`FAIL ${name}: ${e.message}`);
      failures++;
    }
  }

  // Scenario (c): actor-stops-on-timeout
  {
    const name = 'actor-stops-on-timeout';
    const tmpRepo = makeTmpRepo();
    try {
      const hangingMachine = setup({}).createMachine({
        id: 'hanging',
        initial: 'waiting',
        states: {
          waiting: {},
        },
      });
      const hangingWorkflow = { id: 'probe-hanging', machine: hangingMachine };

      const start = Date.now();
      const result = await runEngineWorkflow(hangingWorkflow as any, {
        cwd: tmpRepo,
        taskSlug: 'probe-c',
        runId: 'probe-run-c',
        userPrompt: 'test prompt',
        timeoutMs: 200,
      });
      const elapsed = Date.now() - start;

      if (result.status !== 'failed') {
        console.log(`FAIL ${name}: expected status 'failed', got '${result.status}'`);
        failures++;
      } else if (elapsed >= 1000) {
        console.log(`FAIL ${name}: returned in ${elapsed}ms — expected < 1000ms (actor not cleaned up on timeout?)`);
        failures++;
      } else {
        console.log(`PASS ${name} (elapsed ${elapsed}ms)`);
      }
    } catch (e: any) {
      console.log(`FAIL ${name}: threw unexpectedly — ${e.message}`);
      failures++;
    } finally {
      rmSync(tmpRepo, { recursive: true });
    }
  }

  // Scenario (d): machine-error-fast-fails
  {
    const name = 'machine-error-fast-fails';
    const tmpRepo = makeTmpRepo();
    try {
      const failingMachine = setup({
        actions: {
          throwError: () => {
            throw new Error('deliberate machine error');
          },
        },
      }).createMachine({
        id: 'failing',
        initial: 'start',
        states: {
          start: {
            entry: 'throwError',
          },
        },
      });
      const failingWorkflow = { id: 'probe-failing', machine: failingMachine };

      const result = await Promise.race([
        runEngineWorkflow(failingWorkflow as any, {
          cwd: tmpRepo,
          taskSlug: 'probe-d',
          runId: 'probe-run-d',
          userPrompt: 'test prompt',
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('5000ms deadline exceeded — error did not fast-fail')), 5_000),
        ),
      ]);

      if (result.status !== 'failed') {
        console.log(`FAIL ${name}: expected status 'failed', got '${result.status}'`);
        failures++;
      } else if (!result.error?.includes('deliberate machine error')) {
        console.log(`FAIL ${name}: error string "${result.error}" does not contain 'deliberate machine error'`);
        failures++;
      } else {
        console.log(`PASS ${name}`);
      }
    } catch (e: any) {
      console.log(`FAIL ${name}: ${e.message}`);
      failures++;
    } finally {
      rmSync(tmpRepo, { recursive: true });
    }
  }
}

await main().catch((e: any) => {
  console.log(`FAIL outer: ${e.message}`);
  failures++;
});

process.exit(failures > 0 ? 1 : 0);
