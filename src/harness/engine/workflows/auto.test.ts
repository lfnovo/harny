import { describe, test, expect } from "bun:test";
import { fromPromise } from "xstate";
import autoWorkflow from "./auto.js";
import featureDevWorkflow from "./featureDev.js";
import { buildFeatureDevActors } from "./featureDevActors.js";
import { MockStateStore } from "../../testing/mockStateStore.js";
import { fakeSessionRunner } from "../../testing/fakeSessionRunner.js";
import { runEngineWorkflowDry } from "../../testing/index.js";
import type { State } from "../../state/schema.js";

function minimalState(): State {
  return {
    schema_version: 2,
    run_id: "run-x",
    origin: {
      prompt: "p",
      workflow: "w",
      task_slug: "t",
      started_at: "2026-01-01T00:00:00.000Z",
      host: "h",
      user: "u",
      features: null,
    },
    environment: {
      cwd: "/tmp",
      branch: "main",
      isolation: "inline",
      worktree_path: null,
      mode: "silent",
    },
    lifecycle: {
      status: "running",
      current_phase: null,
      ended_at: null,
      ended_reason: null,
      pid: 1,
    },
    phases: [],
    history: [],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
}

describe("auto workflow: store writes cross the boundary", () => {
  test("planner, developer, validator phases all land in the same store through auto → featureDev", async () => {
    const store = new MockStateStore(minimalState());

    const sessionRunPhase = fakeSessionRunner({
      planner: [
        {
          status: "completed",
          structuredOutput: {
            summary: "stub plan",
            tasks: [
              {
                id: "t1",
                title: "Task",
                description: "test",
                acceptance: ["AC1"],
              },
            ],
          },
          sessionId: "plan-sess",
          error: null,
          resultSubtype: null,
          events: [],
        },
      ],
      developer: [
        {
          status: "completed",
          structuredOutput: { status: "done", commit_message: "feat: x" },
          sessionId: "dev-sess",
          error: null,
          resultSubtype: null,
          events: [],
        },
      ],
      validator: [
        {
          status: "completed",
          structuredOutput: { verdict: "pass", reasons: [] },
          sessionId: "val-sess",
          error: null,
          resultSubtype: null,
          events: [],
        },
      ],
    });

    const leafActors = buildFeatureDevActors({
      cwd: "/tmp",
      taskSlug: "probe-auto",
      runId: "probe-auto-run-id",
      sessionRunPhase,
      gitCommit: async () => ({ sha: "mock-sha" }),
      mode: "silent",
      logMode: "quiet",
      store,
      variant: "default",
    });

    const wiredLeafMachine = featureDevWorkflow.machine.provide({
      actors: {
        ...leafActors,
        persistPlanActor: fromPromise(async () => {}),
      },
    });

    const snapshot = await runEngineWorkflowDry(
      autoWorkflow,
      { cwd: "/tmp", userPrompt: "test" },
      {
        leafMachine: wiredLeafMachine,
        cleanupActor: fromPromise(async () => {}),
      },
    );

    expect(snapshot.value).toBe("done");
    const names = store.phases().map((p) => p.name);
    expect(names).toContain("planner");
    expect(names).toContain("developer");
    expect(names).toContain("validator");
  });
});

describe("auto workflow: leaf + cleanup transitions", () => {
  test("leaf done + cleanup pass → 'done' final state", async () => {
    const snapshot = await runEngineWorkflowDry(
      autoWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        leafMachine: fromPromise(async () => {}),
        cleanupActor: fromPromise(async () => {}),
      },
    );
    expect(snapshot.value).toBe("done");
  });

  test("leaf error → finalize still runs cleanup → 'failed' final state (error preserved)", async () => {
    let cleanupCalled = false;
    const snapshot = await runEngineWorkflowDry(
      autoWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        leafMachine: fromPromise(async () => {
          throw new Error("leaf blew up");
        }),
        cleanupActor: fromPromise(async () => {
          cleanupCalled = true;
        }),
      },
    );
    expect(snapshot.value).toBe("failed");
    expect(cleanupCalled).toBe(true);
    expect(snapshot.context.error).toContain("leaf blew up");
  });

  test("leaf done BUT cleanup errors → 'failed' final state", async () => {
    const snapshot = await runEngineWorkflowDry(
      autoWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        leafMachine: fromPromise(async () => {}),
        cleanupActor: fromPromise(async () => {
          throw new Error("cleanup blew up");
        }),
      },
    );
    expect(snapshot.value).toBe("failed");
  });

  test("leaf error + cleanup pass → still 'failed' (cleanup does not rescue)", async () => {
    const snapshot = await runEngineWorkflowDry(
      autoWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        leafMachine: fromPromise(async () => {
          throw new Error("leaf err");
        }),
        cleanupActor: fromPromise(async () => {}),
      },
    );
    expect(snapshot.value).toBe("failed");
  });
});

describe("auto workflow: machine config topology", () => {
  const config = (autoWorkflow.machine as any).config;
  const states = config?.states ?? {};

  test("'invoking' exists with invoke config", () => {
    expect(states["invoking"]).toBeDefined();
    expect(states["invoking"].invoke).toBeDefined();
  });

  test("'finalize' is a compound state with a 'cleanup' child", () => {
    expect(states["finalize"]).toBeDefined();
    expect(states["finalize"].initial).toBeTruthy();
    expect(states["finalize"].states?.["cleanup"]).toBeDefined();
  });

  test("'done' and 'failed' are final states", () => {
    expect(states["done"]?.type).toBe("final");
    expect(states["failed"]?.type).toBe("final");
  });
});
