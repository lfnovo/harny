import { expect, test } from "bun:test";
import { z } from "zod";
import { ClaudeProvider } from "./claude.js";
import type { AgentEvent } from "../transcripts/types.js";

test("ClaudeProvider normalizes output and session", async () => {
  let received: any;
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async (args: any) => { received = args; return { sessionId: "s1", status: "completed", error: null, structuredOutput: { ok: true }, resultSubtype: "success", events: [] }; }) as any,
  });
  const result = await provider.run({ phase: "developer", taskId: "t1", cwd: "/repo/wt", prompt: "go", schema: z.object({ ok: z.boolean() }), guards: ["no_git_history", "no_forge_effects"], env: { TMPDIR: "/repo/scratch" } });
  expect(result.output).toEqual({ ok: true });
  expect(result.session).toEqual({ id: "s1", provider: "claude", connectionFingerprint: "claude:default" });
  expect(received.phaseCwd).toBe("/repo/wt");
  expect(received.guards.noGitHistory).toBe(true);
  expect(received.guards.noForgeEffects).toBe(true);
  expect(received.env.TMPDIR).toBe("/repo/scratch");
});

test("ClaudeProvider resumes only its own sessions", async () => {
  let resume: string | undefined;
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async (args: any) => { resume = args.resumeSessionId; return { sessionId: "s1", status: "completed", error: null, structuredOutput: {}, resultSubtype: "success", events: [] }; }) as any,
  });
  await provider.resume!({ id: "old", provider: "claude", connectionFingerprint: "claude:default" }, { cwd: "/repo", prompt: "again", schema: z.object({}) });
  expect(resume).toBe("old");
  expect(provider.resume!({ id: "x", provider: "codex", connectionFingerprint: "codex:default" }, { cwd: "/repo", prompt: "bad", schema: z.object({}) })).rejects.toThrow("cannot resume");
});

test("ClaudeProvider turns SDK errors into provider errors", async () => {
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async () => ({ sessionId: "", status: "error", error: "overloaded", structuredOutput: null, resultSubtype: null, events: [] })) as any,
  });
  expect(provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toThrow("overloaded");
});

test("ClaudeProvider preserves usage when an interactive request parks", async () => {
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async () => ({ sessionId: "parked", status: "paused_for_user_input", error: null, structuredOutput: null, resultSubtype: "error_during_execution", events: [], usage: { inputTokens: 12, outputTokens: 3, costUsd: 0.02 }, parked: { askUserInput: { questions: [{ question: "Choose?", header: "Choice", options: [{ label: "A", description: "A" }], multiSelect: false }] }, toolUseId: "tool" } })) as any,
  });
  expect(provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toMatchObject({ session: { id: "parked" }, metadata: { usage: { provider: "claude", inputTokens: 12, costUsd: 0.02 } } });
});

test("ClaudeProvider observes cancellation", async () => {
  const events: AgentEvent[] = [];
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo", runPhase: (() => new Promise(() => {})) as any }); const controller = new AbortController();
  const result = provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}), signal: controller.signal, onEvent: (event) => { events.push(event); } }); controller.abort(new Error("cancelled")); await expect(result).rejects.toThrow("cancelled");
  expect(events.at(-1)).toMatchObject({ type: "lifecycle", status: "cancelled", message: "cancelled" });
});

test("ClaudeProvider streams normalized messages, reasoning and tool payloads", async () => {
  const events: AgentEvent[] = [];
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async (args: any) => {
      await args.onMessage({ type: "system", subtype: "init", session_id: "claude-session" });
      await args.onMessage({ type: "assistant", message: { content: [
        { type: "thinking", thinking: "inspect the repository" },
        { type: "text", text: "I found it" },
        { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/repo/a.ts" } },
      ] } });
      await args.onMessage({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "full result" }] } });
      return { sessionId: "claude-session", status: "completed", error: null, structuredOutput: { ok: true }, resultSubtype: "success", usage: { inputTokens: 4, outputTokens: 2 } };
    }) as any,
  });
  await provider.run({ cwd: "/repo", prompt: "go", schema: z.object({ ok: z.boolean() }), onEvent: (event) => { events.push(event); } });
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "lifecycle", scope: "session", sessionId: "claude-session" }),
    expect.objectContaining({ type: "reasoning", text: "inspect the repository" }),
    expect.objectContaining({ type: "message", role: "assistant", text: "I found it" }),
    expect.objectContaining({ type: "tool", id: "tool-1", status: "started", input: { file_path: "/repo/a.ts" } }),
    expect.objectContaining({ type: "tool", id: "tool-1", status: "completed", output: "full result" }),
    expect.objectContaining({ type: "usage", usage: expect.objectContaining({ provider: "claude", inputTokens: 4 }) }),
  ]));
});
