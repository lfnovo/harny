// engine-design.md §8, §11 — end-to-end echo-commit workflow

import { fromPromise, setup, assign, createMachine } from 'xstate';
import { runCommand } from '../dispatchers/command.js';
import { gitCommit } from '../harnyActions.js';
import { defineWorkflow } from '../defineWorkflow.js';
import type { CommandActorOptions } from '../types.js';

type CommandOutput = { exit_code: number; stdout: string; stderr: string; duration_ms: number };

interface EchoCommitContext {
  cwd: string;
  commandOutput?: CommandOutput;
  commitSha?: string;
}

const commandActorDef = fromPromise<CommandOutput, CommandActorOptions>(
  ({ input, signal }) => runCommand(input, signal),
);

const commitActorDef = fromPromise<{ sha: string }, { cwd: string; message: string }>(
  ({ input, signal }) => gitCommit(input, signal),
);

const machine = setup({
  types: {} as {
    context: EchoCommitContext;
    input: { cwd: string };
  },
  actors: {
    commandActor: commandActorDef,
    commitActor: commitActorDef,
  },
}).createMachine({
  id: 'echo-commit',
  initial: 'running',
  context: ({ input }) => ({ cwd: input.cwd }),
  states: {
    running: {
      invoke: {
        src: 'commandActor',
        input: ({ context }) => ({
          cmd: ['sh', '-c', 'echo hi > note.txt && git add note.txt'],
          cwd: context.cwd,
        }),
        onDone: {
          actions: assign({ commandOutput: ({ event }) => event.output }),
          target: 'committing',
        },
        onError: { target: 'failed' },
      },
    },
    committing: {
      invoke: {
        src: 'commitActor',
        input: ({ context }) => ({ cwd: context.cwd, message: 'add note' }),
        onDone: {
          actions: assign({ commitSha: ({ event }) => event.output.sha }),
          target: 'done',
        },
        onError: { target: 'failed' },
      },
    },
    done: { type: 'final' },
    failed: { type: 'final' },
  },
});

export default defineWorkflow({ id: 'echo-commit', needsBranch: false, needsWorktree: false, machine });
