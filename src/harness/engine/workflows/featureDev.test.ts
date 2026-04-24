import { describe, test, expect } from "bun:test";
import { fromPromise } from "xstate";
import featureDevWorkflow from "./featureDev.js";
import { runEngineWorkflowDry } from "../../testing/index.js";
import type { Plan, PlanTask } from "../../types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: `Task ${id}`,
    description: `do ${id}`,
    acceptance: [`${id} works`],
    status: "pending",
    attempts: 0,
    commit_sha: null,
    history: [],
    ...overrides,
  };
}

function plan(tasks: PlanTask[]): Plan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    task_slug: "t",
    user_prompt: "do stuff",
    branch: "",
    primary_cwd: "/tmp",
    isolation: "inline",
    worktree_path: null,
    created_at: now,
    updated_at: now,
    status: "in_progress",
    summary: "test plan",
    iterations_global: 0,
    tasks,
    metadata: {},
  };
}

// Builds a fromPromise actor that pops scripted outputs from a queue per call.
// Throws on exhaustion — catches off-by-one in test scripts rather than silently
// repeating the last result.
function scripted<TOut, TIn = unknown>(outputs: TOut[]) {
  const queue = [...outputs];
  return fromPromise<TOut, TIn>(async () => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("scripted actor: script exhausted");
    }
    return next;
  });
}

// spyCommit — records every (cwd, message, attempt) and returns a fake sha.
// Inline here; promote to testing/ if a use emerges outside this file.
function spyCommit(sha: string | null = "sha-fake") {
  const calls: { cwd: string; message: string; attempt: number }[] = [];
  const actor = fromPromise<
    { sha: string | null },
    { cwd: string; message: string; attempt: number }
  >(async ({ input }) => {
    calls.push(input);
    return { sha };
  });
  return { actor, calls };
}

function failingCommit(err: Error) {
  return fromPromise<
    { sha: string | null },
    { cwd: string; message: string; attempt: number }
  >(async () => {
    throw err;
  });
}

const noopPersist = fromPromise<void, { primaryCwd: string; taskSlug: string; plan: Plan }>(
  async () => {},
);

function spyPersist() {
  const calls: { primaryCwd: string; taskSlug: string; plan: Plan }[] = [];
  const actor = fromPromise<void, { primaryCwd: string; taskSlug: string; plan: Plan }>(
    async ({ input }) => {
      calls.push(input);
    },
  );
  return { actor, calls };
}

// Captures each input on calls[] then pops the queued output. Throws on
// exhaustion. Used for retry/session-propagation assertions where we need to
// observe what the machine passed in, not just check state after the fact.
function capturingScripted<TOut>(outputs: TOut[]) {
  const queue = [...outputs];
  const calls: any[] = [];
  const actor = fromPromise<TOut, any>(async ({ input }) => {
    calls.push({ ...input });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("capturingScripted: script exhausted");
    }
    return next;
  });
  return { actor, calls };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("feature-dev commit-gate: validator pass", () => {
  test("validator pass → commitActor called once with task= and validator: reasons", async () => {
    const spy = spyCommit();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "feat: t1" },
        ]),
        validatorActor: scripted([
          { verdict: "pass", session_id: "val-1", reasons: ["checklist ok"] },
        ]),
        commitActor: spy.actor,
        persistPlanActor: noopPersist,
      },
    );

    expect(snapshot.value).toBe("done");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.message).toContain("task=t1");
    expect(spy.calls[0]!.message).toContain("validator: checklist ok");
    expect(spy.calls[0]!.cwd).toBe("/tmp");
  });
});

describe("feature-dev commit-gate: retry path does not commit", () => {
  test("validator fail with attempts<maxRetries → no commit, developer re-invoked", async () => {
    const spy = spyCommit();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 2 },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "feat: t1 a1" },
          { session_id: "dev-1", status: "done", commit_message: "feat: t1 a2" },
        ]),
        validatorActor: scripted([
          { verdict: "fail", session_id: "val-1", reasons: ["missing X"] },
          { verdict: "pass", session_id: "val-1", reasons: ["checklist ok"] },
        ]),
        commitActor: spy.actor,
        persistPlanActor: noopPersist,
      },
    );

    expect(snapshot.value).toBe("done");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.message).toContain("validator: checklist ok");
    expect(spy.calls[0]!.message).not.toContain("missing X");
  });
});

describe("feature-dev commit-gate: exhausted retries do not commit", () => {
  test("validator fail with attempts=maxRetries → no commit, machine failed", async () => {
    const spy = spyCommit();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 1 },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "m1" },
          { session_id: "dev-1", status: "done", commit_message: "m2" },
        ]),
        validatorActor: scripted([
          { verdict: "fail", session_id: "val-1", reasons: ["r1"] },
          { verdict: "fail", session_id: "val-1", reasons: ["r2"] },
        ]),
        commitActor: spy.actor,
        persistPlanActor: noopPersist,
      },
    );

    expect(snapshot.value).toBe("failed");
    expect(spy.calls).toHaveLength(0);
  });
});

describe("feature-dev commit-gate: validator blocked does not commit", () => {
  test("validator verdict=blocked → no commit, machine failed", async () => {
    const spy = spyCommit();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "m" },
        ]),
        validatorActor: scripted([
          { verdict: "blocked", session_id: "val-1", reasons: ["env missing"] },
        ]),
        commitActor: spy.actor,
        persistPlanActor: noopPersist,
      },
    );

    expect(snapshot.value).toBe("failed");
    expect(spy.calls).toHaveLength(0);
  });
});

describe("feature-dev commit-gate: developer blocked does not commit", () => {
  test("developer status=blocked → validator skipped, no commit, machine failed", async () => {
    const spy = spyCommit();
    // Validator must NOT be called — if it is, scripted() throws on empty queue.
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "blocked", commit_message: "" },
        ]),
        validatorActor: scripted([]),
        commitActor: spy.actor,
        persistPlanActor: noopPersist,
      },
    );

    expect(snapshot.value).toBe("failed");
    expect(spy.calls).toHaveLength(0);
  });
});

describe("feature-dev commit-gate: commitActor failure", () => {
  test("commitActor throws → machine failed", async () => {
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "m" },
        ]),
        validatorActor: scripted([
          { verdict: "pass", session_id: "val-1", reasons: ["ok"] },
        ]),
        commitActor: failingCommit(new Error("git write locked")),
        persistPlanActor: noopPersist,
      },
    );

    expect(snapshot.value).toBe("failed");
  });
});

describe("feature-dev retry: session propagation within a task", () => {
  test("retry: developer re-invoked with resumeSessionId = prior devSession", async () => {
    const dev = capturingScripted([
      { session_id: "dev-sess-1", status: "done", commit_message: "m1" },
      { session_id: "dev-sess-2", status: "done", commit_message: "m2" },
    ]);
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 2 },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: dev.actor,
        validatorActor: scripted([
          { verdict: "fail", session_id: "val-1", reasons: ["r"] },
          { verdict: "pass", session_id: "val-1", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: noopPersist,
      },
    );
    expect(snapshot.value).toBe("done");
    expect(dev.calls).toHaveLength(2);
    expect(dev.calls[0]!.resumeSessionId).toBeUndefined();
    expect(dev.calls[1]!.resumeSessionId).toBe("dev-sess-1");
  });

  test("retry: validator re-invoked with resumeSessionId = prior validatorSession", async () => {
    const val = capturingScripted([
      { verdict: "fail", session_id: "val-sess-1", reasons: ["r"] },
      { verdict: "pass", session_id: "val-sess-2", reasons: ["ok"] },
    ]);
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 2 },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "m1" },
          { session_id: "dev-1", status: "done", commit_message: "m2" },
        ]),
        validatorActor: val.actor,
        commitActor: spyCommit().actor,
        persistPlanActor: noopPersist,
      },
    );
    expect(snapshot.value).toBe("done");
    expect(val.calls).toHaveLength(2);
    expect(val.calls[0]!.resumeSessionId).toBeUndefined();
    expect(val.calls[1]!.resumeSessionId).toBe("val-sess-1");
  });

  test("bumpAttempts: developer's attempt param increments on each retry", async () => {
    const dev = capturingScripted([
      { session_id: "d", status: "done", commit_message: "m" },
      { session_id: "d", status: "done", commit_message: "m" },
      { session_id: "d", status: "done", commit_message: "m" },
    ]);
    await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 3 },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: dev.actor,
        validatorActor: scripted([
          { verdict: "fail", session_id: "v", reasons: ["r"] },
          { verdict: "fail", session_id: "v", reasons: ["r"] },
          { verdict: "pass", session_id: "v", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: noopPersist,
      },
    );
    expect(dev.calls.map((c) => c.attempt)).toEqual([1, 2, 3]);
  });

  test("advanceTask: attempts counter resets to 1 on first invocation of the next task", async () => {
    const dev = capturingScripted([
      { session_id: "d1a", status: "done", commit_message: "m" },
      { session_id: "d1b", status: "done", commit_message: "m" },
      { session_id: "d2", status: "done", commit_message: "m" },
    ]);
    await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 2 },
      {
        plannerActor: scripted([plan([task("t1"), task("t2")])]),
        developerActor: dev.actor,
        validatorActor: scripted([
          { verdict: "fail", session_id: "v", reasons: ["r"] },
          { verdict: "pass", session_id: "v", reasons: ["ok"] },
          { verdict: "pass", session_id: "v", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: noopPersist,
      },
    );
    // task1 attempts: 1, 2; task2 attempts: 1 (reset).
    expect(dev.calls.map((c) => c.attempt)).toEqual([1, 2, 1]);
  });
});

describe("feature-dev retry: cross-task session isolation (bug lockdown, see #65)", () => {
  // These two tests capture the expected-correct contract: advanceTask
  // should zero devSession/validatorSession before the next task's first
  // invocation. Current machine leaks both — tracked in issue #65.
  // Unskip after the fix lands via harny.
  test.skip("devSession is reset on advanceTask (not leaked into next task's first dev invoke)", async () => {
    const dev = capturingScripted([
      { session_id: "dev-task1", status: "done", commit_message: "m1" },
      { session_id: "dev-task2", status: "done", commit_message: "m2" },
    ]);
    await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1"), task("t2")])]),
        developerActor: dev.actor,
        validatorActor: scripted([
          { verdict: "pass", session_id: "v1", reasons: ["ok"] },
          { verdict: "pass", session_id: "v2", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: noopPersist,
      },
    );
    expect(dev.calls[0]!.resumeSessionId).toBeUndefined();
    // Expected (post-fix): task2's first dev invoke has NO resumeSessionId.
    expect(dev.calls[1]!.resumeSessionId).toBeUndefined();
  });

  test.skip("validatorSession is reset on advanceTask (not leaked into next task's first validator invoke)", async () => {
    const val = capturingScripted([
      { verdict: "pass", session_id: "val-task1", reasons: ["ok"] },
      { verdict: "pass", session_id: "val-task2", reasons: ["ok"] },
    ]);
    await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1"), task("t2")])]),
        developerActor: scripted([
          { session_id: "d1", status: "done", commit_message: "m1" },
          { session_id: "d2", status: "done", commit_message: "m2" },
        ]),
        validatorActor: val.actor,
        commitActor: spyCommit().actor,
        persistPlanActor: noopPersist,
      },
    );
    expect(val.calls[0]!.resumeSessionId).toBeUndefined();
    // Expected (post-fix): task2's first validator invoke has NO resumeSessionId.
    expect(val.calls[1]!.resumeSessionId).toBeUndefined();
  });
});

describe("feature-dev retry: validator feedback does NOT enter developer input", () => {
  // Locks the current contract: on retry, developer input is the same
  // shape as the first invocation plus resumeSessionId + incremented
  // attempt. Validator reasons are NOT injected. Feedback to the dev
  // flows only via SDK session resume (prior dev session replayed), not
  // via explicit prompt injection.
  //
  // If a future change starts threading validatorReasons into the dev
  // input, this test breaks and the contract change becomes a visible
  // decision rather than a silent drift.
  test("retry: developer input on attempt 2 has no validator-reasons field", async () => {
    const dev = capturingScripted([
      { session_id: "d1", status: "done", commit_message: "m1" },
      { session_id: "d2", status: "done", commit_message: "m2" },
    ]);
    await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 2 },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: dev.actor,
        validatorActor: scripted([
          { verdict: "fail", session_id: "v1", reasons: ["missing X", "bad Y"] },
          { verdict: "pass", session_id: "v2", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: noopPersist,
      },
    );
    expect(dev.calls).toHaveLength(2);
    const retryInput = dev.calls[1]!;
    // Locked shape: exactly these 4 keys, nothing else.
    expect(Object.keys(retryInput).sort()).toEqual([
      "attempt",
      "cwd",
      "resumeSessionId",
      "task",
    ]);
    // task is the same object shape as attempt 1 — no feedback baked in.
    expect(retryInput.task).toEqual(dev.calls[0]!.task);
    // And no stringified validator reasons leak anywhere in the input.
    const asJson = JSON.stringify(retryInput);
    expect(asJson).not.toContain("missing X");
    expect(asJson).not.toContain("bad Y");
  });
});

describe("feature-dev persistPlan: once per run, never on retry or task advance", () => {
  test("single task, happy path → persistPlan called exactly once", async () => {
    const persist = spyPersist();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "feat: t1" },
        ]),
        validatorActor: scripted([
          { verdict: "pass", session_id: "val-1", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: persist.actor,
      },
    );

    expect(snapshot.value).toBe("done");
    expect(persist.calls).toHaveLength(1);
    expect(persist.calls[0]!.taskSlug).toBe("t");
  });

  test("multi-task happy path → persistPlan still called exactly once (not per task)", async () => {
    const persist = spyPersist();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1"), task("t2")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "feat: t1" },
          { session_id: "dev-2", status: "done", commit_message: "feat: t2" },
        ]),
        validatorActor: scripted([
          { verdict: "pass", session_id: "val-1", reasons: ["ok"] },
          { verdict: "pass", session_id: "val-2", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: persist.actor,
      },
    );

    expect(snapshot.value).toBe("done");
    expect(persist.calls).toHaveLength(1);
  });

  test("retry path → persistPlan still called exactly once (not per retry)", async () => {
    const persist = spyPersist();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t", maxRetries: 2 },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "m1" },
          { session_id: "dev-1", status: "done", commit_message: "m2" },
        ]),
        validatorActor: scripted([
          { verdict: "fail", session_id: "val-1", reasons: ["r1"] },
          { verdict: "pass", session_id: "val-1", reasons: ["ok"] },
        ]),
        commitActor: spyCommit().actor,
        persistPlanActor: persist.actor,
      },
    );

    expect(snapshot.value).toBe("done");
    expect(persist.calls).toHaveLength(1);
  });

  test("persistPlan error → machine failed (planner output not allowed to proceed unpersisted)", async () => {
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1")])]),
        developerActor: scripted([]),
        validatorActor: scripted([]),
        commitActor: spyCommit().actor,
        persistPlanActor: fromPromise<
          void,
          { primaryCwd: string; taskSlug: string; plan: Plan }
        >(async () => {
          throw new Error("disk full");
        }),
      },
    );

    expect(snapshot.value).toBe("failed");
  });
});

describe("feature-dev commit-gate: per-task reasons are fresh, not stale", () => {
  test("two tasks pass → each commit message carries its own validator reasons", async () => {
    const spy = spyCommit();
    const snapshot = await runEngineWorkflowDry(
      featureDevWorkflow,
      { cwd: "/tmp", userPrompt: "p", taskSlug: "t" },
      {
        plannerActor: scripted([plan([task("t1"), task("t2")])]),
        developerActor: scripted([
          { session_id: "dev-1", status: "done", commit_message: "feat: t1" },
          { session_id: "dev-2", status: "done", commit_message: "feat: t2" },
        ]),
        validatorActor: scripted([
          { verdict: "pass", session_id: "val-1", reasons: ["reason-a"] },
          { verdict: "pass", session_id: "val-2", reasons: ["reason-b"] },
        ]),
        commitActor: spy.actor,
        persistPlanActor: noopPersist,
      },
    );

    expect(snapshot.value).toBe("done");
    expect(spy.calls).toHaveLength(2);
    expect(spy.calls[0]!.message).toContain("task=t1");
    expect(spy.calls[0]!.message).toContain("validator: reason-a");
    expect(spy.calls[0]!.message).not.toContain("reason-b");
    expect(spy.calls[1]!.message).toContain("task=t2");
    expect(spy.calls[1]!.message).toContain("validator: reason-b");
    expect(spy.calls[1]!.message).not.toContain("reason-a");
  });
});
