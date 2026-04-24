import { describe, test, expect, afterEach } from "bun:test";
import { setup } from "xstate";
import { runEngineWorkflow } from "./runEngineWorkflow.js";
import echoCommit from "../workflows/echoCommit.js";
import { tmpGitRepo } from "../../testing/index.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const c = cleanups.pop()!;
    await c().catch(() => {});
  }
});

async function repo() {
  const r = await tmpGitRepo({ seed: {} });
  cleanups.push(r.cleanup);
  return r;
}

describe("runEngineWorkflow: happy path", () => {
  test("echoCommit workflow completes with status=done and a 40-char sha", async () => {
    const r = await repo();
    const result = await runEngineWorkflow(echoCommit, {
      cwd: r.path,
      taskSlug: "test-a",
      runId: "run-a",
      userPrompt: "",
      variant: "default",
    });
    expect(result.status).toBe("done");
    expect(result.finalContext?.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("runEngineWorkflow: timeout cleanup", () => {
  test("hanging machine + small timeoutMs → status=failed and actor stops fast", async () => {
    const r = await repo();
    const hangingMachine = setup({}).createMachine({
      id: "hanging",
      initial: "waiting",
      states: { waiting: {} },
    });
    const start = Date.now();
    const result = await runEngineWorkflow(
      { id: "probe-hanging", machine: hangingMachine } as any,
      {
        cwd: r.path,
        taskSlug: "test-b",
        runId: "run-b",
        userPrompt: "",
        variant: "default",
        timeoutMs: 200,
      },
    );
    const elapsed = Date.now() - start;
    expect(result.status).toBe("failed");
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("runEngineWorkflow: machine error fast-fails", () => {
  test("machine whose entry action throws → status=failed carrying the original error string", async () => {
    const r = await repo();
    const failingMachine = setup({
      actions: {
        throwError: () => {
          throw new Error("deliberate machine error");
        },
      },
    }).createMachine({
      id: "failing",
      initial: "start",
      states: { start: { entry: "throwError" } },
    });
    const result = await runEngineWorkflow(
      { id: "probe-failing", machine: failingMachine } as any,
      {
        cwd: r.path,
        taskSlug: "test-c",
        runId: "run-c",
        userPrompt: "",
        variant: "default",
      },
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("deliberate machine error");
  });
});
