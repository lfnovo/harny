import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { fakeSessionRunner } from "./fakeSessionRunner.js";
import type { PhaseRunResult } from "../sessionRecorder.js";
import type { SessionRunPhase } from "../engine/runtime/runPhaseAdapter.js";
import type { ResolvedPhaseConfig } from "../types.js";

function result(sessionId: string, output: unknown): PhaseRunResult<unknown> {
  return {
    sessionId,
    status: "completed",
    error: null,
    structuredOutput: output,
    resultSubtype: null,
    events: [],
  };
}

// Minimal args matching SessionRunPhase's parameter shape — the runner only
// inspects .phase in the by-phase variant, the rest is ceremonial.
function callArgs(phase: string): Parameters<SessionRunPhase>[0] {
  return {
    phase,
    phaseConfig: {} as ResolvedPhaseConfig,
    primaryCwd: "/tmp",
    phaseCwd: "/tmp",
    taskSlug: "t",
    harnessTaskId: null,
    prompt: "",
    outputSchema: z.unknown(),
    workflowId: "w",
    runId: "r",
  };
}

describe("fakeSessionRunner: array form", () => {
  test("returns scripted results in order", async () => {
    const run = fakeSessionRunner([
      result("s1", { n: 1 }),
      result("s2", { n: 2 }),
    ]);
    const a = await run(callArgs("planner"));
    const b = await run(callArgs("developer"));
    expect(a.sessionId).toBe("s1");
    expect(b.sessionId).toBe("s2");
  });

  test("throws on exhaustion by default", async () => {
    const run = fakeSessionRunner([result("s1", null)]);
    await run(callArgs("planner"));
    await expect(run(callArgs("developer"))).rejects.toThrow(
      /script exhausted/,
    );
  });

  test("wrapAround replays the last entry after exhaustion", async () => {
    const run = fakeSessionRunner(
      [result("s1", null), result("s-last", { final: true })],
      { wrapAround: true },
    );
    await run(callArgs("a"));
    const second = await run(callArgs("b"));
    const third = await run(callArgs("c"));
    expect(second.sessionId).toBe("s-last");
    expect(third.sessionId).toBe("s-last");
  });
});

describe("fakeSessionRunner: by-phase form", () => {
  test("routes by args.phase (not phaseName)", async () => {
    const run = fakeSessionRunner({
      planner: [result("plan-1", { tasks: [] })],
      developer: [result("dev-1", { status: "done" })],
      validator: [result("val-1", { verdict: "pass" })],
    });
    const p = await run(callArgs("planner"));
    const d = await run(callArgs("developer"));
    const v = await run(callArgs("validator"));
    expect(p.sessionId).toBe("plan-1");
    expect(d.sessionId).toBe("dev-1");
    expect(v.sessionId).toBe("val-1");
  });

  test("throws when no script entry for the phase", async () => {
    const run = fakeSessionRunner({ planner: [result("s", null)] });
    await expect(run(callArgs("developer"))).rejects.toThrow(
      /no script entry for phase "developer"/,
    );
  });

  test("throws when a phase's queue is drained", async () => {
    const run = fakeSessionRunner({ developer: [result("d1", null)] });
    await run(callArgs("developer"));
    await expect(run(callArgs("developer"))).rejects.toThrow(
      /no script entry for phase "developer"/,
    );
  });
});
