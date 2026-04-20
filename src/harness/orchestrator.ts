import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadHarnessConfig } from "./config.js";
import {
  applyPlannerVerdict,
  createPlanSkeleton,
  findNextPendingTask,
  isPlanComplete,
  markTaskDone,
  markTaskFailed,
  markTaskInProgress,
  planDir,
  planFilePath,
  savePlan,
} from "./plan.js";
import {
  assertBranchAbsent,
  assertCleanTree,
  assertIsGitRepo,
  cleanUntracked,
  commitComposed,
  createBranch,
  headSha,
  resetHard,
} from "./git.js";
import { appendAudit } from "./audit.js";
import { runPlanner } from "./phases/planner.js";
import { runDeveloper } from "./phases/developer.js";
import { runValidator } from "./phases/validator.js";
import type { PlanTask, ResolvedHarnessConfig } from "./types.js";
import type { DeveloperVerdict, ValidatorVerdict } from "./verdict.js";

function defaultTaskSlug(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${iso}`;
}

async function ensureHarnessGitignore(cwd: string, taskSlug: string) {
  const dir = planDir(cwd, taskSlug);
  await mkdir(dir, { recursive: true });
  // Ignore everything inside the task dir except plan.json — sessions/ and
  // audit.jsonl are noise for PRs.
  await writeFile(
    join(dir, ".gitignore"),
    "sessions/\naudit.jsonl\n",
    "utf8",
  );
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
  cwd: string;
  taskSlug: string;
  task: PlanTask;
  devVerdict: DeveloperVerdict;
  devSessionId: string;
  valVerdict: ValidatorVerdict;
  config: ResolvedHarnessConfig;
}): Promise<IterationOutcome> {
  const { cwd, taskSlug, task, devVerdict, devSessionId, valVerdict, config } =
    args;

  if (valVerdict.verdict === "pass") {
    const message = composeCommitMessage(
      task.id,
      devVerdict.commit_message,
      valVerdict,
    );
    const sha = await commitComposed(cwd, message);
    if (!sha) {
      // Nothing to commit — the dev didn't touch tracked state. Treat as
      // pass anyway; the harness recorded the decision.
      await appendAudit(cwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "commit",
        rationale: "validator pass, no file changes to commit",
      });
      return { kind: "commit", commitSha: "" };
    }
    await appendAudit(cwd, taskSlug, {
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
  verbose?: boolean;
}): Promise<{ status: "done" | "failed" | "exhausted"; planPath: string }> {
  const cwd = args.cwd;
  const taskSlug = args.taskSlug?.trim() || defaultTaskSlug();
  const branch = `harness/${taskSlug}`;

  console.log(`[harness] cwd=${cwd}`);
  console.log(`[harness] task=${taskSlug} branch=${branch}`);

  await assertIsGitRepo(cwd);
  await assertCleanTree(cwd);
  await assertBranchAbsent(cwd, branch);

  const config = await loadHarnessConfig(cwd);
  console.log(
    `[harness] caps: per-task=${config.maxIterationsPerTask} retries-before-reset=${config.maxRetriesBeforeReset} global=${config.maxIterationsGlobal}`,
  );

  await createBranch(cwd, branch);
  await ensureHarnessGitignore(cwd, taskSlug);

  const planPath = planFilePath(cwd, taskSlug);
  const plan = createPlanSkeleton({
    taskSlug,
    userPrompt: args.userPrompt,
    branch,
    cwd,
  });
  await savePlan(planPath, plan);

  // --- Planner phase -------------------------------------------------------
  console.log(`[harness] phase=planner`);
  const plannerResult = await runPlanner({
    phaseConfig: config.planner,
    cwd,
    taskSlug,
    userPrompt: args.userPrompt,
    verbose: args.verbose,
  });
  applyPlannerVerdict(plan, plannerResult.verdict, plannerResult.sessionId);
  await savePlan(planPath, plan);
  await appendAudit(cwd, taskSlug, {
    phase: "planner",
    event: "completed",
    session_id: plannerResult.sessionId,
    task_count: plan.tasks.length,
  });

  const planCommitMessage = `chore(harness): plan ${taskSlug}\n\n${plan.summary}`;
  const planCommit = await commitComposed(cwd, planCommitMessage);
  if (planCommit) {
    console.log(`[harness] planner commit=${planCommit.slice(0, 8)}`);
  }

  // --- Dev/validator loop --------------------------------------------------
  let pendingResume: { sessionId: string; validator: ValidatorVerdict } | null =
    null;

  while (true) {
    if (isPlanComplete(plan)) {
      plan.status = "done";
      await savePlan(planPath, plan);
      console.log(`[harness] all tasks done.`);
      return { status: "done", planPath };
    }

    if (plan.iterations_global >= config.maxIterationsGlobal) {
      plan.status = "exhausted";
      await savePlan(planPath, plan);
      console.log(`[harness] global iteration cap reached.`);
      return { status: "exhausted", planPath };
    }

    const task = findNextPendingTask(plan);
    if (!task) {
      plan.status = "failed";
      await savePlan(planPath, plan);
      console.log(`[harness] no pending tasks but plan not complete (failed).`);
      return { status: "failed", planPath };
    }

    // If the retry is stale (different task), drop it.
    if (pendingResume && task.history.length === 0) pendingResume = null;

    // Capture the branch head BEFORE the dev runs so reset can rewind tree.
    const prePhaseSha = await headSha(cwd);

    plan.iterations_global += 1;
    markTaskInProgress(task);
    await savePlan(planPath, plan);

    console.log(
      `[harness] phase=developer task=${task.id} attempt=${task.attempts} global=${plan.iterations_global}${
        pendingResume ? " (resuming)" : ""
      }`,
    );

    const devResult = await runDeveloper({
      phaseConfig: config.developer,
      cwd,
      taskSlug,
      plan,
      task,
      resume: pendingResume
        ? {
            sessionId: pendingResume.sessionId,
            lastValidator: pendingResume.validator,
          }
        : null,
      verbose: args.verbose,
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
    await appendAudit(cwd, taskSlug, {
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

    // Blocked is fatal: it means the harness itself (prompt/tooling) is
    // broken, or the plan is infeasible. Human triage required.
    if (devResult.verdict.status === "blocked") {
      markTaskFailed(task);
      plan.status = "failed";
      await savePlan(planPath, plan);
      await appendAudit(cwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "blocked_fatal",
        rationale: `developer reported blocked: ${devResult.verdict.blocked_reason}`,
      });
      // Reset the tree so the branch only shows committed work.
      await resetHard(cwd, prePhaseSha);
      await cleanUntracked(cwd);
      console.log(
        `[harness] developer reported blocked — plan marked failed. Reason: ${devResult.verdict.blocked_reason}`,
      );
      return { status: "failed", planPath };
    }

    // --- Validator phase ---------------------------------------------------
    console.log(`[harness] phase=validator task=${task.id}`);
    const valResult = await runValidator({
      phaseConfig: config.validator,
      cwd,
      taskSlug,
      plan,
      task,
      developerSummary: devResult.verdict.summary,
      verbose: args.verbose,
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
    await appendAudit(cwd, taskSlug, {
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

    const outcome = await decideAfterValidator({
      cwd,
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
      console.log(
        `[harness] task ${task.id} committed sha=${outcome.commitSha.slice(0, 8) || "(empty)"}`,
      );
    } else if (outcome.kind === "retry") {
      await appendAudit(cwd, taskSlug, {
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
      console.log(`[harness] task ${task.id} will retry (resume dev session)`);
    } else if (outcome.kind === "reset") {
      const before = await headSha(cwd);
      await resetHard(cwd, prePhaseSha);
      await cleanUntracked(cwd);
      const after = await headSha(cwd);
      await appendAudit(cwd, taskSlug, {
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
      await appendAudit(cwd, taskSlug, {
        phase: "harness",
        event: "reset_executed",
        task_id: task.id,
        attempt: task.attempts,
        head_before: before,
        head_after: after,
      });
      console.log(`[harness] task ${task.id} tree reset to ${after.slice(0, 8)}`);
    } else {
      // failed
      markTaskFailed(task);
      await resetHard(cwd, prePhaseSha);
      await cleanUntracked(cwd);
      await savePlan(planPath, plan);
      await appendAudit(cwd, taskSlug, {
        phase: "harness",
        event: "decision",
        task_id: task.id,
        attempt: task.attempts,
        action: "failed",
        rationale: outcome.reason,
      });
      console.log(
        `[harness] task ${task.id} failed (${outcome.reason}); tree reset`,
      );
    }
  }
}
