import { describe, test, expect } from "bun:test";
import { setup, createActor, waitFor, assign } from "xstate";
import { commandActor } from "./dispatchers/command.js";
import { defineWorkflow } from "./defineWorkflow.js";

describe("defineWorkflow: valid shape", () => {
  test("returns a frozen object with id, machine reference preserved", () => {
    const machine = setup({}).createMachine({
      id: "demo",
      initial: "idle",
      states: { idle: {} },
    });
    const result = defineWorkflow({ id: "demo", machine });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.id).toBe("demo");
    expect(result.machine).toBe(machine);
  });
});

describe("defineWorkflow: validation", () => {
  test("empty id throws with 'id' in the message", () => {
    const machine = setup({}).createMachine({
      id: "demo",
      initial: "idle",
      states: { idle: {} },
    });
    expect(() => defineWorkflow({ id: "   ", machine })).toThrow(/id/);
  });

  test("non-machine arg throws with 'machine' in the message", () => {
    expect(() =>
      defineWorkflow({ id: "x", machine: {} as any }),
    ).toThrow(/machine/);
  });
});

describe("defineWorkflow: integration with a command actor", () => {
  test("machine invoking commandActor reaches final state with output in context", async () => {
    type Ctx = {
      output: {
        exit_code: number;
        stdout: string;
        stderr: string;
        duration_ms: number;
      } | null;
    };
    const machine = setup({
      types: {} as { context: Ctx },
      actors: {
        command: commandActor({ cmd: ["echo", "hello"] }),
      },
    }).createMachine({
      id: "integration",
      initial: "running",
      context: { output: null },
      states: {
        running: {
          invoke: {
            src: "command",
            onDone: {
              target: "done",
              actions: assign({
                output: ({ event }: any) => event.output,
              }),
            },
          },
        },
        done: { type: "final" },
      },
    });

    defineWorkflow({ id: "integration", machine });

    const actor = createActor(machine);
    actor.start();
    const snapshot = await waitFor(actor, (s) => s.status === "done", {
      timeout: 1400,
    });

    const output = (snapshot.context as Ctx).output;
    expect(output).not.toBeNull();
    expect(output!.exit_code).toBe(0);
    expect(output!.stdout).toContain("hello");
  });
});
