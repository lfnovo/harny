// end-to-end echo-commit workflow

import { setup, assign, createMachine } from 'xstate';
import { commandActorLogic } from '../dispatchers/command.js';
import { commitLogic } from '../harnyActions.js';
import { defineWorkflow } from '../defineWorkflow.js';

type CommandOutput = { exit_code: number; stdout: string; stderr: string; duration_ms: number };

interface EchoCommitContext {
  cwd: string;
  commandOutput?: CommandOutput;
  commitSha?: string;
}

const machine = setup({
  types: {} as {
    context: EchoCommitContext;
    input: { cwd: string };
  },
  actors: {
    commandActor: commandActorLogic,
    commitActor: commitLogic,
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
