import { expect, test } from "bun:test";
import { z } from "zod";
import { CodexProvider, type CodexInvocation } from "./codex.js";

test("CodexProvider normalizes structured output, session, usage and cwd", async () => {
  let invocation: CodexInvocation | undefined;
  const provider = new CodexProvider(async (value) => { invocation = value; return { exitCode: 0, stderr: "", lastMessage: JSON.stringify({ ok: true }), stdout: `${JSON.stringify({ type: "thread.started", thread_id: "thread-1" })}\n${JSON.stringify({ usage: { input_tokens: 4, output_tokens: 2 } })}\n` }; });
  const result = await provider.run({ cwd: "/repo", prompt: "go", systemPrompt: "system", schema: z.object({ ok: z.boolean() }), guards: ["read_only"] });
  expect(result.output).toEqual({ ok: true }); expect(result.session).toEqual({ id: "thread-1", provider: "codex" }); expect(result.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
  expect(invocation?.cwd).toBe("/repo"); expect(invocation?.readOnly).toBe(true); expect(invocation?.prompt).toContain("system\n\ngo");
});

test("CodexProvider resumes and rejects foreign sessions", async () => {
  let invocation: CodexInvocation | undefined; const provider = new CodexProvider(async (value) => { invocation = value; return { exitCode: 0, stdout: "", stderr: "", lastMessage: "{}" }; });
  await provider.resume!({ id: "thread", provider: "codex" }, { cwd: "/repo", prompt: "again", schema: z.object({}) }); expect(invocation?.resumeSessionId).toBe("thread");
  expect(provider.resume!({ id: "x", provider: "claude" }, { cwd: "/repo", prompt: "bad", schema: z.object({}) })).rejects.toThrow("cannot resume");
});

test("CodexProvider advertises missing guards and surfaces CLI/schema errors", async () => {
  const failed = new CodexProvider(async () => ({ exitCode: 7, stdout: "", stderr: "auth failed", lastMessage: "" })); expect(failed.capabilities.toolGuards).toBe(false);
  expect(failed.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toThrow("auth failed");
  const malformed = new CodexProvider(async () => ({ exitCode: 0, stdout: "", stderr: "", lastMessage: "not-json" })); expect(malformed.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toThrow("invalid structured output");
});

test("CodexProvider observes cancellation", async () => {
  const provider = new CodexProvider(async () => await new Promise(() => {})); const controller = new AbortController(); const result = provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}), signal: controller.signal }); controller.abort(new Error("cancelled")); expect(result).rejects.toThrow("cancelled");
});
