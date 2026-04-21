import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { loadHarnessConfig } from "./config.js";
import { runPhase as runPhaseSession } from "./sessionRecorder.js";
import {
  createPlanSkeleton,
  planFilePath,
  savePlan,
  worktreePathFor,
  loadPlan,
} from "./state/plan.js";
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
import { appendAudit } from "./state/audit.js";
import { resolveAnswer, SilentModeError, PausedForUserInputError } from "./askUser.js";
import { getRegistry } from "./state/registry.js";
import { getWorkflow } from "./workflows/index.js";
import type { IsolationMode, LogMode, PhaseName, ResolvedHarnessConfig, RunMode } from "./types.js";
import type { WorkflowContext, WorkflowPhaseResult } from "./workflow.js";
import type { Workflow } from "./workflow.js";

function defaultTaskSlug(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${iso}`;
}

function buildCtx(args: {
  runId: string;
  taskSlug: string;
  userPrompt: string;
  primaryCwd: string;
  phaseCwd: string;
  worktreePath: string | null;
  input: unknown;
  config: ResolvedHarnessConfig;
  logMode: LogMode;
  planPath: string;
  plan: import("./types.js").Plan;
  workflow: Workflow;
  branch: string;
}): WorkflowContext {
  const { runId, taskSlug, userPrompt, primaryCwd, phaseCwd, input, logMode, planPath, plan, workflow } = args;
  const config = args.config;
  const log = (msg: string) => { if (logMode !== "quiet") console.log(msg); };
  const warn = (msg: string) => { if (logMode !== "quiet") console.warn(msg); };
  const registry = getRegistry();

  const ctx: WorkflowContext = {
    taskSlug,
    userPrompt,
    primaryCwd,
    phaseCwd,
    input,
    config,
    logMode,
    mode: config.mode,
    planPath,
    plan,
    log,
    warn,
    updatePlan: async (mutator) => {
      mutator(plan);
      await savePlan(planPath, plan);
    },
    audit: async (entry) => {
      await appendAudit(primaryCwd, taskSlug, entry);
      if ((entry as Record<string, unknown>).phase === "harness") {
        registry.insertEvent({
          run_id: runId,
          phase: "harness",
          event_type: String((entry as Record<string, unknown>).event ?? "decision"),
          payload_json: JSON.stringify(entry),
          at: new Date().toISOString(),
        });
      }
    },
    currentSha: () => headSha(phaseCwd),
    commit: (message) => commitComposed(phaseCwd, message),
    resetHard: (sha) => resetHard(phaseCwd, sha),
    cleanUntracked: () => cleanUntracked(phaseCwd),
    runPhase: async <T>(phaseArgs: {
      phase: PhaseName;
      prompt: string;
      outputSchema: import("zod").ZodType<T>;
      harnessTaskId?: string | null;
      allowedTools?: string[];
      guards?: import("./guardHooks.js").PhaseGuards;
      resumeSessionId?: string | null;
    }): Promise<WorkflowPhaseResult<T>> => {
      const baseConfig = config.phases[phaseArgs.phase];
      if (!baseConfig) {
        throw new Error(
          `Workflow "${workflow.id}" tried to run phase "${phaseArgs.phase}" but no config exists for it. Declare it in the workflow's phaseDefaults or in harness.json's phases map.`,
        );
      }
      const phaseConfig = phaseArgs.allowedTools
        ? { ...baseConfig, allowedTools: phaseArgs.allowedTools }
        : baseConfig;

      registry.insertEvent({
        run_id: runId,
        phase: phaseArgs.phase,
        event_type: "phase_start",
        payload_json: JSON.stringify({ harnessTaskId: phaseArgs.harnessTaskId ?? null }),
        at: new Date().toISOString(),
      });

      let phaseStatus: "completed" | "error" | "paused_for_user_input" = "error";
      let phaseError: string | null = null;
      try {
        const result = await runPhaseSession({
          phase: phaseArgs.phase,
          phaseConfig,
          primaryCwd,
          phaseCwd,
          taskSlug,
          harnessTaskId: phaseArgs.harnessTaskId ?? null,
          prompt: phaseArgs.prompt,
          outputSchema: phaseArgs.outputSchema,
          resumeSessionId: phaseArgs.resumeSessionId ?? null,
          logMode,
          guards: phaseArgs.guards,
          mode: config.mode,
        });
        phaseStatus = result.status;
        phaseError = result.error;

        registry.insertEvent({
          run_id: runId,
          phase: phaseArgs.phase,
          event_type: "phase_end",
          payload_json: JSON.stringify({ status: result.status, error: result.error ?? null }),
          at: new Date().toISOString(),
        });

        if (result.status === "paused_for_user_input" && result.parked) {
          // Persist the parked AskUserQuestion batch + throw so the orchestrator
          // outer catch maps it to status=waiting_human and exits cleanly.
          const questionId = randomUUID();
          registry.insertQuestion({
            id: questionId,
            run_id: runId,
            kind: "ask_user_question_batch",
            prompt: result.parked.askUserInput.questions[0]?.question ?? "(batch)",
            options_json: JSON.stringify(result.parked.askUserInput.questions),
            asked_at: new Date().toISOString(),
            phase_session_id: result.sessionId,
            tool_use_id: result.parked.toolUseId,
            phase_name: phaseArgs.phase,
          });
          registry.updateRun(runId, { pending_question_id: questionId });
          throw new PausedForUserInputError({
            questionId,
            phaseSessionId: result.sessionId,
            toolUseId: result.parked.toolUseId,
            phaseName: phaseArgs.phase,
          });
        }

        return {
          sessionId: result.sessionId,
          status: result.status === "paused_for_user_input" ? "error" : result.status,
          structuredOutput: result.structuredOutput,
          error: result.error,
        };
      } catch (err) {
        phaseError = (err as Error).message;
        registry.insertEvent({
          run_id: runId,
          phase: phaseArgs.phase,
          event_type: "phase_end",
          payload_json: JSON.stringify({ status: "error", error: phaseError }),
          at: new Date().toISOString(),
        });
        throw err;
      }
    },
    askUser: async (askArgs: { prompt: string; options?: string[] }) => {
      if (config.mode === "silent") {
        throw new SilentModeError();
      }
      if (config.mode === "interactive") {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string) =>
          new Promise<string>((resolve) => {
            rl.question(q, (ans) => resolve(ans));
          });

        const hasOptions = askArgs.options && askArgs.options.length > 0;
        let promptText: string;
        if (hasOptions) {
          const lines = [askArgs.prompt];
          askArgs.options!.forEach((o, i) => lines.push(`  ${i + 1}. ${o}`));
          lines.push("Your choice (number or text): ");
          promptText = lines.join("\n");
        } else {
          promptText = `${askArgs.prompt}\n> `;
        }

        let answer: string;
        while (true) {
          const raw = await ask(promptText);
          const resolved = resolveAnswer(askArgs.options ?? null, raw);
          if (resolved.ok) {
            answer = resolved.value;
            if (hasOptions) {
              process.stdout.write(`\u2192 selected: ${answer}\n`);
            }
            break;
          }
          process.stdout.write(`${resolved.error}\n`);
          promptText = "Your choice (number or text): ";
        }
        rl.close();
        return { answered: true, answer };
      }

      const questionId = randomUUID();
      registry.insertQuestion({
        id: questionId,
        run_id: runId,
        kind: "user_input",
        prompt: askArgs.prompt,
        options_json: askArgs.options ? JSON.stringify(askArgs.options) : null,
        asked_at: new Date().toISOString(),
      });
      registry.updateRun(runId, { pending_question_id: questionId });
      return { answered: false, runId, questionId };
    },
  };

  return ctx;
}

export async function runHarness(args: {
  cwd: string;
  userPrompt: string;
  taskSlug?: string;
  workflowId?: string;
  isolation?: IsolationMode;
  mode?: RunMode;
  logMode?: LogMode;
  input?: unknown;
}): Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human"; planPath: string; branch: string }> {
  const primaryCwd = args.cwd;
  const taskSlug = args.taskSlug?.trim() || defaultTaskSlug();
  const logMode = args.logMode ?? "compact";
  const log = (msg: string) => { if (logMode !== "quiet") console.log(msg); };

  const workflow = getWorkflow(args.workflowId ?? "feature-dev");
  const config = await loadHarnessConfig(primaryCwd, workflow, args.mode);
  const isolation = args.isolation ?? config.isolation;
  const registry = getRegistry();

  log(`[harness] cwd=${primaryCwd} isolation=${isolation}`);
  log(`[harness] workflow=${workflow.id} task=${taskSlug}`);
  log(`[harness] user prompt >>>`);
  log(args.userPrompt);
  log(`[harness] user prompt <<<`);

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

  const runId = randomUUID();
  plan.run_id = runId;
  await savePlan(planPath, plan);

  registry.insertRun({
    id: runId,
    workflow_id: workflow.id,
    cwd: primaryCwd,
    status: "running",
    started_at: new Date().toISOString(),
    task_slug: taskSlug,
    branch,
    isolation,
    worktree_path: worktreePath,
  });

  const ctx = buildCtx({
    runId,
    taskSlug,
    userPrompt: args.userPrompt,
    primaryCwd,
    phaseCwd,
    worktreePath,
    input: args.input,
    config,
    logMode,
    planPath,
    plan,
    workflow,
    branch,
  });

  const handleCleanupWorktree = async (
    outcome: "done" | "failed" | "exhausted" | "waiting_human",
  ): Promise<void> => {
    if (!worktreePath) return;
    if (outcome === "done") {
      try {
        await removeWorktree(primaryCwd, worktreePath, { force: true });
        log(`[harness] worktree removed: ${worktreePath}`);
      } catch (err) {
        ctx.warn(`[harness] worktree cleanup failed: ${(err as Error).message}`);
      }
    } else {
      log(`[harness] worktree preserved: ${worktreePath} (branch: ${branch})`);
    }
  };

  let result: { status: "done" | "failed" | "exhausted" | "waiting_human" };
  try {
    result = await workflow.run(ctx);
  } catch (err) {
    if (err instanceof PausedForUserInputError) {
      // ctx.runPhase already inserted pending_question + updateRun; just exit clean.
      registry.updateRun(runId, { status: "waiting_human" });
      log(`[harness] run parked (waiting_human, AskUserQuestion) runId=${runId} question=${err.questionId}`);
      return { status: "waiting_human", planPath, branch };
    }
    throw err;
  }

  if (result.status === "waiting_human") {
    registry.updateRun(runId, { status: "waiting_human" });
    log(`[harness] run parked (waiting_human) runId=${runId}`);
    return { status: "waiting_human", planPath, branch };
  }

  await handleCleanupWorktree(result.status);

  registry.updateRun(runId, {
    status: result.status === "done" ? "done" : "failed",
    ended_at: new Date().toISOString(),
    ended_reason: result.status,
  });

  return { status: result.status, planPath, branch };
}

export async function resumeHarness(
  runId: string,
  answer: string | Record<string, string>,
): Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human" }> {
  const registry = getRegistry();
  const run = registry.getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.status !== "waiting_human") {
    throw new Error(`Run ${runId} is not in waiting_human status (current: ${run.status})`);
  }

  const primaryCwd = run.cwd;
  const taskSlug = run.task_slug;

  const planPath = planFilePath(primaryCwd, taskSlug);
  const plan = await loadPlan(planPath);

  const workflow = getWorkflow(run.workflow_id);
  if (!workflow.resumeFromAnswer) {
    throw new Error(`Workflow "${run.workflow_id}" does not implement resumeFromAnswer`);
  }

  const config = await loadHarnessConfig(primaryCwd, workflow);
  const phaseCwd = run.worktree_path ?? primaryCwd;
  const logMode: LogMode = "compact";

  // Load the parked question to know whether this is a code-side ctx.askUser
  // resume or an SDK AskUserQuestion batch resume.
  let resumeMeta: { phaseName: string; phaseSessionId: string; toolUseId: string | null } | undefined;
  if (run.pending_question_id) {
    const q = registry.getQuestion(run.pending_question_id);
    if (q && q.kind === "ask_user_question_batch" && q.phase_session_id && q.phase_name) {
      resumeMeta = {
        phaseName: q.phase_name,
        phaseSessionId: q.phase_session_id,
        toolUseId: q.tool_use_id,
      };
    }
    registry.answerQuestion(run.pending_question_id, JSON.stringify(answer));
  }
  registry.updateRun(runId, { status: "running", pending_question_id: null });

  const ctx = buildCtx({
    runId,
    taskSlug,
    userPrompt: plan.user_prompt,
    primaryCwd,
    phaseCwd,
    worktreePath: run.worktree_path,
    input: typeof answer === "string" ? { intent: answer } : { answers: answer },
    config,
    logMode,
    planPath,
    plan,
    workflow,
    branch: run.branch,
  });

  if (resumeMeta) {
    ctx.resumeMeta = resumeMeta;
  }

  const result = await workflow.resumeFromAnswer(ctx, answer);

  if (result.status === "waiting_human") {
    registry.updateRun(runId, { status: "waiting_human" });
    return { status: "waiting_human" };
  }

  if (result.status === "done" && run.worktree_path) {
    try {
      await removeWorktree(primaryCwd, run.worktree_path, { force: true });
    } catch {
      // best effort
    }
  }

  registry.updateRun(runId, {
    status: result.status === "done" ? "done" : "failed",
    ended_at: new Date().toISOString(),
    ended_reason: result.status,
    pending_question_id: null,
  });

  return { status: result.status };
}
