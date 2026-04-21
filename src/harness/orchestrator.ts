import { loadHarnessConfig } from "./config.js";
import {
  applyPlannerVerdict,
  createPlanSkeleton,
  findNextPendingTask,
  isPlanComplete,
  markTaskDone,
  markTaskFailed,
  markTaskInProgress,
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
import { runPlanner } from "./phases/planner.js";
import { runDeveloper } from "./phases/developer.js";
import { runValidator } from "./phases/validator.js";
import type {
  IsolationMode,
  LogMode,
  PlanTask,
  ResolvedHarnessConfig,
} from "./types.js";
import type { DeveloperVerdict, ValidatorVerdict } from "./verdict.js";

function defaultTaskSlug(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${iso}`;
}

function composeCommitMessage(
  taskId: string,
  developerMessage: string,
  validator: ValidatorVerdict,
): string {
  const header = developerMessage.trim() || `feat: ${taskId}`;
  const evidence = validator.evidence.trim();
  return `${header}\n\ntask=${taskId}\nvalidator: ${evidence}`;
}

type IterationOutcome =
  | { kind: "commit"; commitSha: string }
  | { kind: "retry"; resumeSessionId: string; validator: ValidatorVerdict }
  | { kind: "reset" }
  | { kind: "failed"; reason: string };

async function decideAfterValidator(args: {
  primaryCwd: string;
  phaseCwd: string;
  taskSlug: string;
  task: PlanTask;
  devVerdict: DeveloperVerdict;
  devSessionId: string;
  valVerdict: ValidatorVerdict;
  config: ResolvedHarnessConfig;
}): Promise<IterationOutcome> {
  const {
    primaryCwd,
    phaseCwd,
    taskSlug,
    task,
    devVerdict,
    devSessionId,
    valVerdict,
    config,
  } = args;

  if (valVerdict.verdict === "pass") {
    const message = composeCommitMessage(
      task.id,
      devVerdict.commit_message,
      valVerdict,
    );
    const sha = await commitComposed(phaseCwd, message);
    if (!sha) {
      await appendAudit(primaryCwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "commit",
        rationale: "validator pass, no file changes to commit",
      });
      return { kind: "commit", commitSha: "" };
    }
    await appendAudit(primaryCwd, taskSlug, {
      phase: "harness",
      event: "commit_executed",
      task_id: task.id,
      attempt: task.attempts,
      commit_sha: sha,
      message,
    });
    return { kind: "commit", commitSha: sha };
  }

  // verdict === "fail"
  const exceededRetryBudget = task.attempts >= config.maxIterationsPerTask;
  if (exceededRetryBudget) {
    return {
      kind: "failed",
      reason: `task exceeded maxIterationsPerTask=${config.maxIterationsPerTask}`,
    };
  }

  const forceReset =
    valVerdict.recommend_reset === true ||
    task.attempts >= config.maxRetriesBeforeReset;

  if (forceReset) return { kind: "reset" };

  return {
    kind: "retry",
    resumeSessionId: devSessionId,
    validator: valVerdict,
  };
}

export async function runHarness(args: {
  cwd: string;
  userPrompt: string;
  taskSlug?: string;
  isolation?: IsolationMode;
  logMode?: LogMode;
}): Promise<{ status: "done" | "failed" | "exhausted"; planPath: string; branch: string }> {
  const primaryCwd = args.cwd;
  const taskSlug = args.taskSlug?.trim() || defaultTaskSlug();
  const branch = `harness/${taskSlug}`;
  const logMode = args.logMode ?? "compact";
  const log = (msg: string) => { if (logMode !== "quiet") console.log(msg); };
  const warn = (msg: string) => { if (logMode !== "quiet") console.warn(msg); };

  const config = await loadHarnessConfig(primaryCwd);
  const isolation = args.isolation ?? config.isolation;

  log(`[harness] cwd=${primaryCwd} isolation=${isolation}`);
  log(`[harness] task=${taskSlug} branch=${branch}`);

  await assertIsGitRepo(primaryCwd);
  await assertBranchAbsent(primaryCwd, branch);

  let phaseCwd: string;
  let worktreePath: string | null = null;

  if (isolation === "inline") {
    // Inline: primary must be clean; create + checkout branch on primary;
    // phases run in primary.
    await assertCleanTree(primaryCwd);
    await createBranch(primaryCwd, branch);
    phaseCwd = primaryCwd;
  } else {
    // Worktree: primary stays where it was. Create branch + checkout in a
    // dedicated worktree dir. Primary's cleanliness is irrelevant because
    // the `.harness/<slug>/` state we write is gitignored by the tracked
    // `.harness/.gitignore`.
    worktreePath = worktreePathFor(primaryCwd, taskSlug);
    await assertWorktreePathAbsent(worktreePath);
    await addWorktree(primaryCwd, worktreePath, branch);
    phaseCwd = worktreePath;
    log(`[harness] worktree=${worktreePath}`);
  }

  log(
    `[harness] caps: per-task=${config.maxIterationsPerTask} retries-before-reset=${config.maxRetriesBeforeReset} global=${config.maxIterationsGlobal}`,
  );

  const cleanupWorktree = async (
    outcome: "done" | "failed" | "exhausted" | "blocked_fatal",
  ): Promise<void> => {
    if (isolation !== "worktree" || !worktreePath) return;
    if (outcome === "done") {
      try {
        await removeWorktree(primaryCwd, worktreePath, { force: true });
        log(`[harness] worktree removed: ${worktreePath}`);
      } catch (err) {
        warn(
          `[harness] worktree cleanup failed: ${(err as Error).message}`,
        );
      }
    } else {
      log(
        `[harness] worktree preserved for debug: ${worktreePath} (branch: ${branch})`,
      );
    }
  };

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

  // --- Planner phase -------------------------------------------------------
  log(`[harness] phase=planner`);
  const plannerResult = await runPlanner({
    phaseConfig: config.planner,
    primaryCwd,
    phaseCwd,
    taskSlug,
    userPrompt: args.userPrompt,
    logMode,
  });
  applyPlannerVerdict(plan, plannerResult.verdict, plannerResult.sessionId);
  await savePlan(planPath, plan);
  await appendAudit(primaryCwd, taskSlug, {
    phase: "planner",
    event: "completed",
    session_id: plannerResult.sessionId,
    task_count: plan.tasks.length,
  });

  // --- Dev/validator loop --------------------------------------------------
  let pendingResume: { sessionId: string; validator: ValidatorVerdict } | null =
    null;

  while (true) {
    if (isPlanComplete(plan)) {
      plan.status = "done";
      await savePlan(planPath, plan);
      log(`[harness] all tasks done.`);
      await cleanupWorktree("done");
      return { status: "done", planPath, branch };
    }

    if (plan.iterations_global >= config.maxIterationsGlobal) {
      plan.status = "exhausted";
      await savePlan(planPath, plan);
      log(`[harness] global iteration cap reached.`);
      await cleanupWorktree("exhausted");
      return { status: "exhausted", planPath, branch };
    }

    const task = findNextPendingTask(plan);
    if (!task) {
      plan.status = "failed";
      await savePlan(planPath, plan);
      log(`[harness] no pending tasks but plan not complete (failed).`);
      await cleanupWorktree("failed");
      return { status: "failed", planPath, branch };
    }

    if (pendingResume && task.history.length === 0) pendingResume = null;

    const prePhaseSha = await headSha(phaseCwd);

    plan.iterations_global += 1;
    markTaskInProgress(task);
    await savePlan(planPath, plan);

    log(
      `[harness] phase=developer task=${task.id} attempt=${task.attempts} global=${plan.iterations_global}${
        pendingResume ? " (resuming)" : ""
      }`,
    );

    const devResult = await runDeveloper({
      phaseConfig: config.developer,
      primaryCwd,
      phaseCwd,
      taskSlug,
      plan,
      task,
      resume: pendingResume
        ? {
            sessionId: pendingResume.sessionId,
            lastValidator: pendingResume.validator,
          }
        : null,
      logMode,
    });

    task.history.push({
      role: "developer",
      session_id: devResult.sessionId,
      at: new Date().toISOString(),
      status: devResult.verdict.status,
      summary: devResult.verdict.summary,
      ...(devResult.verdict.commit_message
        ? { commit_message: devResult.verdict.commit_message }
        : {}),
      ...(devResult.verdict.blocked_reason
        ? { blocked_reason: devResult.verdict.blocked_reason }
        : {}),
    });
    await savePlan(planPath, plan);
    await appendAudit(primaryCwd, taskSlug, {
      phase: "developer",
      event: "completed",
      session_id: devResult.sessionId,
      task_id: task.id,
      attempt: task.attempts,
      status: devResult.verdict.status,
      summary: devResult.verdict.summary,
      ...(devResult.verdict.commit_message
        ? { commit_message: devResult.verdict.commit_message }
        : {}),
      ...(devResult.verdict.blocked_reason
        ? { blocked_reason: devResult.verdict.blocked_reason }
        : {}),
    });

    pendingResume = null;

    if (devResult.verdict.status === "blocked") {
      markTaskFailed(task);
      plan.status = "failed";
      await savePlan(planPath, plan);
      await appendAudit(primaryCwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "blocked_fatal",
        rationale: `developer reported blocked: ${devResult.verdict.blocked_reason}`,
      });
      await resetHard(phaseCwd, prePhaseSha);
      await cleanUntracked(phaseCwd);
      log(
        `[harness] developer reported blocked — plan marked failed. Reason: ${devResult.verdict.blocked_reason}`,
      );
      await cleanupWorktree("blocked_fatal");
      return { status: "failed", planPath, branch };
    }

    // --- Validator phase ---------------------------------------------------
    log(`[harness] phase=validator task=${task.id}`);
    const valResult = await runValidator({
      phaseConfig: config.validator,
      primaryCwd,
      phaseCwd,
      taskSlug,
      plan,
      task,
      developerSummary: devResult.verdict.summary,
      logMode,
    });

    task.history.push({
      role: "validator",
      session_id: valResult.sessionId,
      at: new Date().toISOString(),
      verdict: valResult.verdict.verdict,
      reasons: valResult.verdict.reasons,
      evidence: valResult.verdict.evidence,
      ...(valResult.verdict.recommend_reset
        ? { recommend_reset: true }
        : {}),
    });
    await savePlan(planPath, plan);
    await appendAudit(primaryCwd, taskSlug, {
      phase: "validator",
      event: "completed",
      session_id: valResult.sessionId,
      task_id: task.id,
      attempt: task.attempts,
      verdict: valResult.verdict.verdict,
      reasons: valResult.verdict.reasons,
      evidence: valResult.verdict.evidence,
      ...(valResult.verdict.recommend_reset
        ? { recommend_reset: true }
        : {}),
    });

    log(
      `[harness] validator task=${task.id} verdict=${valResult.verdict.verdict} reasons=${valResult.verdict.reasons.length}`,
    );
    if (valResult.verdict.problems && valResult.verdict.problems.length > 0) {
      for (const p of valResult.verdict.problems) {
        log(
          `[harness] problem category=${p.category} severity=${p.severity} detail=${p.description}`,
        );
      }
    }

    const outcome = await decideAfterValidator({
      primaryCwd,
      phaseCwd,
      taskSlug,
      task,
      devVerdict: devResult.verdict,
      devSessionId: devResult.sessionId,
      valVerdict: valResult.verdict,
      config,
    });

    if (outcome.kind === "commit") {
      task.commit_sha = outcome.commitSha || null;
      markTaskDone(task);
      await savePlan(planPath, plan);
      const subject = devResult.verdict.commit_message.split("\n")[0] ?? "";
      log(
        `[harness] task ${task.id} committed sha=${outcome.commitSha.slice(0, 8) || "(empty)"} subject="${subject}"`,
      );
    } else if (outcome.kind === "retry") {
      await appendAudit(primaryCwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "retry",
        rationale: "validator fail, within retry budget and no reset requested",
      });
      pendingResume = {
        sessionId: outcome.resumeSessionId,
        validator: outcome.validator,
      };
      log(`[harness] task ${task.id} will retry (resume dev session)`);
    } else if (outcome.kind === "reset") {
      const before = await headSha(phaseCwd);
      await resetHard(phaseCwd, prePhaseSha);
      await cleanUntracked(phaseCwd);
      const after = await headSha(phaseCwd);
      await appendAudit(primaryCwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "reset",
        rationale:
          valResult.verdict.recommend_reset === true
            ? "validator recommended reset"
            : `maxRetriesBeforeReset=${config.maxRetriesBeforeReset} reached`,
      });
      await appendAudit(primaryCwd, taskSlug, {
        phase: "harness",
        event: "reset_executed",
        task_id: task.id,
        attempt: task.attempts,
        head_before: before,
        head_after: after,
      });
      log(
        `[harness] task ${task.id} tree reset to ${after.slice(0, 8)}`,
      );
    } else {
      markTaskFailed(task);
      await resetHard(phaseCwd, prePhaseSha);
      await cleanUntracked(phaseCwd);
      await savePlan(planPath, plan);
      await appendAudit(primaryCwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "failed",
        rationale: outcome.reason,
      });
      log(
        `[harness] task ${task.id} failed (${outcome.reason}); tree reset`,
      );
      await cleanupWorktree("failed");
      return { status: "failed", planPath, branch };
    }
  }
}
