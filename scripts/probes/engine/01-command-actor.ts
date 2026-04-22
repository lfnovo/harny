/**
 * Probe: commandActor — four scenarios with 3s hard deadline per scenario.
 *
 * RUN
 *   timeout 20 bun scripts/probes/engine/01-command-actor.ts
 */

import { commandActor, runCommand } from '../../../src/harness/engine/dispatchers/command.ts';
import { createActor } from 'xstate';

const DEADLINE_MS = 3000;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

function actorToPromise(logic: ReturnType<typeof commandActor>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const actor = createActor(logic as never);
    actor.subscribe({
      next: (snapshot: any) => {
        if (snapshot.status === 'done') resolve(snapshot.output);
      },
      error: reject,
    });
    actor.start();
  });
}

let failures = 0;

// Scenario 1: success — echo hello, expect exit_code 0 and stdout containing 'hello'
{
  const name = 'success';
  try {
    const result: any = await Promise.race([
      actorToPromise(commandActor({ cmd: ['echo', 'hello'] })),
      hardDeadline(),
    ]);
    if (result.exit_code === 0 && result.stdout.includes('hello')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: unexpected result exit_code=${result.exit_code} stdout=${JSON.stringify(result.stdout)}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

// Scenario 2: non-zero exit — sh -c 'exit 42', expect exit_code 42 (resolves, not rejects)
{
  const name = 'non-zero-exit';
  try {
    const result: any = await Promise.race([
      actorToPromise(commandActor({ cmd: ['sh', '-c', 'exit 42'] })),
      hardDeadline(),
    ]);
    if (result.exit_code === 42) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected exit_code=42, got ${result.exit_code}`);
      failures++;
    }
  } catch (e: any) {
    console.log(`FAIL ${name}: unexpected rejection: ${e.message}`);
    failures++;
  }
}

// Scenario 3: timeout — sleep 10 with timeout_ms 100, expect rejection with timeout error
{
  const name = 'timeout';
  try {
    await Promise.race([
      actorToPromise(commandActor({ cmd: ['sleep', '10'], timeout_ms: 100 })),
      hardDeadline(),
    ]);
    console.log(`FAIL ${name}: should have thrown timeout error`);
    failures++;
  } catch (e: any) {
    if (e.message.includes('hard deadline')) {
      console.log(`FAIL ${name}: hard deadline exceeded (SIGKILL did not work)`);
      failures++;
    } else if (e.message.includes('timed out')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: wrong error: ${e.message}`);
      failures++;
    }
  }
}

// Scenario 4: abort — sleep 10, abort after 50ms via AbortController (direct call)
{
  const name = 'abort';
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  try {
    await Promise.race([
      runCommand({ cmd: ['sleep', '10'] }, controller.signal),
      hardDeadline(),
    ]);
    console.log(`FAIL ${name}: should have thrown abort error`);
    failures++;
  } catch (e: any) {
    if (e.message.includes('hard deadline')) {
      console.log(`FAIL ${name}: hard deadline exceeded (SIGKILL did not work)`);
      failures++;
    } else if (e.message.includes('aborted')) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: wrong error: ${e.message}`);
      failures++;
    }
  }
}

process.exit(failures > 0 ? 1 : 0);
