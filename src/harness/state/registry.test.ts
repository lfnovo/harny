import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RunPointerSchema,
  deletePointer,
  listPointers,
  patchPointer,
  pointerFromState,
  pointerPath,
  registryDir,
  setRegistryDirForTesting,
  writePointer,
} from "./registry.js";
import { FilesystemStateStore } from "./filesystem.js";
import { listAllRuns, findRun } from "./filesystem.js";
import { pruneRegistry } from "../clean.js";
import type { State } from "./schema.js";

function minimalState(taskSlug: string, runId: string, cwd: string, startedAt: string): State {
  return {
    schema_version: 2,
    run_id: runId,
    origin: {
      prompt: "p",
      workflow: "w",
      task_slug: taskSlug,
      started_at: startedAt,
      host: "h",
      user: "u",
      features: null,
    },
    environment: {
      cwd,
      branch: "main",
      isolation: "inline",
      worktree_path: null,
      mode: "silent",
    },
    lifecycle: {
      status: "running",
      current_phase: null,
      ended_at: null,
      ended_reason: null,
      pid: 1,
    },
    phases: [],
    history: [],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
}

describe("registry: pointer I/O", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "harny-registry-"));
    setRegistryDirForTesting(dir);
  });

  afterEach(() => {
    setRegistryDirForTesting(null);
    rmSync(dir, { recursive: true, force: true });
  });

  test("pointerFromState extracts only the index fields", () => {
    const s = minimalState("slug-a", "run-a", "/cwd-a", "2026-01-01T00:00:00.000Z");
    const p = pointerFromState(s);
    expect(p).toEqual({
      schema_version: 1,
      run_id: "run-a",
      cwd: "/cwd-a",
      task_slug: "slug-a",
      workflow: "w",
      started_at: "2026-01-01T00:00:00.000Z",
      status: "running",
      ended_at: null,
    });
    expect(RunPointerSchema.safeParse(p).success).toBe(true);
  });

  test("writePointer round-trips through listPointers", async () => {
    await writePointer(minimalState("a", "r1", "/c1", "2026-01-01T00:00:00.000Z"));
    await writePointer(minimalState("b", "r2", "/c2", "2026-01-02T00:00:00.000Z"));
    const ps = await listPointers();
    const ids = ps.map((p) => p.run_id).sort();
    expect(ids).toEqual(["r1", "r2"]);
  });

  test("patchPointer updates status and ended_at", async () => {
    await writePointer(minimalState("a", "r1", "/c1", "2026-01-01T00:00:00.000Z"));
    await patchPointer("r1", { status: "done", ended_at: "2026-01-01T01:00:00.000Z" });
    const raw = await readFile(pointerPath("r1"), "utf8");
    const parsed = RunPointerSchema.parse(JSON.parse(raw));
    expect(parsed.status).toBe("done");
    expect(parsed.ended_at).toBe("2026-01-01T01:00:00.000Z");
  });

  test("patchPointer on missing pointer is a silent no-op", async () => {
    await patchPointer("does-not-exist", { status: "done", ended_at: null });
    expect(existsSync(pointerPath("does-not-exist"))).toBe(false);
  });

  test("listPointers skips malformed entries", async () => {
    writeFileSync(join(dir, "garbage.json"), "{ not valid json");
    writeFileSync(join(dir, "wrong-shape.json"), JSON.stringify({ foo: "bar" }));
    await writePointer(minimalState("a", "good", "/c", "2026-01-01T00:00:00.000Z"));
    const ps = await listPointers();
    expect(ps.map((p) => p.run_id)).toEqual(["good"]);
  });

  test("deletePointer removes the file", async () => {
    await writePointer(minimalState("a", "r1", "/c1", "2026-01-01T00:00:00.000Z"));
    expect(existsSync(pointerPath("r1"))).toBe(true);
    await deletePointer("r1");
    expect(existsSync(pointerPath("r1"))).toBe(false);
  });

  test("registryDir respects the override", () => {
    expect(registryDir()).toBe(dir);
  });

  test("pointerPath rejects path-traversal in run_id", () => {
    expect(() => pointerPath("../escape")).toThrow();
    expect(() => pointerPath("foo/bar")).toThrow();
    expect(() => pointerPath("with space")).toThrow();
    // UUID-style is accepted
    expect(() => pointerPath("550e8400-e29b-41d4-a716-446655440000")).not.toThrow();
  });
});

describe("FilesystemStateStore: pointer integration", () => {
  let registry: string;
  let cwd: string;

  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), "harny-registry-"));
    cwd = mkdtempSync(join(tmpdir(), "harny-cwd-"));
    setRegistryDirForTesting(registry);
  });

  afterEach(() => {
    setRegistryDirForTesting(null);
    rmSync(registry, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  test("createRun writes a pointer to the registry", async () => {
    const store = new FilesystemStateStore(cwd, "task-x");
    const s = minimalState("task-x", "run-x", cwd, "2026-01-01T00:00:00.000Z");
    await store.createRun(s);
    const ps = await listPointers();
    expect(ps.length).toBe(1);
    expect(ps[0]!.run_id).toBe("run-x");
    expect(ps[0]!.cwd).toBe(cwd);
  });

  test("updateLifecycle propagates status and ended_at to the pointer", async () => {
    const store = new FilesystemStateStore(cwd, "task-x");
    await store.createRun(minimalState("task-x", "run-x", cwd, "2026-01-01T00:00:00.000Z"));
    await store.updateLifecycle({ status: "done", ended_at: "2026-01-01T02:00:00.000Z" });
    const ps = await listPointers();
    expect(ps[0]!.status).toBe("done");
    expect(ps[0]!.ended_at).toBe("2026-01-01T02:00:00.000Z");
  });
});

describe("discovery via registry", () => {
  let registry: string;
  let cwdA: string;
  let cwdB: string;

  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), "harny-registry-"));
    cwdA = mkdtempSync(join(tmpdir(), "harny-cwd-a-"));
    cwdB = mkdtempSync(join(tmpdir(), "harny-cwd-b-"));
    setRegistryDirForTesting(registry);
  });

  afterEach(() => {
    setRegistryDirForTesting(null);
    rmSync(registry, { recursive: true, force: true });
    rmSync(cwdA, { recursive: true, force: true });
    rmSync(cwdB, { recursive: true, force: true });
  });

  test("listAllRuns aggregates across cwds via pointers, sorted desc", async () => {
    const a = new FilesystemStateStore(cwdA, "old");
    const b = new FilesystemStateStore(cwdB, "new");
    await a.createRun(minimalState("old", "r-old", cwdA, "2026-01-01T00:00:00.000Z"));
    await b.createRun(minimalState("new", "r-new", cwdB, "2026-02-01T00:00:00.000Z"));

    const runs = await listAllRuns();

    expect(runs.map((r) => r.run_id)).toEqual(["r-new", "r-old"]);
  });

  test("findRun by id-prefix loads the right state.json", async () => {
    const a = new FilesystemStateStore(cwdA, "slug-a");
    await a.createRun(minimalState("slug-a", "run-abcdef123456", cwdA, "2026-01-01T00:00:00.000Z"));
    const found = await findRun("run-abcd");
    expect(found?.run_id).toBe("run-abcdef123456");
    expect(found?.environment.cwd).toBe(cwdA);
  });

  test("findRun by task_slug falls through correctly", async () => {
    const a = new FilesystemStateStore(cwdA, "named-slug");
    await a.createRun(minimalState("named-slug", "run-xyz", cwdA, "2026-01-01T00:00:00.000Z"));
    const found = await findRun("named-slug");
    expect(found?.run_id).toBe("run-xyz");
  });

  test("findRun returns null when pointer is present but state.json is gone", async () => {
    // Write only a pointer, no state.json behind it.
    await writePointer(minimalState("ghost", "run-ghost", "/nonexistent/cwd-ghost", "2026-01-01T00:00:00.000Z"));
    const found = await findRun("run-ghost");
    expect(found).toBeNull();
  });

  test("findRun keeps scanning when a matching pointer is stale", async () => {
    // Write a pointer that points at a missing state.json, then a second one
    // for the same id-prefix that is reachable. findRun must skip the stale
    // entry and return the reachable one.
    await writePointer(
      minimalState("ghost", "abcd1234aa", "/nonexistent/ghost", "2026-01-01T00:00:00.000Z"),
    );
    const reachable = new FilesystemStateStore(cwdA, "real");
    await reachable.createRun(
      minimalState("real", "abcd1234bb", cwdA, "2026-01-01T00:00:00.000Z"),
    );

    const found = await findRun("abcd1234");

    expect(found?.run_id).toBe("abcd1234bb");
  });

  test("pruneRegistry removes pointers whose state.json is unreachable", async () => {
    const a = new FilesystemStateStore(cwdA, "real");
    await a.createRun(minimalState("real", "run-real", cwdA, "2026-01-01T00:00:00.000Z"));
    await writePointer(minimalState("ghost", "run-ghost", "/nonexistent/cwd-ghost", "2026-01-01T00:00:00.000Z"));

    const removed = await pruneRegistry(false);

    expect(removed).toBe(1);
    const remaining = (await listPointers()).map((p) => p.run_id);
    expect(remaining).toEqual(["run-real"]);
  });
});
