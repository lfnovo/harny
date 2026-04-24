import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { coldInstallWorktree } from "./coldInstall.js";
import { planFilePath, worktreePathFor } from "./state/plan.js";
import {
  addWorktree,
  assertBranchAbsent,
  assertCleanTree,
  assertHasInitialCommit,
  assertIsGitRepo,
  assertWorktreePathAbsent,
  createBranch,
  removeWorktree,
} from "./git.js";
import { FilesystemStateStore } from "./state/filesystem.js";
import type { State } from "./state/schema.js";
import { setupPhoenix, withRunSpan } from "./observability/phoenix.js";
import { getWorkflow } from "./workflows/index.js";
import { runEngineWorkflow } from "./engine/runtime/runEngineWorkflow.js";
import type { IsolationMode, LogMode, RunMode } from "./types.js";

function defaultTaskSlug(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${iso}`;
}

export async function runHarness(args: {
  cwd: string;
  userPrompt: string;
  taskSlug?: string;
  workflowId?: string;
  variant?: string;
  isolation?: IsolationMode;
  mode?: RunMode;
  logMode?: LogMode;
}): Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human"; planPath: string; branch: string }> {
  const primaryCwd = args.cwd;
  const taskSlug = args.taskSlug?.trim() || defaultTaskSlug();
  const logMode = args.logMode ?? "compact";
  const log = (msg: string) => { if (logMode !== "quiet") console.log(msg); };
  const warn = (msg: string) => { if (logMode !== "quiet") console.warn(msg); };

  const workflow = getWorkflow(args.workflowId ?? "feature-dev");
  const variant = args.variant ?? "default";
  const mode: RunMode = args.mode ?? (process.stdin.isTTY ? "interactive" : "silent");
  const isolation: IsolationMode = args.isolation ?? "worktree";

  log(`[harny] cwd=${primaryCwd} isolation=${isolation}`);
  log(`[harny] workflow=${workflow.id} task=${taskSlug}`);
  log(`[harny] user prompt >>>`);
  log(args.userPrompt);
  log(`[harny] user prompt <<<`);

  await assertIsGitRepo(primaryCwd);
  await assertHasInitialCommit(primaryCwd);

  // Idempotent rerun guard: if state.json already exists at this slug, refuse
  // gracefully so we don't clobber an in-progress or completed run.
  const probeStore = new FilesystemStateStore(primaryCwd, taskSlug);
  const existing = await probeStore.getState();
  if (existing) {
    if (existing.lifecycle.status === "done" || existing.lifecycle.status === "failed") {
      log(
        `[harny] run already complete (status=${existing.lifecycle.status}, ended_at=${existing.lifecycle.ended_at ?? "?"}). Use \`harny clean ${taskSlug}\` then rerun.`,
      );
      return { status: existing.lifecycle.status, planPath: planFilePath(primaryCwd, taskSlug), branch: existing.environment.branch };
    }
    if (existing.lifecycle.status === "running") {
      throw new Error(
        `Run ${taskSlug} appears to still be running (pid=${existing.lifecycle.pid}). If it's actually dead, \`harny clean ${taskSlug}\` and retry.`,
      );
    }
    if (existing.lifecycle.status === "waiting_human") {
      throw new Error(
        `Run ${taskSlug} is parked waiting for input. Engine workflows don't yet support resume — use \`harny clean ${taskSlug}\` to discard.`,
      );
    }
  }

  let phaseCwd = primaryCwd;
  let worktreePath: string | null = null;
  const branch = workflow.needsBranch ? `harny/${taskSlug}` : "";

  if (workflow.needsBranch) {
    await assertBranchAbsent(primaryCwd, branch);
    if (workflow.needsWorktree && isolation !== "inline") {
      worktreePath = worktreePathFor(primaryCwd, taskSlug);
      await assertWorktreePathAbsent(worktreePath);
      await addWorktree(primaryCwd, worktreePath, branch);
      phaseCwd = worktreePath;
      log(`[harny] worktree=${worktreePath}`);
      await coldInstallWorktree({ worktreePath, primaryCwd });
    } else {
      await assertCleanTree(primaryCwd);
      await createBranch(primaryCwd, branch);
      phaseCwd = primaryCwd;
    }
  } else if (!workflow.needsWorktree && isolation === "inline") {
    await assertCleanTree(primaryCwd);
  }

  const planPath = planFilePath(primaryCwd, taskSlug);
  const runId = randomUUID();

  const store = new FilesystemStateStore(primaryCwd, taskSlug);
  const startedAt = new Date().toISOString();
  const initialState: State = {
    schema_version: 2,
    run_id: runId,
    origin: {
      prompt: args.userPrompt,
      workflow: workflow.id,
      task_slug: taskSlug,
      started_at: startedAt,
      host: hostname(),
      user: userInfo().username,
      features: null,
    },
    environment: {
      cwd: primaryCwd,
      branch,
      isolation,
      worktree_path: worktreePath,
      mode,
    },
    lifecycle: {
      status: "running",
      current_phase: null,
      ended_at: null,
      ended_reason: null,
      pid: process.pid,
    },
    phases: [],
    history: [
      { at: startedAt, phase: "harness", event: "run_started" },
    ],
    pending_question: null,
    workflow_state: {},
    workflow_chosen: null,
  };
  await store.createRun(initialState);

  const handleCleanupWorktree = async (
    outcome: "done" | "failed" | "exhausted" | "waiting_human",
  ): Promise<void> => {
    if (!worktreePath) return;
    if (outcome === "done") {
      try {
        await removeWorktree(primaryCwd, worktreePath, { force: true });
        log(`[harny] worktree removed: ${worktreePath}`);
      } catch (err) {
        warn(`[harny] worktree cleanup failed: ${(err as Error).message}`);
      }
    } else {
      log(`[harny] worktree preserved: ${worktreePath} (branch: ${branch})`);
    }
  };

  const phoenix = setupPhoenix({
    workflowId: workflow.id,
    runId,
    taskSlug,
    cwd: primaryCwd,
  });

  return await withRunSpan(
    phoenix,
    taskSlug,
    {
      "harny.workflow": workflow.id,
      "harny.run_id": runId,
      "harny.task_slug": taskSlug,
      "harny.cwd": primaryCwd,
    },
    async (traceId) => {
      if (traceId && phoenix.projectName) {
        await store.setPhoenix({ project: phoenix.projectName, trace_id: traceId });
      }

      const engineResult = await runEngineWorkflow(workflow, {
        cwd: phaseCwd,
        primaryCwd,
        taskSlug,
        runId,
        userPrompt: args.userPrompt,
        log,
        mode,
        logMode,
        store,
        variant,
      });

      await handleCleanupWorktree(engineResult.status);

      await store.updateLifecycle({
        status: engineResult.status === "done" ? "done" : "failed",
        ended_at: new Date().toISOString(),
        ended_reason: engineResult.status,
        current_phase: null,
      });

      if (engineResult.status === "failed") {
        log(`[harny] engine workflow failed: ${engineResult.error ?? "(no error message)"}`);
      } else {
        log(`[harny] engine workflow done`);
      }

      return { status: engineResult.status, planPath, branch };
    },
  );
}
