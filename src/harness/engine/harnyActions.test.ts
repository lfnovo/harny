import { describe, test, expect } from "bun:test";
import { createActor, setup } from "xstate";
import {
  harnyActions,
  gitCommit,
  gitResetTree,
  gitCleanUntracked,
} from "./harnyActions.js";
import type { PlanDrivenContext } from "./types.js";
import type { Plan } from "../types.js";
import { tmpGitRepo } from "../testing/index.js";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// --- git action tests (preserved from earlier promotion) -------------------

async function spawn(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  return (await new Response(proc.stdout!).text()).trim();
}

const signal = new AbortController().signal;

describe("gitCommit", () => {
  test("commits staged changes and returns HEAD sha", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      writeFileSync(join(repo.path, "file.txt"), "hi\n");
      await spawn(["add", "file.txt"], repo.path);
      const result = await gitCommit(
        { cwd: repo.path, message: "add file" },
        signal,
      );
      const head = await spawn(["rev-parse", "HEAD"], repo.path);
      expect(result.sha).toBe(head);
    } finally {
      await repo.cleanup();
    }
  });

  test("returns null sha when there are no changes to commit", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const result = await gitCommit(
        { cwd: repo.path, message: "nothing" },
        signal,
      );
      expect(result.sha).toBeNull();
    } finally {
      await repo.cleanup();
    }
  });

  test("auto-stages untracked files via `add -A` before committing", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      writeFileSync(join(repo.path, "untracked.txt"), "auto-staged\n");
      await gitCommit(
        { cwd: repo.path, message: "auto stage" },
        signal,
      );
      const show = await spawn(
        ["show", "--name-only", "--format=%H", "HEAD"],
        repo.path,
      );
      expect(show).toContain("untracked.txt");
    } finally {
      await repo.cleanup();
    }
  });

  test("returns null sha when nothing is staged and no untracked files exist", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const result = await gitCommit(
        { cwd: repo.path, message: "empty" },
        signal,
      );
      expect(result.sha).toBeNull();
    } finally {
      await repo.cleanup();
    }
  });
});

describe("gitResetTree", () => {
  test("rolls HEAD back to the provided sha", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const pre = await spawn(["rev-parse", "HEAD"], repo.path);
      writeFileSync(join(repo.path, "extra.txt"), "extra\n");
      await spawn(["add", "extra.txt"], repo.path);
      await spawn(["commit", "-m", "extra commit"], repo.path);
      await gitResetTree({ cwd: repo.path, sha: pre }, signal);
      const head = await spawn(["rev-parse", "HEAD"], repo.path);
      expect(head).toBe(pre);
    } finally {
      await repo.cleanup();
    }
  });
});

describe("gitCleanUntracked", () => {
  test("removes untracked files (clean -fd)", async () => {
    const repo = await tmpGitRepo({ seed: {} });
    try {
      const junk = join(repo.path, "junk.txt");
      writeFileSync(junk, "\n");
      await gitCleanUntracked({ cwd: repo.path }, signal);
      expect(existsSync(junk)).toBe(false);
    } finally {
      await repo.cleanup();
    }
  });
});

// --- XState assign action tests --------------------------------------------

const stubPlan: Plan = {
  task_slug: "test",
  user_prompt: "test",
  branch: "test",
  primary_cwd: "/tmp",
  isolation: "inline",
  worktree_path: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  status: "in_progress",
  summary: "",
  iterations_global: 0,
  tasks: [],
  metadata: {},
};

function baseCtx(overrides?: Partial<PlanDrivenContext>): PlanDrivenContext {
  return {
    plan: stubPlan,
    currentTaskIdx: 0,
    attempts: 0,
    iterationsThisTask: 0,
    iterationsGlobal: 0,
    ...overrides,
  };
}

describe("harnyActions.advanceTask", () => {
  test("increments currentTaskIdx and resets attempts + iterationsThisTask", () => {
    const machine = setup({
      types: {} as {
        context: PlanDrivenContext;
        events: { type: "ADVANCE" };
      },
      actions: { advanceTask: harnyActions.advanceTask as any },
    }).createMachine({
      context: baseCtx({
        attempts: 3,
        iterationsThisTask: 2,
        iterationsGlobal: 5,
      }),
      initial: "idle",
      states: {
        idle: {
          on: { ADVANCE: { target: "done", actions: "advanceTask" } },
        },
        done: { type: "final" },
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "ADVANCE" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.currentTaskIdx).toBe(1);
    expect(ctx.attempts).toBe(0);
    expect(ctx.iterationsThisTask).toBe(0);
    // iterationsGlobal is NOT reset on advanceTask
    expect(ctx.iterationsGlobal).toBe(5);
  });
});

describe("harnyActions.bumpAttempts", () => {
  test("increments attempts, iterationsThisTask, iterationsGlobal each by 1", () => {
    const machine = setup({
      types: {} as {
        context: PlanDrivenContext;
        events: { type: "BUMP" };
      },
      actions: { bumpAttempts: harnyActions.bumpAttempts as any },
    }).createMachine({
      context: baseCtx(),
      initial: "idle",
      states: {
        idle: { on: { BUMP: { target: "done", actions: "bumpAttempts" } } },
        done: { type: "final" },
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({ type: "BUMP" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.attempts).toBe(1);
    expect(ctx.iterationsThisTask).toBe(1);
    expect(ctx.iterationsGlobal).toBe(1);
  });
});

describe("harnyActions.stashValidator", () => {
  test("stores session_id from event.output into validatorSession", () => {
    const machine = setup({
      types: {} as {
        context: PlanDrivenContext;
        events: { type: "STASH_VALIDATOR"; output: { session_id: string } };
      },
      actions: { stashValidator: harnyActions.stashValidator as any },
    }).createMachine({
      context: baseCtx(),
      initial: "idle",
      states: {
        idle: {
          on: {
            STASH_VALIDATOR: { target: "done", actions: "stashValidator" },
          },
        },
        done: { type: "final" },
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({
      type: "STASH_VALIDATOR",
      output: { session_id: "val-sess-1" },
    });
    expect(actor.getSnapshot().context.validatorSession).toBe("val-sess-1");
  });
});

describe("harnyActions.stashDevSession", () => {
  test("stores session_id from event.output into devSession", () => {
    const machine = setup({
      types: {} as {
        context: PlanDrivenContext;
        events: { type: "STASH_DEV"; output: { session_id: string } };
      },
      actions: { stashDevSession: harnyActions.stashDevSession as any },
    }).createMachine({
      context: baseCtx(),
      initial: "idle",
      states: {
        idle: {
          on: {
            STASH_DEV: { target: "done", actions: "stashDevSession" },
          },
        },
        done: { type: "final" },
      },
    });
    const actor = createActor(machine);
    actor.start();
    actor.send({
      type: "STASH_DEV",
      output: { session_id: "dev-sess-2" },
    });
    expect(actor.getSnapshot().context.devSession).toBe("dev-sess-2");
  });
});
