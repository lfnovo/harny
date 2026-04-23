import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadHarnessConfig } from "./config.js";
import { coldInstallWorktree } from "./coldInstall.js";
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
  assertHasInitialCommit,
  assertIsGitRepo,
  assertNoSiblingBranchOwnsTouchedPaths,
  assertWorktreePathAbsent,
  cleanUntracked,
  commitComposed,
  createBranch,
  headSha,
  listDiffPaths,
  removeWorktree,
  resetHard,
} from "./git.js";
import { writeProblems } from "./state/problem.js";
import { resolveAnswer, SilentModeError, PausedForUserInputError } from "./askUser.js";
import { FilesystemStateStore, findRun } from "./state/filesystem.js";
import type { State } from "./state/schema.js";
import type { StateStore } from "./state/store.js";
import { setupPhoenix, withRunSpan } from "./observability/phoenix.js";
import { getWorkflow, isEngineWorkflow } from "./workflows/index.js";
import { runEngineWorkflow } from "./engine/runtime/runEngineWorkflow.js";
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
  store: StateStore;
}): WorkflowContext {
  const {
    runId,
    taskSlug,
    userPrompt,
    primaryCwd,
    phaseCwd,
    input,
    logMode,
    planPath,
    plan,
    workflow,
    store,
  } = args;
  const config = args.config;
  const log = (msg: string) => {
    if (logMode !== "quiet") console.log(msg);
  };
  const warn = (msg: string) => {
    if (logMode !== "quiet") console.warn(msg);
  };

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
      // history[] mirrors the old audit.jsonl semantics; kept as the only
      // append-only log per run (Sub-fase 0 design — single state.json file).
      const phase = String((entry as Record<string, unknown>).phase ?? "harness");
      const event = String((entry as Record<string, unknown>).event ?? "decision");
      await store.appendHistory({
        ...entry,
        at: new Date().toISOString(),
        phase,
        event,
      });
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

      // Compute attempt number from existing phases of the same name.
      const stateBefore = await store.getState();
      const sameName = stateBefore?.phases.filter((p) => p.name === phaseArgs.phase) ?? [];
      const attempt = sameName.length + 1;
      const startedAt = new Date().toISOString();

      await store.appendPhase({
        name: phaseArgs.phase,
        attempt,
        started_at: startedAt,
        ended_at: null,
        status: "running",
        verdict: null,
        session_id: null,
      });
      await store.updateLifecycle({ current_phase: phaseArgs.phase });
      await store.appendHistory({
        at: startedAt,
        phase: phaseArgs.phase,
        event: "phase_start",
        attempt,
        harnessTaskId: phaseArgs.harnessTaskId ?? null,
      });

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
          workflowId: workflow.id,
          runId,
        });

        const phaseStatus =
          result.status === "completed"
            ? ("completed" as const)
            : result.status === "paused_for_user_input"
              ? ("parked" as const)
              : ("failed" as const);
        await store.updatePhase(phaseArgs.phase, attempt, {
          ended_at: new Date().toISOString(),
          status: phaseStatus,
          session_id: result.sessionId,
        });
        await store.appendHistory({
          at: new Date().toISOString(),
          phase: phaseArgs.phase,
          event: "phase_end",
          attempt,
          status: result.status,
          error: result.error ?? null,
        });

        if (phaseArgs.phase === "developer" && phaseStatus === "completed" && args.branch) {
          let guardEnabled = true;
          try {
            const raw = JSON.parse(await readFile(join(primaryCwd, "harny.json"), "utf8")) as Record<string, unknown>;
            if (raw.siblingBranchGuard === false) guardEnabled = false;
          } catch { /* ENOENT or parse error — default true */ }

          if (guardEnabled) {
            const touchedPaths = await listDiffPaths(phaseCwd);
            if (touchedPaths.length > 0) {
              const { warnings } = await assertNoSiblingBranchOwnsTouchedPaths(
                primaryCwd, args.branch, touchedPaths,
              );
              if (warnings.length > 0) {
                warn(`[harny] WARNING: ${warnings.length} sibling-branch overlap(s) detected`);
                await writeProblems({
                  primaryCwd,
                  taskSlug,
                  phase: phaseArgs.phase,
                  sessionId: result.sessionId ?? "",
                  taskId: phaseArgs.harnessTaskId ?? null,
                  problems: warnings.map(w => ({
                    category: "design" as const,
                    severity: "medium" as const,
                    description: `Sibling branch ${w.siblingBranch} already touches ${w.path}; merge may regress or conflict.`,
                  })),
                });
              }
            }
          }
        }

        if (result.status === "paused_for_user_input" && result.parked) {
          // Persist the parked AskUserQuestion batch + throw so the orchestrator
          // outer catch maps it to status=waiting_human and exits cleanly.
          const questionId = randomUUID();
          await store.setPendingQuestion({
            id: questionId,
            kind: "ask_user_question_batch",
            prompt: result.parked.askUserInput.questions[0]?.question ?? "(batch)",
            options: result.parked.askUserInput.questions,
            asked_at: new Date().toISOString(),
            phase_session_id: result.sessionId,
            tool_use_id: result.parked.toolUseId,
            phase_name: phaseArgs.phase,
          });
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
        // If updatePhase already ran above, this is a re-throw path; if the
        // session itself blew up before that, mark phase as failed here too.
        if (!(err instanceof PausedForUserInputError)) {
          const stateNow = await store.getState();
          const stillRunning = stateNow?.phases.find(
            (p) => p.name === phaseArgs.phase && p.attempt === attempt && p.status === "running",
          );
          if (stillRunning) {
            await store.updatePhase(phaseArgs.phase, attempt, {
              ended_at: new Date().toISOString(),
              status: "failed",
            });
          }
          await store.appendHistory({
            at: new Date().toISOString(),
            phase: phaseArgs.phase,
            event: "phase_end",
            attempt,
            status: "error",
            error: (err as Error).message,
          });
        }
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

      // async mode: park the question.
      const questionId = randomUUID();
      await store.setPendingQuestion({
        id: questionId,
        kind: "user_input",
        prompt: askArgs.prompt,
        options: askArgs.options ?? null,
        asked_at: new Date().toISOString(),
        phase_session_id: null,
        tool_use_id: null,
        phase_name: null,
      });
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
  const warn = (msg: string) => { if (logMode !== "quiet") console.warn(msg); };

  const workflow = getWorkflow(args.workflowId ?? "feature-dev");
  const config = await loadHarnessConfig(
    primaryCwd,
    isEngineWorkflow(workflow) ? { phaseDefaults: undefined } : workflow,
    args.mode,
  );
  const isolation = args.isolation ?? config.isolation;

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
        `Run ${taskSlug} is parked waiting for input. Use \`harny answer ${existing.run_id}\` (or interactive) to continue, or \`harny clean ${taskSlug}\` to discard.`,
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

  log(
    `[harny] caps: per-task=${config.maxIterationsPerTask} retries-before-reset=${config.maxRetriesBeforeReset} global=${config.maxIterationsGlobal}`,
  );

  const planPath = planFilePath(primaryCwd, taskSlug);
  const runId = randomUUID();

  const store = new FilesystemStateStore(primaryCwd, taskSlug);
  const startedAt = new Date().toISOString();
  const initialState: State = {
    schema_version: 1,
    run_id: runId,
    origin: {
      prompt: args.userPrompt,
      workflow: workflow.id,
      task_slug: taskSlug,
      started_at: startedAt,
      host: hostname(),
      user: userInfo().username,
    },
    environment: {
      cwd: primaryCwd,
      branch,
      isolation,
      worktree_path: worktreePath,
      mode: config.mode,
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

  // ENGINE PATH: WorkflowDefinition-shaped workflows run via XState createActor.
  // No plan skeleton, no buildCtx, no commitComposed — the engine commits via harnyActions.
  if (isEngineWorkflow(workflow)) {
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
          taskSlug,
          runId,
          log,
          mode: config.mode,
          logMode,
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

  // LEGACY PATH: Workflow-shaped workflows with a .run(ctx) method.
  const plan = createPlanSkeleton({
    taskSlug,
    userPrompt: args.userPrompt,
    branch,
    primaryCwd,
    isolation,
    worktreePath,
  });
  plan.run_id = runId;
  await savePlan(planPath, plan);

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
    store,
  });

  // Set up Phoenix once for this process. Project name = basename(cwd).
  // Wrap the entire workflow run in a single OTel span so all phases inherit
  // one trace_id — Phoenix shows ONE trace per harness invocation, with the
  // task slug as its name.
  const phoenix = setupPhoenix({
    workflowId: workflow.id,
    runId,
    taskSlug,
    cwd: primaryCwd,
  });

  type RunOutcome = { status: "done" | "failed" | "exhausted" | "waiting_human" };
  let result: RunOutcome;
  try {
    result = await withRunSpan(
      phoenix,
      taskSlug,
      {
        "harny.workflow": workflow.id,
        "harny.run_id": runId,
        "harny.task_slug": taskSlug,
        "harny.cwd": primaryCwd,
      },
      async (traceId): Promise<RunOutcome> => {
        if (traceId && phoenix.projectName) {
          await store.setPhoenix({ project: phoenix.projectName, trace_id: traceId });
        }
        try {
          return await workflow.run(ctx);
        } catch (err) {
          if (err instanceof PausedForUserInputError) {
            // ctx.runPhase already wrote pending_question + appended history.
            log(
              `[harny] run parked (waiting_human, AskUserQuestion) runId=${runId} question=${err.questionId}`,
            );
            return { status: "waiting_human" };
          }
          throw err;
        }
      },
    );
  } catch (err) {
    throw err;
  }

  if (result.status === "waiting_human") {
    await store.updateLifecycle({ status: "waiting_human" });
    log(`[harny] run parked (waiting_human) runId=${runId}`);
    return { status: "waiting_human", planPath, branch };
  }

  await handleCleanupWorktree(result.status);

  await store.updateLifecycle({
    status: result.status === "done" ? "done" : "failed",
    ended_at: new Date().toISOString(),
    ended_reason: result.status,
    current_phase: null,
  });

  return { status: result.status, planPath, branch };
}

export async function resumeHarness(
  runId: string,
  answer: string | Record<string, string>,
  opts: { searchCwds: string[] },
): Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human" }> {
  const found = await findRun(opts.searchCwds, runId);
  if (!found) {
    throw new Error(
      `Run not found: ${runId}. Searched cwds: ${opts.searchCwds.join(", ")}`,
    );
  }
  if (found.lifecycle.status !== "waiting_human") {
    throw new Error(
      `Run ${runId} is not in waiting_human status (current: ${found.lifecycle.status})`,
    );
  }

  const primaryCwd = found.environment.cwd;
  const taskSlug = found.origin.task_slug;
  const planPath = planFilePath(primaryCwd, taskSlug);
  const plan = await loadPlan(planPath);

  const rawWorkflow = getWorkflow(found.origin.workflow);
  if (isEngineWorkflow(rawWorkflow)) {
    throw new Error(`Engine workflow "${found.origin.workflow}" does not support resume via harny answer`);
  }
  const workflow: Workflow = rawWorkflow;
  if (!workflow.resumeFromAnswer) {
    throw new Error(`Workflow "${found.origin.workflow}" does not implement resumeFromAnswer`);
  }

  const config = await loadHarnessConfig(primaryCwd, workflow);
  const phaseCwd = found.environment.worktree_path ?? primaryCwd;
  const logMode: LogMode = "compact";

  const store = new FilesystemStateStore(primaryCwd, taskSlug);

  // Build resumeMeta from the parked question (only for SDK batch parks).
  let resumeMeta: { phaseName: string; phaseSessionId: string; toolUseId: string | null } | undefined;
  const pq = found.pending_question;
  if (pq && pq.kind === "ask_user_question_batch" && pq.phase_session_id && pq.phase_name) {
    resumeMeta = {
      phaseName: pq.phase_name,
      phaseSessionId: pq.phase_session_id,
      toolUseId: pq.tool_use_id,
    };
  }

  // Record the answer in history, clear pending, mark running.
  await store.appendHistory({
    at: new Date().toISOString(),
    phase: pq?.phase_name ?? "harness",
    event: "answered",
    question_id: pq?.id ?? null,
    answer,
  });
  await store.setPendingQuestion(null);
  await store.updateLifecycle({ status: "running" });

  const ctx = buildCtx({
    runId: found.run_id,
    taskSlug,
    userPrompt: plan.user_prompt,
    primaryCwd,
    phaseCwd,
    worktreePath: found.environment.worktree_path,
    input: typeof answer === "string" ? { intent: answer } : { answers: answer },
    config,
    logMode,
    planPath,
    plan,
    workflow,
    branch: found.environment.branch,
    store,
  });

  if (resumeMeta) {
    ctx.resumeMeta = resumeMeta;
  }

  // Set up Phoenix for the resume process; gets a NEW trace (resume runs in a
  // separate process, can't continue the original trace). Original trace stays
  // queryable in Phoenix by harny.run_id resource attribute.
  const phoenix = setupPhoenix({
    workflowId: workflow.id,
    runId: found.run_id,
    taskSlug,
    cwd: primaryCwd,
  });

  type RunOutcome = { status: "done" | "failed" | "exhausted" | "waiting_human" };
  let result: RunOutcome;
  try {
    result = await withRunSpan(
      phoenix,
      `${taskSlug} (resume)`,
      {
        "harny.workflow": workflow.id,
        "harny.run_id": found.run_id,
        "harny.task_slug": taskSlug,
        "harny.cwd": primaryCwd,
        "harny.resume": "true",
      },
      async (traceId): Promise<RunOutcome> => {
        if (traceId && phoenix.projectName) {
          await store.setPhoenix({ project: phoenix.projectName, trace_id: traceId });
        }
        try {
          return await workflow.resumeFromAnswer!(ctx, answer);
        } catch (err) {
          if (err instanceof PausedForUserInputError) {
            return { status: "waiting_human" };
          }
          throw err;
        }
      },
    );
  } catch (err) {
    throw err;
  }

  if (result.status === "waiting_human") {
    await store.updateLifecycle({ status: "waiting_human" });
    return { status: "waiting_human" };
  }

  if (result.status === "done" && found.environment.worktree_path) {
    try {
      await removeWorktree(primaryCwd, found.environment.worktree_path, { force: true });
    } catch {
      // best effort
    }
  }

  await store.updateLifecycle({
    status: result.status === "done" ? "done" : "failed",
    ended_at: new Date().toISOString(),
    ended_reason: result.status,
    current_phase: null,
  });

  return { status: result.status };
}
