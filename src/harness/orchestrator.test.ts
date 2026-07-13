import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runHarness } from "./orchestrator.js";
import { tmpGitRepo } from "./testing/index.js";
import type { AgentProvider, AgentRequest, AgentResult } from "./providers/types.js";
import { setRegistryDirForTesting } from "./state/registry.js";
import { handleAnswer } from "../runner/answer.js";
import { RunStore } from "./state/runStore.js";
import { MockGitOps } from "./testing/mockGitOps.js";
import { z } from "zod";
import { schemaFromDefinition } from "./workflow/outputSchema.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { setRegistryDirForTesting(null); while (cleanups.length) await cleanups.pop()!().catch(() => {}); });

class Provider implements AgentProvider {
  id = "claude"; connectionFingerprint = "claude:test"; capabilities = { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true };
  async run<T>(request: AgentRequest<T>): Promise<AgentResult<T>> { await request.onEvent?.({ type: "message", role: "assistant", text: `${request.phase} event` }); let output: unknown; if (request.phase === "planner") output = { summary: "test", tasks: [{ id: "t1", title: "Build", description: "Build", acceptance: ["works"] }] }; else if (request.phase === "developer") { writeFileSync(join(request.cwd, "built.txt"), "done\n"); output = { status: "done", summary: "done", commit_message: "feat: build" }; } else if (request.phase === "writer") output = { message: "written" }; else output = { verdict: "pass", reasons: ["AC1: pass"] }; return { output: request.schema.parse(output), session: { id: `${request.phase}-session`, provider: this.id, connectionFingerprint: this.connectionFingerprint }, usage: { provider: this.id, model: "test-model", inputTokens: 10, outputTokens: 2, costUsd: 0.01 } }; }
}

async function repo() { const value = await tmpGitRepo({ seed: {} }); cleanups.push(value.cleanup); return value; }
async function commit(cwd: string, path: string, message = "workflow") { for (const args of [["add", path], ["commit", "-m", message]]) { const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" }); expect(await proc.exited).toBe(0); } }

test("feature-dev uses one authoritative v4 scheduler snapshot", async () => {
  const r = await repo(); const result = await runHarness({ cwd: r.path, userPrompt: "build", taskSlug: "default", isolation: "inline", mode: "silent", logMode: "quiet", agentProvider: new Provider() });
  expect(result.status).toBe("done"); expect(result.state?.schema_version).toBe(4); expect(result.state?.inputs.base).toBeUndefined(); expect(result.state?.execution.nodes.planner?.output).toBeDefined(); expect(result.state?.execution.nodes.planner?.attemptHistory?.[0]?.usage).toMatchObject({ provider: "claude", inputTokens: 10, costUsd: 0.01 }); expect(result.state?.execution.nodes.tasks?.steps?.["0.commit"]?.status).toBe("completed"); expect(statSync(join(r.path, ".harny/default/run.json")).isFile()).toBe(true); expect(existsSync(join(r.path, ".harny/default/state.json"))).toBe(false); expect(existsSync(join(r.path, ".harny/default/plan.json"))).toBe(false);
  const plannerTranscript = readFileSync(join(r.path, ".harny/default/transcripts/planner/attempt-1.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const developerTranscript = readFileSync(join(r.path, ".harny/default/transcripts/tasks/0/developer/attempt-1.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  expect(plannerTranscript.map((record) => record.event.type)).toEqual(["request", "message"]);
  expect(developerTranscript.at(-1)?.event).toMatchObject({ type: "message", text: "developer event" });
});

test("async human pause and answer use the same declarative path", async () => {
  const r = await repo(); setRegistryDirForTesting(join(r.path, "registry")); const path = join(r.path, "human.yaml"); writeFileSync(path, `version: 2\nname: human\ndefaults: { provider: claude, timeout: 60000 }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: approval, type: human, question: "Approve?", timeout: 60000 }\n  - { id: finish, type: command, command: [touch, answered.txt], depends_on: [approval] }\n`); await commit(r.path, "human.yaml");
  const parked = await runHarness({ cwd: r.path, userPrompt: "approve", workflowId: path, taskSlug: "human", mode: "async", logMode: "quiet" }); expect(parked.status).toBe("waiting_human"); expect(parked.state?.execution.pendingHuman?.question).toBe("Approve?"); await handleAnswer({ kind: "answer", runId: parked.state!.run.id, text: "yes" }); const final = await new RunStore(r.path, "human").load(); expect(final?.execution.status).toBe("done"); expect(existsSync(join(r.path, "answered.txt"))).toBe(true);
});

test("expired human fallback resumes logically", async () => {
  const r = await repo(); setRegistryDirForTesting(join(r.path, "registry")); const path = join(r.path, "fallback.yaml"); writeFileSync(path, `version: 2\nname: fallback\ndefaults: { provider: claude }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: approval, type: human, question: "Approve?", timeout: 1, fallback: continue }\n  - { id: finish, type: command, command: [touch, fallback.txt], depends_on: [approval] }\n`); await commit(r.path, "fallback.yaml"); const parked = await runHarness({ cwd: r.path, userPrompt: "fallback", workflowId: path, taskSlug: "fallback", mode: "async", logMode: "quiet" }); await new Promise((resolve) => setTimeout(resolve, 5)); await handleAnswer({ kind: "answer", runId: parked.state!.run.id }); expect((await new RunStore(r.path, "fallback").load())?.execution.status).toBe("done");
});

test("custom command and agent workflows share the runtime", async () => {
  const r = await repo(); mkdirSync(join(r.path, ".harny/commands"), { recursive: true }); writeFileSync(join(r.path, ".harny/commands/write.md"), "Return a message"); const path = join(r.path, "custom.yaml"); writeFileSync(path, `version: 2\nname: custom\ndefaults: { provider: claude }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: create, type: command, command: [touch, custom.txt] }\n  - { id: writer, type: agent, command: write, depends_on: [create], output_schema: { type: object, properties: { message: { type: string } }, required: [message] } }\n`); await commit(r.path, "."); const result = await runHarness({ cwd: r.path, userPrompt: "run", workflowId: path, taskSlug: "custom", isolation: "inline", mode: "silent", logMode: "quiet", agentProvider: new Provider() }); expect(result.status).toBe("done"); expect(result.state?.execution.nodes.writer?.output).toMatchObject({ message: "written" });
});

test("generic agent output schemas become strict provider-compatible JSON schemas", () => {
  const schema = schemaFromDefinition({
    type: "object",
    properties: { message: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
    required: ["message", "tags"],
  });
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  expect(json.propertyNames).toBeUndefined();
  expect(json.additionalProperties).toBe(false);
  expect(json.required).toEqual(["message", "tags"]);
  expect(schema.parse({ message: "written", tags: ["dogfood"] })).toEqual({ message: "written", tags: ["dogfood"] });
  expect(schema.safeParse({ message: "missing tags" }).success).toBe(false);
});

test("provider capability validation happens before Git effects", async () => {
  const r = await repo(); const path = join(r.path, "unsafe.yaml"); writeFileSync(path, `version: 2\nname: unsafe\ndefaults: { provider: codex }\nworkspace: { isolation: worktree }\noutcome: { type: none }\nnodes:\n  - { id: agent, type: agent, command: work, requires: [structured_output, tool_guards] }\n`); const git = new MockGitOps(); await expect(runHarness({ cwd: r.path, userPrompt: "x", workflowId: path, taskSlug: "unsafe", gitOps: git })).rejects.toThrow("unsupported capability tool_guards"); expect(git.calls).toHaveLength(0);
});

test("rejects malformed explicit base inputs before persisting a run", async () => {
  const r = await repo();
  await expect(runHarness({ cwd: r.path, userPrompt: "x", taskSlug: "bad-base", inputs: { base: null } as never, isolation: "inline", mode: "silent", logMode: "quiet", agentProvider: new Provider() })).rejects.toThrow("inputs.base must be a non-empty branch name");
  expect(existsSync(join(r.path, ".harny/bad-base/run.json"))).toBe(false);
});

test("trims an explicit base input before persisting it", async () => {
  const r = await repo();
  const result = await runHarness({ cwd: r.path, userPrompt: "x", workflowId: await commandWorkflow(r.path), taskSlug: "trim-base", inputs: { base: " main " }, isolation: "inline", mode: "silent", logMode: "quiet", agentProvider: new Provider() });
  expect(result.state?.inputs.base).toBe("main");
});

test("dead v4 pid materializes a terminal failure", async () => {
  const r = await repo(); const first = await runHarness({ cwd: r.path, userPrompt: "run", workflowId: await commandWorkflow(r.path), taskSlug: "dead", isolation: "inline", mode: "silent", logMode: "quiet" }); const store = new RunStore(r.path, "dead"); await store.mutate((run) => { run.execution.status = "running"; run.run.pid = 99999999; run.run.ended_at = null; }); const result = await runHarness({ cwd: r.path, userPrompt: "again", taskSlug: "dead", mode: "silent", logMode: "quiet" }); expect(first.status).toBe("done"); expect(result.status).toBe("failed"); expect(result.state?.run.ended_reason).toContain("process exited unexpectedly");
});

async function commandWorkflow(cwd: string) { const path = join(cwd, "noop.yaml"); writeFileSync(path, `version: 2\nname: noop\ndefaults: { provider: claude }\nworkspace: { isolation: inline }\noutcome: { type: none }\nnodes:\n  - { id: ok, type: command, command: ["true"] }\n`); await commit(cwd, "noop.yaml"); return path; }
