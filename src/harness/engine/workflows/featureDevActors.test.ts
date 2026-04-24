import { describe, test, expect } from "bun:test";
import { createActor, fromPromise } from "xstate";
import { buildFeatureDevActors } from "./featureDevActors.js";
import featureDevWorkflow from "./featureDev.js";
import { resolvePrompt } from "../promptResolver.js";
import { MockStateStore } from "../../testing/mockStateStore.js";
import { tmpGitRepo } from "../../testing/index.js";
import type { State } from "../../state/schema.js";
import type { SessionRunPhase } from "../runtime/runPhaseAdapter.js";

function minimalState(): State {
  return {
    schema_version: 2,
    run_id: "r",
    origin: {
      prompt: "p",
      workflow: "w",
      task_slug: "t",
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

async function runCommitActor(
  repoPath: string,
  sha: string | null,
  store: MockStateStore,
) {
  const actors = buildFeatureDevActors({
    cwd: repoPath,
    variant: "default",
    taskSlug: "probe",
    runId: "probe",
    gitCommit: async () => ({ sha }),
    store,
  });
  await new Promise<void>((resolve, reject) => {
    const a = createActor(actors.commitActor, {
      input: { cwd: repoPath, message: "test: probe", attempt: 2 },
    });
    a.subscribe({
      next: (s) => {
        if (s.status === "done" || s.status === "error") resolve();
      },
      error: (err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
    });
    a.start();
  });
}

describe("commitActor: committing PhaseEntry with no_op flag", () => {
  test("sha=null → appendPhase('committing') + updatePhase with no_op=true, status='completed'", async () => {
    const r = await tmpGitRepo();
    try {
      const store = new MockStateStore(minimalState());
      await runCommitActor(r.path, null, store);

      const committingAppends = store.calls.filter(
        (c) => c.op === "appendPhase" && (c as any).phase.name === "committing",
      );
      expect(committingAppends).toHaveLength(1);
      expect((committingAppends[0] as any).phase.attempt).toBe(2);

      const committingUpdate = store.calls.find(
        (c) =>
          c.op === "updatePhase" &&
          (c as any).name === "committing" &&
          (c as any).patch.no_op === true,
      );
      expect(committingUpdate).toBeDefined();
      expect((committingUpdate as any).patch.status).toBe("completed");
    } finally {
      await r.cleanup();
    }
  });

  test("sha non-null → appendPhase('committing') + updatePhase with verdict=sha, no no_op key", async () => {
    const r = await tmpGitRepo();
    try {
      const store = new MockStateStore(minimalState());
      await runCommitActor(r.path, "abc123", store);

      const committingUpdate = store.calls.find(
        (c) => c.op === "updatePhase" && (c as any).name === "committing",
      );
      expect(committingUpdate).toBeDefined();
      const patch = (committingUpdate as any).patch;
      expect(patch.verdict).toBe("abc123");
      expect(patch.status).toBe("completed");
      expect("no_op" in patch).toBe(false);
    } finally {
      await r.cleanup();
    }
  });
});

describe("featureDev machine: validator phase never carries no_op", () => {
  test("full machine cycle with sha=null — validator phase has no no_op key", async () => {
    const r = await tmpGitRepo();
    try {
      const store = new MockStateStore(minimalState());

      const mockSessionRunPhase: SessionRunPhase = async (args) => {
        if (args.phase === "planner") {
          return {
            sessionId: "planner-sess",
            status: "completed",
            error: null,
            structuredOutput: {
              summary: "plan",
              tasks: [
                {
                  id: "t1",
                  title: "task",
                  description: "d",
                  acceptance: ["a"],
                },
              ],
            },
            resultSubtype: null,
            events: [],
          };
        }
        if (args.phase === "developer") {
          return {
            sessionId: "dev-sess",
            status: "completed",
            error: null,
            structuredOutput: { status: "done", commit_message: "feat: t1" },
            resultSubtype: null,
            events: [],
          };
        }
        return {
          sessionId: "val-sess",
          status: "completed",
          error: null,
          structuredOutput: { verdict: "pass", reasons: ["ok"] },
          resultSubtype: null,
          events: [],
        };
      };

      const actors = buildFeatureDevActors({
        cwd: r.path,
        variant: "default",
        taskSlug: "probe",
        runId: "probe",
        sessionRunPhase: mockSessionRunPhase,
        gitCommit: async () => ({ sha: null }),
        store,
      });

      const provided = featureDevWorkflow.machine.provide({
        actors: { ...actors, persistPlanActor: fromPromise(async () => {}) },
      });

      await new Promise<void>((resolve, reject) => {
        const a = createActor(provided, {
          input: {
            cwd: r.path,
            userPrompt: "probe",
            taskSlug: "probe",
            maxRetries: 0,
          },
        });
        a.subscribe({
          next: (s) => {
            if (s.status === "done") resolve();
          },
          error: (err) =>
            reject(err instanceof Error ? err : new Error(String(err))),
        });
        a.start();
      });

      const validatorWithNoOp = store.calls.find(
        (c) =>
          c.op === "updatePhase" &&
          (c as any).name === "validator" &&
          "no_op" in (c as any).patch,
      );
      expect(validatorWithNoOp).toBeUndefined();
    } finally {
      await r.cleanup();
    }
  });
});

describe("featureDev actors: phase prompts match resolvePrompt output", () => {
  test("planner/developer/validator phaseConfig.prompt === resolvePrompt(...) for each actor", async () => {
    const r = await tmpGitRepo();
    try {
      const captured: Record<string, string> = {};
      const mockSessionRunPhase: SessionRunPhase = async (args) => {
        captured[args.phase] = args.phaseConfig.prompt;
        if (args.phase === "planner") {
          return {
            sessionId: "ps",
            status: "completed",
            error: null,
            structuredOutput: {
              summary: "p",
              tasks: [
                {
                  id: "t1",
                  title: "t",
                  description: "d",
                  acceptance: ["a"],
                },
              ],
            },
            resultSubtype: null,
            events: [],
          };
        }
        if (args.phase === "developer") {
          return {
            sessionId: "ds",
            status: "completed",
            error: null,
            structuredOutput: { status: "done", commit_message: "feat: x" },
            resultSubtype: null,
            events: [],
          };
        }
        return {
          sessionId: "vs",
          status: "completed",
          error: null,
          structuredOutput: { verdict: "pass", reasons: [] },
          resultSubtype: null,
          events: [],
        };
      };

      const actors = buildFeatureDevActors({
        cwd: r.path,
        taskSlug: "probe",
        runId: "probe-id",
        sessionRunPhase: mockSessionRunPhase,
        gitCommit: async () => ({ sha: "mock-sha" }),
        mode: "silent",
        logMode: "compact",
        variant: "default",
      });
      const provided = featureDevWorkflow.machine.provide({
        actors: { ...actors, persistPlanActor: fromPromise(async () => {}) },
      });

      await new Promise<void>((resolve, reject) => {
        const a = createActor(provided, {
          input: {
            cwd: r.path,
            taskSlug: "probe",
            userPrompt: "test",
            maxRetries: 3,
          },
        });
        a.subscribe({
          next: (s) => {
            if (s.status === "done") resolve();
          },
          error: (err) =>
            reject(err instanceof Error ? err : new Error(String(err))),
        });
        a.start();
      });

      for (const actorName of ["planner", "developer", "validator"] as const) {
        const expected = resolvePrompt(
          "feature-dev",
          "default",
          actorName,
          r.path,
        );
        expect(captured[actorName]).toBe(expected);
      }
    } finally {
      await r.cleanup();
    }
  });
});
