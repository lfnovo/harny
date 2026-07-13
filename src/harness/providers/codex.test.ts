import { expect, test } from "bun:test";
import type { ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { CodexProvider, type CodexClient } from "./codex.js";
import type { AgentEvent } from "../transcripts/types.js";

type Run = { input: string; thread: ThreadOptions | undefined; turn: TurnOptions | undefined; resumed?: string };

function client(events: ThreadEvent[] | ((options: TurnOptions | undefined) => ThreadEvent[]), calls: Run[], id = "thread-1"): CodexClient {
  const thread = (options: ThreadOptions | undefined, resumed?: string) => ({
    id: resumed ?? id,
    async runStreamed(input: string, turn?: TurnOptions) {
      calls.push({ input, thread: options, turn, resumed });
      async function* stream() { for (const event of typeof events === "function" ? events(turn) : events) yield event; }
      return { events: stream() };
    },
  });
  return { startThread: (options) => thread(options), resumeThread: (sessionId, options) => thread(options, sessionId) };
}

const message = (text: string): ThreadEvent => ({ type: "item.completed", item: { id: "message", type: "agent_message", text } });
const usage: ThreadEvent = { type: "turn.completed", usage: { input_tokens: 7, cached_input_tokens: 3, output_tokens: 5, reasoning_output_tokens: 2 } };

test("CodexProvider uses the SDK and normalizes structured output, session and usage", async () => {
  const calls: Run[] = [];
  const provider = new CodexProvider({ client: client([message(JSON.stringify({ ok: true })), usage], calls), defaultModel: "gpt-test" });
  const result = await provider.run({ cwd: "/repo", prompt: "go", systemPrompt: "system", schema: z.object({ ok: z.boolean() }), guards: ["read_only"] });
  expect(result.output).toEqual({ ok: true });
  expect(result.session).toEqual({ id: "thread-1", provider: "codex", connectionFingerprint: "codex:default" });
  expect(result.usage).toEqual({ provider: "codex", model: "gpt-test", inputTokens: 7, outputTokens: 5, cacheReadInputTokens: 3, reasoningOutputTokens: 2 });
  expect(calls[0]?.thread).toMatchObject({ model: "gpt-test", workingDirectory: "/repo", sandboxMode: "read-only" });
  expect(calls[0]?.input).toBe("system\n\ngo");
  expect(calls[0]?.turn?.outputSchema).toBeDefined();
});

test("CodexProvider resumes only a matching provider connection", async () => {
  const calls: Run[] = [];
  const provider = new CodexProvider({ client: client([message("{}")], calls), connectionFingerprint: "configured" });
  await provider.resume!({ id: "thread", provider: "codex", connectionFingerprint: "configured" }, { cwd: "/repo", prompt: "again", schema: z.object({}) });
  expect(calls[0]?.resumed).toBe("thread");
  expect(provider.resume!({ id: "x", provider: "claude", connectionFingerprint: "configured" }, { cwd: "/repo", prompt: "bad", schema: z.object({}) })).rejects.toThrow("cannot resume");
  expect(provider.resume!({ id: "x", provider: "codex", connectionFingerprint: "old" }, { cwd: "/repo", prompt: "bad", schema: z.object({}) })).rejects.toThrow("connection changed");
});

test("CodexProvider surfaces stream and schema errors with partial metadata", async () => {
  const calls: Run[] = [];
  const failed = new CodexProvider({ client: client([{ type: "turn.failed", error: { message: "auth failed" } }, usage], calls) });
  expect(failed.capabilities.toolGuards).toBe(false);
  expect(failed.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toMatchObject({ message: "auth failed", metadata: { usage: { inputTokens: 7 } } });
  const malformed = new CodexProvider({ client: client([message("not-json")], []) });
  expect(malformed.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toThrow("invalid structured output");
});

test("CodexProvider preserves the specific streamed API error when the exec wrapper exits generically", async () => {
  const calls: Run[] = [];
  const specific: CodexClient = {
    startThread(options) {
      return {
        id: "thread-specific",
        async runStreamed(input, turn) {
          calls.push({ input, thread: options, turn });
          async function* events(): AsyncGenerator<ThreadEvent> {
            yield { type: "error", message: "invalid_json_schema: propertyNames is not permitted" };
            throw new Error("Codex Exec exited with code 1: Reading prompt from stdin");
          }
          return { events: events() };
        },
      };
    },
    resumeThread() { throw new Error("not used"); },
  };
  const provider = new CodexProvider({ client: specific });
  await expect(provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}) })).rejects.toThrow("invalid_json_schema: propertyNames is not permitted");
});

test("CodexProvider forwards cancellation to the SDK", async () => {
  const calls: Run[] = [];
  const provider = new CodexProvider({ client: client((turn) => { if (turn?.signal?.aborted) throw turn.signal.reason; return [message("{}")]; }, calls) });
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  const events: AgentEvent[] = [];
  await expect(provider.run({ cwd: "/repo", prompt: "go", schema: z.object({}), signal: controller.signal, onEvent: (event) => { events.push(event); } })).rejects.toThrow("cancelled");
  expect(events.at(-1)).toMatchObject({ type: "lifecycle", status: "cancelled" });
});

test("CodexProvider streams normalized lifecycle, reasoning, command and usage events", async () => {
  const calls: Run[] = []; const events: AgentEvent[] = [];
  const stream = [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    { type: "item.updated", item: { id: "reason-1", type: "reasoning", text: "inspect first" } },
    { type: "item.completed", item: { id: "command-1", type: "command_execution", command: "git status", aggregated_output: "clean", exit_code: 0, status: "completed" } },
    message(JSON.stringify({ ok: true })),
    usage,
  ] as ThreadEvent[];
  const provider = new CodexProvider({ client: client(stream, calls), defaultModel: "gpt-test" });
  await provider.run({ cwd: "/repo", prompt: "go", schema: z.object({ ok: z.boolean() }), onEvent: (event) => { events.push(event); } });
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "lifecycle", scope: "session", sessionId: "thread-1" }),
    expect.objectContaining({ type: "reasoning", text: "inspect first" }),
    expect.objectContaining({ type: "tool", id: "command-1", kind: "command", output: "clean" }),
    expect.objectContaining({ type: "message", text: JSON.stringify({ ok: true }) }),
    expect.objectContaining({ type: "usage", usage: expect.objectContaining({ provider: "codex", reasoningOutputTokens: 2 }) }),
  ]));
});

test("the pinned Codex SDK streams correctly under Bun and forwards compatible endpoint options", async () => {
  const root = await mkdtemp(join(tmpdir(), "harny-codex-sdk-"));
  const executable = join(root, "fake-codex");
  await writeFile(executable, `#!/usr/bin/env bun
const configured = process.argv.slice(2).some((value) => value.includes("openai_base_url") && value.includes("https://proxy.example/v1"));
if (!configured || process.env.CODEX_API_KEY !== "sdk-secret") process.exit(9);
console.log(JSON.stringify({ type: "thread.started", thread_id: "sdk-thread" }));
console.log(JSON.stringify({ type: "item.completed", item: { id: "message", type: "agent_message", text: JSON.stringify({ ok: true }) } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 4, cached_input_tokens: 1, output_tokens: 2, reasoning_output_tokens: 1 } }));
`);
  await chmod(executable, 0o755);
  try {
    const provider = new CodexProvider({ sdk: { codexPathOverride: executable, baseUrl: "https://proxy.example/v1", apiKey: "sdk-secret", env: { PATH: process.env.PATH ?? "" } } });
    const result = await provider.run({ cwd: root, prompt: "go", schema: z.object({ ok: z.boolean() }) });
    expect(result).toMatchObject({ output: { ok: true }, session: { id: "sdk-thread" }, usage: { inputTokens: 4, cacheReadInputTokens: 1, reasoningOutputTokens: 1 } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
