import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemStateStore, statePathFor } from "./filesystem.js";
import type { State, PhaseEntry } from "./schema.js";

const dirs: string[] = [];

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "harny-fs-store-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

function minimalState(taskSlug: string): State {
  return {
    schema_version: 2,
    run_id: `run-${taskSlug}`,
    origin: {
      prompt: "p",
      workflow: "w",
      task_slug: taskSlug,
      started_at: "2026-01-01T00:00:00.000Z",
      host: "h",
      user: "u",
      features: null,
    },
    environment: {
      cwd: "/tmp",
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

function phase(name: string, attempt: number): PhaseEntry {
  return {
    name,
    attempt,
    started_at: "2026-01-01T00:00:01.000Z",
    ended_at: null,
    status: "running",
    verdict: null,
    session_id: null,
  };
}

describe("FilesystemStateStore: createRun invariants", () => {
  test("writes state.json at the computed path", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-a");
    expect(store.statePath).toBe(statePathFor(cwd, "slug-a"));
    await store.createRun(minimalState("slug-a"));
    const loaded = await store.getState();
    expect(loaded?.run_id).toBe("run-slug-a");
  });

  test("createRun refuses to overwrite an existing state.json", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-b");
    await store.createRun(minimalState("slug-b"));
    await expect(store.createRun(minimalState("slug-b"))).rejects.toThrow(
      /already exists/,
    );
  });

  test("createRun validates the incoming state against the schema", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-c");
    const bogus = { ...minimalState("slug-c"), schema_version: 1 as unknown as 2 };
    await expect(store.createRun(bogus as State)).rejects.toThrow();
  });
});

describe("FilesystemStateStore: mutation before createRun", () => {
  test("updateLifecycle throws when state.json does not exist", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-d");
    await expect(
      store.updateLifecycle({ status: "done" }),
    ).rejects.toThrow(/createRun must be called first/);
  });

  test("appendPhase throws when state.json does not exist", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-e");
    await expect(store.appendPhase(phase("planner", 1))).rejects.toThrow(
      /createRun must be called first/,
    );
  });
});

describe("FilesystemStateStore: getState and schema validation", () => {
  test("getState returns null when state.json does not exist", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-f");
    expect(await store.getState()).toBeNull();
  });

  test("getState throws on corrupt state.json (invalid schema)", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-g");
    await store.createRun(minimalState("slug-g"));
    writeFileSync(store.statePath, JSON.stringify({ schema_version: 1 }));
    await expect(store.getState()).rejects.toThrow(/schema validation/);
  });
});

describe("FilesystemStateStore: mutations persist to disk", () => {
  test("appendPhase / updatePhase / appendHistory round-trip through disk", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-h");
    await store.createRun(minimalState("slug-h"));
    await store.appendPhase(phase("planner", 1));
    await store.appendHistory({
      at: "2026-01-01T00:00:02.000Z",
      phase: "planner",
      event: "phase_start",
    });
    await store.updatePhase("planner", 1, { status: "completed" });

    const raw = readFileSync(store.statePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0].status).toBe("completed");
    expect(parsed.history).toHaveLength(1);
    expect(parsed.history[0].event).toBe("phase_start");
  });

  test("updatePhase throws when (name, attempt) is absent", async () => {
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-i");
    await store.createRun(minimalState("slug-i"));
    await expect(
      store.updatePhase("nonexistent", 1, { status: "completed" }),
    ).rejects.toThrow(/No phase entry/);
  });
});

describe("FilesystemStateStore: writeJsonAtomic via a partial tmp file", () => {
  test("a leftover <path>.tmp does not appear at state.json after a successful write", async () => {
    // Writing .tmp then renaming is an implementation detail of writeJsonAtomic,
    // but its observable contract at the store level is: after createRun
    // succeeds, the real path exists, and no stray .tmp sits next to it.
    const cwd = tmp();
    const store = new FilesystemStateStore(cwd, "slug-j");
    await store.createRun(minimalState("slug-j"));
    await expect(
      (async () => readFileSync(`${store.statePath}.tmp`))(),
    ).rejects.toThrow();
  });
});
