import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadHarnessConfig } from "./config.js";
import {
  appendHistory,
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
  createBranch,
  headSha,
  stageAndCommit,
} from "./git.js";
import { runPlanner } from "./phases/planner.js";
import { runDeveloper } from "./phases/developer.js";
import { runValidator } from "./phases/validator.js";

function defaultTaskSlug(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${iso}`;
}

async function ensureHarnessGitignore(cwd: string, taskSlug: string) {
  const dir = planDir(cwd, taskSlug);
  await mkdir(dir, { recursive: true });
  // Ignore sessions/ inside the task dir (events are noisy) while plan.json
  // stays versioned.
  await writeFile(join(dir, ".gitignore"), "sessions/\n", "utf8");
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

  // Preconditions
  await assertIsGitRepo(cwd);
  await assertCleanTree(cwd);
  await assertBranchAbsent(cwd, branch);

  const config = await loadHarnessConfig(cwd);
  console.log(
    `[harness] iterations: per-task=${config.maxIterationsPerTask} global=${config.maxIterationsGlobal}`,
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

  // Planner phase
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
  console.log(
    `[harness] plan has ${plan.tasks.length} task(s). first: ${plan.tasks[0]?.id}`,
  );

  // Commit plan.json so the planning step is reflected in history.
  const plannerCommit = await stageAndCommit(
    cwd,
    `chore(harness): plan ${taskSlug}\n\n${plan.summary}`,
  );
  if (plannerCommit) {
    console.log(`[harness] planner commit=${plannerCommit.slice(0, 8)}`);
  }

  // Dev/validator loop
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
      // No pending task but not complete -> all remaining are failed.
      plan.status = "failed";
      await savePlan(planPath, plan);
      console.log(`[harness] no pending tasks but plan not complete (failed tasks).`);
      return { status: "failed", planPath };
    }

    if (task.attempts >= config.maxIterationsPerTask) {
      markTaskFailed(task);
      await savePlan(planPath, plan);
      console.log(
        `[harness] task ${task.id} exceeded per-task iteration cap; marked failed.`,
      );
      continue;
    }

    plan.iterations_global += 1;
    markTaskInProgress(task);
    await savePlan(planPath, plan);

    console.log(
      `[harness] phase=developer task=${task.id} attempt=${task.attempts} global=${plan.iterations_global}`,
    );
    const devResult = await runDeveloper({
      phaseConfig: config.developer,
      cwd,
      taskSlug,
      plan,
      task,
      verbose: args.verbose,
    });

    // Dev might or might not have committed itself; either way ensure the
    // tree is committed so validator sees a stable snapshot.
    const devCommit =
      devResult.verdict.commit_sha ||
      (await stageAndCommit(
        cwd,
        `feat(${taskSlug}): ${task.title}\n\ntask=${task.id}\n${devResult.verdict.summary}`,
      )) ||
      (await headSha(cwd));

    appendHistory(task, {
      role: "developer",
      session_id: devResult.sessionId,
      at: new Date().toISOString(),
      status: devResult.verdict.status,
      summary: devResult.verdict.summary,
      commit_sha: devCommit,
      ...(devResult.verdict.blocked_reason
        ? { blocked_reason: devResult.verdict.blocked_reason }
        : {}),
    });
    await savePlan(planPath, plan);

    if (devResult.verdict.status === "blocked") {
      console.log(
        `[harness] developer reported blocked: ${devResult.verdict.blocked_reason}`,
      );
      // Let the per-task counter take care of retries; status stays in_progress.
      continue;
    }

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

    appendHistory(task, {
      role: "validator",
      session_id: valResult.sessionId,
      at: new Date().toISOString(),
      verdict: valResult.verdict.verdict,
      reasons: valResult.verdict.reasons,
      evidence: valResult.verdict.evidence,
    });

    if (valResult.verdict.verdict === "pass") {
      markTaskDone(task);
      console.log(`[harness] task ${task.id} passed.`);
    } else {
      // Leave status as in_progress; next iteration will re-enter the task
      // until the per-task cap is exceeded.
      console.log(
        `[harness] task ${task.id} failed validation: ${valResult.verdict.reasons.join("; ")}`,
      );
    }
    await savePlan(planPath, plan);
  }
}
