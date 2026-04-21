import { loadHarnessConfig } from "./config.js";
import {
  createPlanSkeleton,
  planFilePath,
  savePlan,
  worktreePathFor,
} from "./plan.js";
import {
  addWorktree,
  assertBranchAbsent,
  assertCleanTree,
  assertIsGitRepo,
  assertWorktreePathAbsent,
  cleanUntracked,
  commitComposed,
  createBranch,
  headSha,
  removeWorktree,
  resetHard,
} from "./git.js";
import { appendAudit } from "./audit.js";
import { getWorkflow } from "./workflows/index.js";
import type { IsolationMode, LogMode } from "./types.js";
import type { WorkflowContext } from "./workflow.js";

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
  isolation?: IsolationMode;
  logMode?: LogMode;
  input?: unknown;
}): Promise<{ status: "done" | "failed" | "exhausted"; planPath: string; branch: string }> {
  const primaryCwd = args.cwd;
  const taskSlug = args.taskSlug?.trim() || defaultTaskSlug();
  const logMode = args.logMode ?? "compact";
  const log = (msg: string) => { if (logMode !== "quiet") console.log(msg); };
  const warn = (msg: string) => { if (logMode !== "quiet") console.warn(msg); };

  const workflow = getWorkflow(args.workflowId ?? "feature-dev");
  const config = await loadHarnessConfig(primaryCwd);
  const isolation = args.isolation ?? config.isolation;

  log(`[harness] cwd=${primaryCwd} isolation=${isolation}`);
  log(`[harness] workflow=${workflow.id} task=${taskSlug}`);

  await assertIsGitRepo(primaryCwd);

  let phaseCwd = primaryCwd;
  let worktreePath: string | null = null;
  const branch = workflow.needsBranch ? `harness/${taskSlug}` : "";

  if (workflow.needsBranch) {
    await assertBranchAbsent(primaryCwd, branch);
    if (workflow.needsWorktree && isolation !== "inline") {
      worktreePath = worktreePathFor(primaryCwd, taskSlug);
      await assertWorktreePathAbsent(worktreePath);
      await addWorktree(primaryCwd, worktreePath, branch);
      phaseCwd = worktreePath;
      log(`[harness] worktree=${worktreePath}`);
    } else {
      await assertCleanTree(primaryCwd);
      await createBranch(primaryCwd, branch);
      phaseCwd = primaryCwd;
    }
  } else if (!workflow.needsWorktree && isolation === "inline") {
    await assertCleanTree(primaryCwd);
  }

  log(
    `[harness] caps: per-task=${config.maxIterationsPerTask} retries-before-reset=${config.maxRetriesBeforeReset} global=${config.maxIterationsGlobal}`,
  );

  const planPath = planFilePath(primaryCwd, taskSlug);
  const plan = createPlanSkeleton({
    taskSlug,
    userPrompt: args.userPrompt,
    branch,
    primaryCwd,
    isolation,
    worktreePath,
  });
  await savePlan(planPath, plan);

  const ctx: WorkflowContext = {
    taskSlug,
    userPrompt: args.userPrompt,
    primaryCwd,
    phaseCwd,
    input: args.input,
    config,
    logMode,
    planPath,
    plan,
    log,
    warn,
    updatePlan: async (mutator) => {
      mutator(plan);
      await savePlan(planPath, plan);
    },
    audit: (entry) => appendAudit(primaryCwd, taskSlug, entry),
    currentSha: () => headSha(phaseCwd),
    commit: (message) => commitComposed(phaseCwd, message),
    resetHard: (sha) => resetHard(phaseCwd, sha),
    cleanUntracked: () => cleanUntracked(phaseCwd),
  };

  const cleanupWorktree = async (
    outcome: "done" | "failed" | "exhausted",
  ): Promise<void> => {
    if (!worktreePath) return;
    if (outcome === "done") {
      try {
        await removeWorktree(primaryCwd, worktreePath, { force: true });
        log(`[harness] worktree removed: ${worktreePath}`);
      } catch (err) {
        warn(`[harness] worktree cleanup failed: ${(err as Error).message}`);
      }
    } else {
      log(`[harness] worktree preserved for debug: ${worktreePath} (branch: ${branch})`);
    }
  };

  const result = await workflow.run(ctx);

  await cleanupWorktree(result.status);

  return { status: result.status, planPath, branch };
}
