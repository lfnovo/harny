import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { runPhaseWithFixture } from "../../testing/index.js";
import { MockStateStore } from "../../testing/mockStateStore.js";
import { adaptRunPhase } from "./runPhaseAdapter.js";
import type { SessionRunPhase } from "./runPhaseAdapter.js";
import type { PhaseRunResult } from "../../sessionRecorder.js";
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

function completedFixture(sessionId: string): PhaseRunResult<unknown> {
  return {
    sessionId,
    status: "completed",
    error: null,
    structuredOutput: {},
    resultSubtype: "success",
    events: [],
  };
}

const phaseConfig = {
  prompt: "test",
  allowedTools: [] as string[],
  permissionMode: "bypassPermissions" as const,
  maxTurns: 1,
  effort: "low" as const,
  model: "sonnet" as const,
  mcpServers: {},
  guards: {},
};

describe("adaptRunPhase: translates engineArgs → SessionRunPhase args", () => {
  test("phase, primaryCwd, phaseCwd, taskSlug, workflowId, prompt, outputSchema, allowedTools are threaded correctly", async () => {
    let captured: any = null;
    const capturingFn: SessionRunPhase = async (args) => {
      captured = args;
      return {
        sessionId: "s-cap",
        status: "completed",
        error: null,
        structuredOutput: { ok: true },
        resultSubtype: "success",
        events: [],
      };
    };
    const runner = adaptRunPhase({
      cwd: "/tmp/test-cwd",
      workflowId: "test-workflow",
      taskSlug: "test-task",
      runId: "run-001",
      phaseConfig,
      sessionRunPhase: capturingFn,
      mode: "silent",
      logMode: "compact",
    });
    const schema = z.object({}).passthrough();
    const result = await runner({
      phaseName: "developer",
      prompt: "do the thing",
      schema,
      allowedTools: ["Bash", "Read"],
    });
    expect(captured).not.toBeNull();
    expect(captured.phase).toBe("developer");
    expect(captured.primaryCwd).toBe("/tmp/test-cwd");
    expect(captured.phaseCwd).toBe("/tmp/test-cwd");
    expect(captured.taskSlug).toBe("test-task");
    expect(captured.workflowId).toBe("test-workflow");
    expect(captured.prompt).toBe("do the thing");
    expect(captured.outputSchema).toBe(schema);
    // engine allowedTools win over phaseConfig's
    expect(captured.phaseConfig.allowedTools).toEqual(["Bash", "Read"]);
    // result: session_id + output passthrough
    expect(result.session_id).toBe("s-cap");
    expect(result.output).toEqual({ ok: true });
  });
});

describe("adaptRunPhase: non-happy statuses", () => {
  test("paused_for_user_input → throws 'not supported' (RFC #20)", async () => {
    const store = new MockStateStore(minimalState());
    const parkedFixture: PhaseRunResult<unknown> = {
      sessionId: "s-paused",
      status: "paused_for_user_input",
      error: null,
      structuredOutput: null,
      resultSubtype: null,
      events: [],
      parked: {
        askUserInput: { questions: [] } as any,
        toolUseId: null,
      },
    };
    const runner = runPhaseWithFixture(phaseConfig, parkedFixture, store);
    await expect(
      runner({
        phaseName: "planner",
        prompt: "p",
        schema: z.object({}).passthrough(),
        allowedTools: [],
      }),
    ).rejects.toThrow(/paused for user input|not supported/);
  });

  test("status=error → throws with the error string preserved", async () => {
    const store = new MockStateStore(minimalState());
    const errorFixture: PhaseRunResult<unknown> = {
      sessionId: "s-err",
      status: "error",
      error: "SDK blew up",
      structuredOutput: null,
      resultSubtype: null,
      events: [],
    };
    const runner = runPhaseWithFixture(phaseConfig, errorFixture, store);
    await expect(
      runner({
        phaseName: "planner",
        prompt: "p",
        schema: z.object({}).passthrough(),
        allowedTools: [],
      }),
    ).rejects.toThrow(/SDK blew up/);
  });
});

describe("adaptRunPhase: StateStore writes", () => {
  test("single phase call writes phases[] entry and 2 history events", async () => {
    const store = new MockStateStore(minimalState());
    const runner = runPhaseWithFixture(
      phaseConfig,
      completedFixture("s1"),
      store,
    );
    await runner({
      phaseName: "planner",
      prompt: "test prompt",
      schema: z.object({}).passthrough(),
      allowedTools: [],
    });

    expect(store.phases()).toHaveLength(1);
    const phase = store.phases()[0]!;
    expect(phase.name).toBe("planner");
    expect(phase.status).toBe("completed");
    expect(phase.session_id).toBe("s1");
    expect(phase.started_at).toBeTruthy();
    expect(phase.ended_at).toBeTruthy();

    const history = store.history();
    expect(history).toHaveLength(2);
    expect((history[0] as any).event).toBe("phase_start");
    expect((history[1] as any).event).toBe("phase_end");
  });

  test("two calls with same phase name + distinct attempts produce distinct rows", async () => {
    const store = new MockStateStore(minimalState());
    const runner = runPhaseWithFixture(
      phaseConfig,
      completedFixture("s2"),
      store,
    );
    await runner({
      phaseName: "developer",
      prompt: "attempt 1",
      schema: z.object({}).passthrough(),
      allowedTools: [],
      attempt: 1,
    });
    await runner({
      phaseName: "developer",
      prompt: "attempt 2",
      schema: z.object({}).passthrough(),
      allowedTools: [],
      attempt: 2,
    });

    expect(store.phases()).toHaveLength(2);
    expect(store.phases()[0]!.attempt).toBe(1);
    expect(store.phases()[1]!.attempt).toBe(2);

    const history = store.history();
    expect(history).toHaveLength(4);
    expect(history.map((h) => (h as any).event)).toEqual([
      "phase_start",
      "phase_end",
      "phase_start",
      "phase_end",
    ]);
  });

  test("call sequence on the store: appendPhase → appendHistory → updatePhase → appendHistory", async () => {
    const store = new MockStateStore(minimalState());
    const runner = runPhaseWithFixture(
      phaseConfig,
      completedFixture("s3"),
      store,
    );
    await runner({
      phaseName: "validator",
      prompt: "v",
      schema: z.object({}).passthrough(),
      allowedTools: [],
    });

    expect(store.callNames()).toEqual([
      "appendPhase",
      "appendHistory",
      "updatePhase",
      "appendHistory",
    ]);
  });
});
