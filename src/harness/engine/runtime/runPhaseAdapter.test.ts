import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { runPhaseWithFixture } from "../../testing/index.js";
import { MockStateStore } from "../../testing/mockStateStore.js";
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
