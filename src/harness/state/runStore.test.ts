import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunStore } from "./runStore.js";
import type { RunSnapshot } from "./runSchema.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ""; });
function snapshot(cwd: string): RunSnapshot { return { schema_version: 4, run: { id: "run-1", task_slug: "task", workflow: "test", started_at: "2026-01-01T00:00:00.000Z", ended_at: null, ended_reason: null, pid: 1, parent_run_id: null }, origin: { prompt: "x", workflow_source: "test", cwd, host: "h", user: "u" }, workspace: { isolation: "inline", primary_cwd: cwd, cwd, branch: "", worktree_path: null, reserved: true }, inputs: { value: 1 }, execution: { workflow: "test", status: "running", nodes: { work: { id: "work", status: "pending", attempts: 0 } } }, changesets: {} }; }

test("run store atomically persists the only scheduler snapshot and appends audit events", async () => { root = await mkdtemp(join(tmpdir(), "harny-run-")); const store = new RunStore(root, "task"); await store.create(snapshot(root)); await store.mutate((run) => { run.execution.nodes.work!.status = "completed"; run.execution.status = "done"; }, { type: "run.completed", node_id: "work" }); const loaded = await store.load(); expect(loaded?.execution.status).toBe("done"); expect(loaded?.execution.nodes.work?.status).toBe("completed"); expect((await store.events()).map((event) => event.type)).toEqual(["run.created", "run.completed"]); expect(JSON.parse(await readFile(store.runPath, "utf8")).artifacts).toBeUndefined(); });
test("run store rejects older schemas", async () => { root = await mkdtemp(join(tmpdir(), "harny-run-")); const store = new RunStore(root, "task"); await mkdir(join(root, ".harny", "task"), { recursive: true }); await writeFile(store.runPath, JSON.stringify({ schema_version: 3 })); await expect(store.load()).rejects.toThrow(); });
