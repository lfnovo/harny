import { describe, test, expect } from "bun:test";
import { MockStateStore } from "./mockStateStore.js";
import type { State, PhaseEntry } from "../state/schema.js";

function minimalState(): State {
  return {
    schema_version: 2,
    run_id: "test-run",
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

function phase(name: string, attempt: number): PhaseEntry {
  return {
    name,
    attempt,
    started_at: "2026-01-01T00:00:01.000Z",
    ended_at: null,
    status: "running",
    verdict: null,
    session_id: null,
  };
}

describe("MockStateStore: lifecycle", () => {
  test("createRun twice throws", async () => {
    const s = new MockStateStore();
    await s.createRun(minimalState());
    await expect(s.createRun(minimalState())).rejects.toThrow(/called twice/);
  });

  test("getState before createRun returns null", async () => {
    const s = new MockStateStore();
    expect(await s.getState()).toBeNull();
  });

  test("mutating methods before createRun throw", async () => {
    const s = new MockStateStore();
    await expect(s.appendPhase(phase("p", 1))).rejects.toThrow(
      /before createRun/,
    );
  });

  test("constructor-provided state skips createRun requirement", async () => {
    const s = new MockStateStore(minimalState());
    await s.appendPhase(phase("planner", 1));
    expect(s.phases()).toHaveLength(1);
  });
});

describe("MockStateStore: call recording", () => {
  test("calls[] records every op in order", async () => {
    const s = new MockStateStore();
    await s.createRun(minimalState());
    await s.appendPhase(phase("planner", 1));
    await s.updatePhase("planner", 1, { status: "completed" });
    await s.appendHistory({
      at: "2026-01-01T00:00:02.000Z",
      phase: "planner",
      event: "phase_end",
    });
    expect(s.callNames()).toEqual([
      "createRun",
      "appendPhase",
      "updatePhase",
      "appendHistory",
    ]);
  });

  test("state clone isolates getState() from direct mutation", async () => {
    const s = new MockStateStore(minimalState());
    const snapshot = await s.getState();
    snapshot!.phases.push(phase("x", 1));
    expect(s.phases()).toHaveLength(0);
  });
});

describe("MockStateStore: invariants mirror FilesystemStateStore", () => {
  test("updatePhase with (name, attempt) not found throws", async () => {
    const s = new MockStateStore(minimalState());
    await expect(
      s.updatePhase("nonexistent", 1, { status: "completed" }),
    ).rejects.toThrow(/no phase entry/);
  });

  test("updatePhase matches the last-appended entry with the same (name, attempt)", async () => {
    const s = new MockStateStore(minimalState());
    await s.appendPhase(phase("dev", 1));
    await s.appendPhase(phase("dev", 2));
    await s.updatePhase("dev", 2, { status: "completed" });
    expect(s.phases()[1]!.status).toBe("completed");
    expect(s.phases()[0]!.status).toBe("running");
  });

  test("updateLifecycle merges patch (does not replace)", async () => {
    const s = new MockStateStore(minimalState());
    await s.updateLifecycle({ status: "done" });
    expect(s.state!.lifecycle.status).toBe("done");
    expect(s.state!.lifecycle.pid).toBe(1);
  });
});
