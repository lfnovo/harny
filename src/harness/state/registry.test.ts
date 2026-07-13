import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deletePointer, listPointers, patchPointer, patchPointerIfStatus, pointerFromRun, pointerPath, setRegistryDirForTesting, writePointer } from "./registry.js";
import type { RunSnapshot } from "./runSchema.js";

let root = "";
afterEach(async () => { setRegistryDirForTesting(null); if (root) await rm(root, { recursive: true, force: true }); root = ""; });
function run(cwd: string): RunSnapshot { return { schema_version: 4, run: { id: "run-1", task_slug: "task", workflow: "test", started_at: "2026-01-01T00:00:00.000Z", ended_at: null, ended_reason: null, pid: 1, parent_run_id: null }, origin: { prompt: "x", workflow_source: "test", cwd, host: "h", user: "u" }, workspace: { isolation: "inline", primary_cwd: cwd, cwd, branch: "", worktree_path: null, reserved: true }, inputs: {}, execution: { workflow: "test", status: "running", nodes: {} }, changesets: {} }; }
test("registry indexes only v4 runs through a small rebuildable pointer", async () => { root = await mkdtemp(join(tmpdir(), "harny-reg-")); setRegistryDirForTesting(root); const value = run("/repo"); expect(pointerFromRun(value)).toMatchObject({ schema_version: 2, run_id: "run-1", status: "running" }); await writePointer(value); await patchPointer("run-1", { status: "done", ended_at: "now" }); expect(await listPointers()).toEqual([expect.objectContaining({ status: "done", ended_at: "now" })]); await deletePointer("run-1"); expect(await listPointers()).toEqual([]); });
test("pointer path rejects traversal", () => { expect(() => pointerPath("../escape")).toThrow("Invalid run_id"); });
test("conditional pointer updates do not overwrite a newer terminal state", async () => { root = await mkdtemp(join(tmpdir(), "harny-reg-")); setRegistryDirForTesting(root); const value = run("/repo"); await writePointer(value); await patchPointerIfStatus(value.run.id, "running", { status: "done", ended_at: "done" }); await patchPointerIfStatus(value.run.id, "paused", { status: "running", ended_at: null }); expect(await listPointers()).toEqual([expect.objectContaining({ status: "done", ended_at: "done" })]); });
