import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlan, savePlan, planFilePath } from "./plan.js";
import type { Plan } from "../types.js";

function validPlan(): Plan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    task_slug: "probe-slug",
    user_prompt: "do the thing",
    branch: "harny/probe-slug",
    primary_cwd: "/tmp/probe-cwd",
    isolation: "worktree",
    worktree_path: "/tmp/probe-cwd/.harny/worktrees/probe-slug",
    created_at: now,
    updated_at: now,
    status: "planning",
    summary: "test plan",
    iterations_global: 0,
    tasks: [
      {
        id: "t1",
        title: "first task",
        description: "do first thing",
        acceptance: ["it works"],
        status: "pending",
        attempts: 0,
        commit_sha: null,
        history: [],
      },
    ],
    metadata: {},
  };
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "harny-plan-test-"));
}

describe("plan persistence: round-trip", () => {
  test("save + load round-trip preserves shape", async () => {
    const dir = tmpDir();
    const path = planFilePath(dir, "probe-slug");
    await savePlan(path, validPlan());
    expect(existsSync(path)).toBe(true);
    const loaded = await loadPlan(path);
    expect(loaded.task_slug).toBe("probe-slug");
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]!.id).toBe("t1");
    expect(loaded.updated_at).toBeTruthy();
  });

  test("schema accepts a rich plan with metadata, multiple tasks, and passthrough history", async () => {
    const dir = tmpDir();
    const now = "2026-01-01T00:00:00.000Z";
    const plan: Plan = {
      task_slug: "rich",
      user_prompt: "complex thing",
      branch: "harny/rich",
      primary_cwd: dir,
      isolation: "inline",
      worktree_path: null,
      created_at: now,
      updated_at: now,
      status: "in_progress",
      summary: "rich summary",
      iterations_global: 2,
      tasks: [
        {
          id: "t1",
          title: "one",
          description: "d1",
          acceptance: ["a1", "a2"],
          status: "done",
          attempts: 1,
          commit_sha: "deadbeef",
          history: [
            { role: "developer", session_id: "sess1", at: now, extra: 42 },
          ],
          output: { foo: "bar" },
        },
        {
          id: "t2",
          title: "two",
          description: "d2",
          acceptance: ["a3"],
          status: "pending",
          attempts: 0,
          commit_sha: null,
          history: [],
        },
      ],
      run_id: "run-abc",
      metadata: { planner_session_id: "sess0", anything: { nested: true } },
    };
    const p = join(dir, "rich.json");
    await savePlan(p, plan);
    const loaded = await loadPlan(p);
    expect(loaded.tasks).toHaveLength(2);
    expect(loaded.tasks[0]!.status).toBe("done");
    expect((loaded.metadata as any).planner_session_id).toBe("sess0");
    // history entries permit additional passthrough fields
    expect((loaded.tasks[0]!.history[0] as any).extra).toBe(42);
  });
});

describe("plan persistence: rejection paths", () => {
  test("loadPlan rejects non-JSON with a clear error", async () => {
    const dir = tmpDir();
    const badPath = join(dir, "corrupt.json");
    writeFileSync(badPath, "not json at all {");
    await expect(loadPlan(badPath)).rejects.toThrow(/not valid JSON/);
  });

  test("loadPlan rejects JSON that does not match the schema", async () => {
    const dir = tmpDir();
    const badPath = join(dir, "wrongshape.json");
    writeFileSync(badPath, JSON.stringify({ task_slug: "x" }));
    await expect(loadPlan(badPath)).rejects.toThrow(/schema validation/);
  });

  test("loadPlan error names the missing required field", async () => {
    const dir = tmpDir();
    const badPath = join(dir, "missingtaskslug.json");
    const { task_slug: _, ...withoutSlug } = validPlan();
    writeFileSync(badPath, JSON.stringify(withoutSlug));
    await expect(loadPlan(badPath)).rejects.toThrow(/task_slug/);
  });

  test("savePlan refuses a structurally invalid plan", async () => {
    const dir = tmpDir();
    const bogus = {
      ...validPlan(),
      status: "invalid-status" as unknown as "planning",
    };
    await expect(
      savePlan(join(dir, "shouldnotexist.json"), bogus as Plan),
    ).rejects.toThrow(/schema validation/);
  });
});
