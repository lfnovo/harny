import { describe, test, expect } from "bun:test";
import { ZodError } from "zod";
import { StateSchema } from "./schema.js";

const NOW = "2026-01-01T00:00:00.000Z";

function minimalV2() {
  return {
    schema_version: 2 as const,
    run_id: "run-a",
    origin: {
      prompt: "test",
      workflow: "test",
      task_slug: "test",
      started_at: NOW,
      host: "h",
      user: "u",
      features: null,
    },
    environment: {
      cwd: "/tmp",
      branch: "main",
      isolation: "inline" as const,
      worktree_path: null,
      mode: "silent" as const,
    },
    lifecycle: {
      status: "running" as const,
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

describe("StateSchema v2", () => {
  test("parses a minimal v2 object", () => {
    expect(() => StateSchema.parse(minimalV2())).not.toThrow();
  });

  test("parses a full v2 object (features, workflow_chosen, human_review history)", () => {
    expect(() =>
      StateSchema.parse({
        ...minimalV2(),
        run_id: "run-b",
        origin: {
          ...minimalV2().origin,
          workflow: "router",
          features: { env: "prod", tier: "enterprise" },
        },
        environment: {
          cwd: "/tmp",
          branch: "main",
          isolation: "worktree",
          worktree_path: "/tmp/wt",
          mode: "async",
        },
        lifecycle: {
          status: "done",
          current_phase: null,
          ended_at: NOW,
          ended_reason: "completed",
          pid: 42,
        },
        phases: [
          {
            name: "planner",
            attempt: 1,
            started_at: NOW,
            ended_at: NOW,
            status: "completed",
            verdict: '{"summary":"ok"}',
            session_id: "sess-1",
          },
        ],
        history: [
          { at: NOW, phase: "planner", event: "phase_start" },
          { at: NOW, phase: "planner", event: "phase_end" },
          {
            at: NOW,
            kind: "human_review",
            state_path: "lifecycle.status",
            question: "Is this ok?",
            answered: true,
            answer: "yes",
          },
        ],
        workflow_state: { custom: "data" },
        workflow_chosen: { id: "router", variant: "auto" },
      }),
    ).not.toThrow();
  });

  test("rejects schema_version: 1 at path[0]=schema_version", () => {
    let caught: unknown = null;
    try {
      StateSchema.parse({ ...minimalV2(), schema_version: 1 as unknown as 2 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ZodError);
    const issues = (caught as ZodError).issues;
    expect(issues[0]!.path[0]).toBe("schema_version");
  });
});
