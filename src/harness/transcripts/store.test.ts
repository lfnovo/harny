import { afterEach, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TranscriptStore } from "./store.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });

async function store() { root = await mkdtemp(join(tmpdir(), "harny-transcript-")); return new TranscriptStore(root, "run"); }

test("appends typed records and reads incrementally", async () => {
  const value = await store(); const ref = { instanceId: "planner", attempt: 1 };
  await value.append(ref, "claude", { type: "message", role: "assistant", text: "olá" });
  await value.append(ref, "claude", { type: "reasoning", text: "checking" });
  expect((await value.read(ref, { after: 0, limit: 1 })).events.map((event) => event.seq)).toEqual([1]);
  const tail = await value.read(ref, { after: 1 });
  expect(tail.events).toMatchObject([{ seq: 2, provider: "claude", event: { type: "reasoning" } }]);
  expect(tail.nextAfter).toBe(2);
});

test("uses nested paths for foreach instances and rejects traversal", async () => {
  const value = await store(); const ref = { instanceId: "tasks:2:developer", attempt: 3 };
  await value.append(ref, "codex", { type: "tool", id: "c", name: "shell", kind: "command", status: "completed", input: { command: "true" }, output: "ok" });
  expect(value.path(ref)).toEndWith("transcripts/tasks/2/developer/attempt-3.jsonl");
  expect(() => value.path({ instanceId: "../secret", attempt: 1 })).toThrow("invalid transcript instance id");
  expect(() => value.path({ instanceId: "tasks:0:../secret", attempt: 1 })).toThrow("invalid transcript instance id");
});

test("ignores an incomplete final line but rejects completed corruption", async () => {
  const value = await store(); const ref = { instanceId: "planner", attempt: 1 }; const path = value.path(ref);
  await value.append(ref, "claude", { type: "message", role: "assistant", text: "safe" });
  await appendFile(path, "{partial", "utf8");
  expect((await value.read(ref)).events).toHaveLength(1);
  await writeFile(path, "not-json\n", "utf8");
  await expect(value.read(ref)).rejects.toThrow("invalid transcript record at line 1");
});

test("recovers appends after a torn final record", async () => {
  const value = await store(); const ref = { instanceId: "planner", attempt: 1 }; const path = value.path(ref);
  await value.append(ref, "claude", { type: "message", role: "assistant", text: "first" }); await appendFile(path, "{partial", "utf8");
  const recovered = new TranscriptStore(root, "run"); await recovered.append(ref, "claude", { type: "message", role: "assistant", text: "second" });
  expect((await recovered.read(ref)).events.map((record) => record.event.type === "message" ? record.event.text : "")).toEqual(["first", "second"]);
});

test("rejects payloads that cannot round-trip as JSON", async () => { const value = await store(); await expect(value.append({ instanceId: "agent", attempt: 1 }, "codex", { type: "tool", id: "x", name: "tool", kind: "tool", status: "completed", output: 1n } as never)).rejects.toThrow(); });

test("keeps complete large tool payloads", async () => {
  const value = await store(); const ref = { instanceId: "agent", attempt: 1 }; const output = "x".repeat(300_000);
  await value.append(ref, "codex", { type: "tool", id: "tool", name: "shell", kind: "command", status: "completed", output });
  expect((await value.read(ref)).events[0]?.event).toMatchObject({ type: "tool", output });
});
