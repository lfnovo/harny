/**
 * Probe: defineWorkflow — three scenarios with 1500ms hard deadline per scenario.
 *
 * RUN
 *   bun scripts/probes/engine/03-define-workflow.ts
 */

import { setup, createActor, waitFor, assign } from 'xstate';
import { commandActor } from '../../../src/harness/engine/dispatchers/command.ts';
import { defineWorkflow } from '../../../src/harness/engine/defineWorkflow.ts';

const DEADLINE_MS = 1500;

function deadline<T>(ms: number): Promise<T> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('deadline exceeded')), ms),
  );
}

let failures = 0;

// Scenario 1: valid-shape
{
  const name = 'valid-shape';
  try {
    await Promise.race([
      (async () => {
        const machine = setup({}).createMachine({
          id: 'demo',
          initial: 'idle',
          states: { idle: {} },
        });
        const result = defineWorkflow({ id: 'demo', machine });
        if (!Object.isFrozen(result)) throw new Error('result is not frozen');
        if (result.id !== 'demo') throw new Error(`id mismatch: ${result.id}`);
        if (result.machine !== machine) throw new Error('machine reference mismatch');
      })(),
      deadline<never>(DEADLINE_MS),
    ]);
    console.log(`PASS ${name}`);
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

// Scenario 2: invalid-id
{
  const name = 'invalid-id';
  try {
    await Promise.race([
      (async () => {
        const machine = setup({}).createMachine({
          id: 'demo',
          initial: 'idle',
          states: { idle: {} },
        });
        let threw = false;
        let errMsg = '';
        try {
          defineWorkflow({ id: '   ', machine });
        } catch (e: any) {
          threw = true;
          errMsg = e.message;
        }
        if (!threw) throw new Error('expected an error but none was thrown');
        if (!errMsg.includes('id')) throw new Error(`error message does not mention 'id': ${errMsg}`);
      })(),
      deadline<never>(DEADLINE_MS),
    ]);
    console.log(`PASS ${name}`);
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

// Scenario 3: integration — machine invokes commandActor, stores output in context, reaches final state
{
  const name = 'integration';
  try {
    await Promise.race([
      (async () => {
        type Ctx = { output: { exit_code: number; stdout: string; stderr: string; duration_ms: number } | null };
        const machine = setup({
          types: {} as { context: Ctx },
          actors: {
            command: commandActor({ cmd: ['echo', 'hello'] }),
          },
        }).createMachine({
          id: 'integration',
          initial: 'running',
          context: { output: null },
          states: {
            running: {
              invoke: {
                src: 'command',
                onDone: {
                  target: 'done',
                  actions: assign({ output: ({ event }: any) => event.output }),
                },
              },
            },
            done: { type: 'final' },
          },
        });

        defineWorkflow({ id: 'integration', machine });

        const actor = createActor(machine);
        actor.start();
        const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 1400 });

        const output = (snapshot.context as Ctx).output;
        if (!output) throw new Error('context.output is null');
        if (output.exit_code !== 0) throw new Error(`exit_code=${output.exit_code}`);
        if (!output.stdout.includes('hello')) throw new Error(`stdout=${JSON.stringify(output.stdout)}`);
      })(),
      deadline<never>(DEADLINE_MS),
    ]);
    console.log(`PASS ${name}`);
  } catch (e: any) {
    console.log(`FAIL ${name}: ${e.message}`);
    failures++;
  }
}

process.exit(failures > 0 ? 1 : 0);
