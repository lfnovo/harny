import { defineWorkflow, type WorkflowContext } from "../workflow.js";
import { runPlanner } from "../phases/planner.js";
import { runDeveloper } from "../phases/developer.js";
import { runValidator } from "../phases/validator.js";
import {
  applyPlannerVerdict,
  findNextPendingTask,
  isPlanComplete,
  markTaskDone,
  markTaskFailed,
  markTaskInProgress,
} from "../plan.js";
import type { PlanTask } from "../types.js";
import type { DeveloperVerdict, ValidatorVerdict } from "../verdict.js";

export const featureDev = defineWorkflow({
  id: "feature-dev",
  needsBranch: true,
  needsWorktree: true,
  run: async (ctx) => {
    ctx.log(`[harness] phase=planner`);
    const plannerResult = await runPlanner({
      phaseConfig: ctx.config.planner,
      primaryCwd: ctx.primaryCwd,
      phaseCwd: ctx.phaseCwd,
      taskSlug: ctx.taskSlug,
      userPrompt: ctx.userPrompt,
      logMode: ctx.logMode,
    });
    await ctx.updatePlan((plan) => {
      applyPlannerVerdict(plan, plannerResult.verdict, plannerResult.sessionId);
    });
    await ctx.audit({ phase: "planner", event: "completed", session_id: plannerResult.sessionId, task_count: plannerResult.verdict.tasks.length });
    return runDevLoop(ctx);
  },
});

type IterationOutcome =
  | { kind: "commit"; commitSha: string }
  | { kind: "retry"; resumeSessionId: string; validator: ValidatorVerdict }
  | { kind: "reset" }
  | { kind: "failed"; reason: string };

function composeCommitMessage(
  taskId: string,
  developerMessage: string,
  validator: ValidatorVerdict,
): string {
  const header = developerMessage.trim() || `feat: ${taskId}`;
  const evidence = validator.evidence.trim();
  return `${header}\n\ntask=${taskId}\nvalidator: ${evidence}`;
}

async function decideAfterValidator(args: {
  ctx: WorkflowContext;
  task: PlanTask;
  devVerdict: DeveloperVerdict;
  devSessionId: string;
  valVerdict: ValidatorVerdict;
}): Promise<IterationOutcome> {
  const { ctx, task, devVerdict, devSessionId, valVerdict } = args;
  const config = ctx.config;

  if (valVerdict.verdict === "pass") {
    const message = composeCommitMessage(task.id, devVerdict.commit_message, valVerdict);
    const sha = await ctx.commit(message);
    if (!sha) {
      await ctx.audit({ phase: "harness", event: "decision", task_id: task.id, attempt: task.attempts, action: "commit", rationale: "validator pass, no file changes to commit" });
      return { kind: "commit", commitSha: "" };
    }
    await ctx.audit({ phase: "harness", event: "commit_executed", task_id: task.id, attempt: task.attempts, commit_sha: sha, message });
    return { kind: "commit", commitSha: sha };
  }

  const exceededRetryBudget = task.attempts >= config.maxIterationsPerTask;
  if (exceededRetryBudget) {
    return { kind: "failed", reason: `task exceeded maxIterationsPerTask=${config.maxIterationsPerTask}` };
  }

  const forceReset =
    valVerdict.recommend_reset === true ||
    task.attempts >= config.maxRetriesBeforeReset;
  if (forceReset) return { kind: "reset" };

  return { kind: "retry", resumeSessionId: devSessionId, validator: valVerdict };
}

async function runDevLoop(
  ctx: WorkflowContext,
): Promise<{ status: "done" | "failed" | "exhausted" }> {
  const plan = ctx.plan;
  let pendingResume: { sessionId: string; validator: ValidatorVerdict } | null = null;

  while (true) {
    if (isPlanComplete(plan)) {
      await ctx.updatePlan((p) => { p.status = "done"; });
      ctx.log(`[harness] all tasks done.`);
      return { status: "done" };
    }

    if (plan.iterations_global >= ctx.config.maxIterationsGlobal) {
      await ctx.updatePlan((p) => { p.status = "exhausted"; });
      ctx.log(`[harness] global iteration cap reached.`);
      return { status: "exhausted" };
    }

    const task = findNextPendingTask(plan);
    if (!task) {
      await ctx.updatePlan((p) => { p.status = "failed"; });
      ctx.log(`[harness] no pending tasks but plan not complete (failed).`);
      return { status: "failed" };
    }

    if (pendingResume && task.history.length === 0) pendingResume = null;

    const prePhaseSha = await ctx.currentSha();

    await ctx.updatePlan((p) => {
      const t = p.tasks.find((x) => x.id === task.id)!;
      markTaskInProgress(t);
      p.iterations_global += 1;
    });

    ctx.log(
      `[harness] phase=developer task=${task.id} attempt=${task.attempts} global=${plan.iterations_global}${pendingResume ? " (resuming)" : ""}`,
    );

    const devResult = await runDeveloper({
      phaseConfig: ctx.config.developer,
      primaryCwd: ctx.primaryCwd,
      phaseCwd: ctx.phaseCwd,
      taskSlug: ctx.taskSlug,
      plan,
      task,
      resume: pendingResume
        ? { sessionId: pendingResume.sessionId, lastValidator: pendingResume.validator }
        : null,
      logMode: ctx.logMode,
    });

    await ctx.updatePlan((p) => {
      const t = p.tasks.find((x) => x.id === task.id)!;
      t.history.push({
        role: "developer",
        session_id: devResult.sessionId,
        at: new Date().toISOString(),
        status: devResult.verdict.status,
        summary: devResult.verdict.summary,
        ...(devResult.verdict.commit_message ? { commit_message: devResult.verdict.commit_message } : {}),
        ...(devResult.verdict.blocked_reason ? { blocked_reason: devResult.verdict.blocked_reason } : {}),
      });
    });
    await ctx.audit({
      phase: "developer",
      event: "completed",
      session_id: devResult.sessionId,
      task_id: task.id,
      attempt: task.attempts,
      status: devResult.verdict.status,
      summary: devResult.verdict.summary,
      ...(devResult.verdict.commit_message ? { commit_message: devResult.verdict.commit_message } : {}),
      ...(devResult.verdict.blocked_reason ? { blocked_reason: devResult.verdict.blocked_reason } : {}),
    });

    pendingResume = null;

    if (devResult.verdict.status === "blocked") {
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        markTaskFailed(t);
        p.status = "failed";
      });
      await ctx.audit({ phase: "harness", event: "decision", task_id: task.id, attempt: task.attempts, action: "blocked_fatal", rationale: `developer reported blocked: ${devResult.verdict.blocked_reason}` });
      await ctx.resetHard(prePhaseSha);
      await ctx.cleanUntracked();
      ctx.log(`[harness] developer reported blocked — plan marked failed. Reason: ${devResult.verdict.blocked_reason}`);
      return { status: "failed" };
    }

    ctx.log(`[harness] phase=validator task=${task.id}`);
    const valResult = await runValidator({
      phaseConfig: ctx.config.validator,
      primaryCwd: ctx.primaryCwd,
      phaseCwd: ctx.phaseCwd,
      taskSlug: ctx.taskSlug,
      plan,
      task,
      developerSummary: devResult.verdict.summary,
      logMode: ctx.logMode,
    });

    await ctx.updatePlan((p) => {
      const t = p.tasks.find((x) => x.id === task.id)!;
      t.history.push({
        role: "validator",
        session_id: valResult.sessionId,
        at: new Date().toISOString(),
        verdict: valResult.verdict.verdict,
        reasons: valResult.verdict.reasons,
        evidence: valResult.verdict.evidence,
        ...(valResult.verdict.recommend_reset ? { recommend_reset: true } : {}),
      });
    });
    await ctx.audit({
      phase: "validator",
      event: "completed",
      session_id: valResult.sessionId,
      task_id: task.id,
      attempt: task.attempts,
      verdict: valResult.verdict.verdict,
      reasons: valResult.verdict.reasons,
      evidence: valResult.verdict.evidence,
      ...(valResult.verdict.recommend_reset ? { recommend_reset: true } : {}),
    });

    ctx.log(
      `[harness] validator task=${task.id} verdict=${valResult.verdict.verdict} reasons=${valResult.verdict.reasons.length}`,
    );
    if (valResult.verdict.problems && valResult.verdict.problems.length > 0) {
      for (const p of valResult.verdict.problems) {
        ctx.log(`[harness] problem category=${p.category} severity=${p.severity} detail=${p.description}`);
      }
    }

    const outcome = await decideAfterValidator({
      ctx,
      task,
      devVerdict: devResult.verdict,
      devSessionId: devResult.sessionId,
      valVerdict: valResult.verdict,
    });

    if (outcome.kind === "commit") {
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        t.commit_sha = outcome.commitSha || null;
        markTaskDone(t);
      });
      const subject = devResult.verdict.commit_message.split("\n")[0] ?? "";
      ctx.log(
        `[harness] task ${task.id} committed sha=${outcome.commitSha.slice(0, 8) || "(empty)"} subject="${subject}"`,
      );
    } else if (outcome.kind === "retry") {
      await ctx.audit({ phase: "harness", event: "decision", task_id: task.id, attempt: task.attempts, action: "retry", rationale: "validator fail, within retry budget and no reset requested" });
      pendingResume = { sessionId: outcome.resumeSessionId, validator: outcome.validator };
      ctx.log(`[harness] task ${task.id} will retry (resume dev session)`);
    } else if (outcome.kind === "reset") {
      const before = await ctx.currentSha();
      await ctx.resetHard(prePhaseSha);
      await ctx.cleanUntracked();
      const after = await ctx.currentSha();
      await ctx.audit({ phase: "harness", event: "decision", task_id: task.id, attempt: task.attempts, action: "reset", rationale: valResult.verdict.recommend_reset === true ? "validator recommended reset" : `maxRetriesBeforeReset=${ctx.config.maxRetriesBeforeReset} reached` });
      await ctx.audit({ phase: "harness", event: "reset_executed", task_id: task.id, attempt: task.attempts, head_before: before, head_after: after });
      ctx.log(`[harness] task ${task.id} tree reset to ${after.slice(0, 8)}`);
    } else {
      await ctx.updatePlan((p) => {
        const t = p.tasks.find((x) => x.id === task.id)!;
        markTaskFailed(t);
      });
      await ctx.resetHard(prePhaseSha);
      await ctx.cleanUntracked();
      await ctx.audit({ phase: "harness", event: "decision", task_id: task.id, attempt: task.attempts, action: "failed", rationale: outcome.reason });
      ctx.log(`[harness] task ${task.id} failed (${outcome.reason}); tree reset`);
      return { status: "failed" };
    }
  }
}
