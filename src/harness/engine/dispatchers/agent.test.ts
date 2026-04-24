import { describe, test, expect } from "bun:test";
import { runAgent } from "./agent.js";
import type { AgentRunOptions } from "../types.js";

function baseOptions(
  runPhase: AgentRunOptions["runPhase"],
  overrides?: Partial<AgentRunOptions>,
): AgentRunOptions {
  return {
    phaseName: "test-phase",
    prompt: "test prompt",
    schema: { type: "object" } as any,
    allowedTools: [],
    runPhase,
    ...overrides,
  };
}

describe("runAgent: happy path", () => {
  test("resolves with the runPhase output + session_id", async () => {
    const controller = new AbortController();
    const expected = { output: { ok: true }, session_id: "sess-1" };
    const result = await runAgent(
      baseOptions(() => Promise.resolve(expected)),
      controller.signal,
    );
    expect((result as any).session_id).toBe("sess-1");
    expect((result as any).output?.ok).toBe(true);
  });

  test("resumeSessionId is threaded to runPhase", async () => {
    const controller = new AbortController();
    let receivedResumeId: string | undefined;
    const runPhase: AgentRunOptions["runPhase"] = (args) => {
      receivedResumeId = args.resumeSessionId;
      return Promise.resolve({ output: { resumed: true }, session_id: "sess-2" });
    };
    await runAgent(
      baseOptions(runPhase, { resumeSessionId: "prev-sess" }),
      controller.signal,
    );
    expect(receivedResumeId).toBe("prev-sess");
  });
});

describe("runAgent: abort + error propagation", () => {
  test("AbortController fires → rejects with 'aborted'", async () => {
    const controller = new AbortController();
    const runPhase: AgentRunOptions["runPhase"] = ({ signal }) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("inner aborted")));
      });
    setTimeout(() => controller.abort(), 50);
    await expect(
      runAgent(baseOptions(runPhase), controller.signal),
    ).rejects.toThrow(/aborted/);
  });

  test("runPhase rejection is propagated with original message", async () => {
    const controller = new AbortController();
    const runPhase: AgentRunOptions["runPhase"] = () =>
      Promise.reject(new Error("SDK boom"));
    await expect(
      runAgent(baseOptions(runPhase), controller.signal),
    ).rejects.toThrow(/SDK boom/);
  });
});
