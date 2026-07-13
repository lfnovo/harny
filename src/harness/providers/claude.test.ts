import { expect, test } from "bun:test";
import { z } from "zod";
import { ClaudeProvider } from "./claude.js";

test("ClaudeProvider normalizes output and session", async () => {
  let received: any;
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async (args: any) => { received = args; return { sessionId: "s1", status: "completed", error: null, structuredOutput: { ok: true }, resultSubtype: "success", events: [] }; }) as any,
  });
  const result = await provider.run({ phase: "developer", taskId: "t1", cwd: "/repo/wt", prompt: "go", schema: z.object({ ok: z.boolean() }), guards: ["no_git_history", "no_forge_effects"] });
  expect(result.output).toEqual({ ok: true });
  expect(result.session).toEqual({ id: "s1", provider: "claude" });
  expect(received.phaseCwd).toBe("/repo/wt");
  expect(received.guards.noGitHistory).toBe(true);
  expect(received.guards.noForgeEffects).toBe(true);
});

test("ClaudeProvider resumes only its own sessions", async () => {
  let resume: string | undefined;
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async (args: any) => { resume = args.resumeSessionId; return { sessionId: "s1", status: "completed", error: null, structuredOutput: {}, resultSubtype: "success", events: [] }; }) as any,
  });
  await provider.resume!({ id: "old", provider: "claude" }, { cwd: "/repo", prompt: "again", schema: z.object({}) });
  expect(resume).toBe("old");
  expect(provider.resume!({ id: "x", provider: "codex" }, { cwd: "/repo", prompt: "bad", schema: z.object({}) })).rejects.toThrow("cannot resume");
});

test("ClaudeProvider turns SDK errors into provider errors", async () => {
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo",
    runPhase: (async () => ({ sessionId: "", status: "error", error: "overloaded", structuredOutput: null, resultSubtype: null, events: [] })) as any,
  });
  expect(provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toThrow("overloaded");
});

test("ClaudeProvider observes cancellation", async () => {
  const provider = new ClaudeProvider({ workflowId: "flow", runId: "run", taskSlug: "task", primaryCwd: "/repo", runPhase: (() => new Promise(() => {})) as any }); const controller = new AbortController();
  const result = provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}), signal: controller.signal }); controller.abort(new Error("cancelled")); expect(result).rejects.toThrow("cancelled");
});
