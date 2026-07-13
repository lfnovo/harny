import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { State } from "../schema.js";
import { normalizeV2Run, normalizeV3Run } from "./reader.js";
import { FilesystemRunStoreV3 } from "./store.js";
import type { RunV3 } from "./schema.js";

function snapshot(cwd: string): RunV3 { const now = new Date().toISOString(); return { schema_version: 3, run: { id: "run-3", task_slug: "task", workflow: "feature-dev", status: "running", started_at: now, ended_at: null, ended_reason: null, pid: 1, parent_run_id: null }, origin: { prompt: "build", workflow_source: "bundled", cwd, host: "host", user: "user" }, workspace: { isolation: "inline", primary_cwd: cwd, cwd, branch: "harny/test", worktree_path: null, reserved: true }, nodes: {}, artifacts: {}, changesets: {}, deliverables: [], pending_human: null }; }

test("v3 store atomically snapshots and appends audit events", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "harny-v3-")); const store = new FilesystemRunStoreV3(cwd, "task"); const initial = snapshot(cwd);
  await store.create(initial); await store.mutate((run) => { run.run.status = "done"; run.run.ended_at = new Date().toISOString(); }, { type: "run.completed" });
  expect((await store.load())?.run.status).toBe("done"); expect((await store.events()).map((event) => event.type)).toEqual(["run.created", "run.completed"]);
});

test("historical reader marks v2 read-only and v3 resumable", () => {
  const cwd = "/repo"; const v3 = normalizeV3Run(snapshot(cwd));
  const v2raw = { schema_version: 2, run_id: "run-2", origin: { prompt: "x", workflow: "feature-dev", task_slug: "x", started_at: "now", host: "h", user: "u", features: null }, environment: { cwd, branch: "b", isolation: "inline", worktree_path: null, mode: "silent" }, lifecycle: { status: "done", current_phase: null, ended_at: "later", ended_reason: "done", pid: 1 }, phases: [], history: [], pending_question: null, workflow_state: {}, workflow_chosen: null } satisfies State;
  expect(normalizeV2Run(v2raw).resumable).toBe(false); expect(v3.resumable).toBe(true);
});
