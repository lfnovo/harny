import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { planFilePath } from "./state/plan.js";
import { realGitOps, type GitOps } from "./gitOps.js";
import { FilesystemStateStore } from "./state/filesystem.js";
import type { State } from "./state/schema.js";
import { setupPhoenix, withRunSpan } from "./observability/phoenix.js";
import type { IsolationMode, LogMode, RunMode } from "./types.js";
import type { AgentProvider } from "./providers/types.js";
import { ClaudeProvider } from "./providers/claude.js";
import { runNextFeatureDev } from "./workflow/featureDev.js";
import { loadWorkflow } from "./workflow/loader.js";
import { FilesystemRunStoreV3 } from "./state/v3/store.js";
import type { RunV3 } from "./state/v3/schema.js";
import { V3FeatureRunPersistence } from "./workflow/persistence.js";
import { patchPointer, writePointerV3 } from "./state/registry.js";
import { CodexProvider } from "./providers/codex.js";
import { materializeHumanExpiry } from "./workflow/runtime.js";
import { runDeclarativeWorkflow } from "./workflow/declarativeRunner.js";
import { validateWorkflow } from "./workflow/validate.js";
import { LocalWorkspaceProvider, type WorkspaceProvider } from "./workspace/provider.js";

function defaultTaskSlug(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `run-${iso}`;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return true;
  }
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
  gitOps?: GitOps;
  /** Test/embedding seam for the provider-neutral runtime. */
  agentProvider?: AgentProvider;
  agentProviders?: readonly AgentProvider[];
  workspaceProvider?: WorkspaceProvider;
}): Promise<{ status: "done" | "failed" | "exhausted" | "waiting_human"; planPath: string; branch: string; state: State | RunV3 | null }> {
  const primaryCwd = args.cwd;
  const git = args.gitOps ?? realGitOps;
  const taskSlug = args.taskSlug?.trim() || defaultTaskSlug();
  const logMode = args.logMode ?? "compact";
  const log = (msg: string) => { if (logMode !== "quiet") console.log(msg); };
  const warn = (msg: string) => { if (logMode !== "quiet") console.warn(msg); };

  const requestedWorkflow = args.workflowId ?? "feature-dev";
  const nextDefinition = (await loadWorkflow(requestedWorkflow, { cwd: primaryCwd })).definition;
  const isolation: IsolationMode = args.isolation ?? nextDefinition.workspace.isolation;
  const workflow = { id: nextDefinition.name, needsBranch: nextDefinition.outcome.type !== "none" || isolation === "worktree", needsWorktree: isolation === "worktree" };
  {
    const capabilityProviders = new Map<string, AgentProvider>();
    for (const provider of args.agentProviders ?? []) capabilityProviders.set(provider.id, provider);
    if (args.agentProvider) capabilityProviders.set(args.agentProvider.id, args.agentProvider);
    if (!capabilityProviders.has("claude")) capabilityProviders.set("claude", { id: "claude", capabilities: { structuredOutput: true, resume: true, toolGuards: true, interactiveQuestions: true }, async run() { throw new Error("capability-only provider"); } });
    if (!capabilityProviders.has("codex")) capabilityProviders.set("codex", new CodexProvider()); validateWorkflow(nextDefinition, capabilityProviders);
  }
  const variant = args.variant ?? "default";
  const mode: RunMode = args.mode ?? (process.stdin.isTTY ? "interactive" : "silent");

  log(`[harny] cwd=${primaryCwd} isolation=${isolation}`);
  log(`[harny] workflow=${workflow.id} task=${taskSlug}`);
  log(`[harny] user prompt >>>`);
  log(args.userPrompt);
  log(`[harny] user prompt <<<`);

  await git.assertIsGitRepo(primaryCwd);
  await git.assertHasInitialCommit(primaryCwd);

  // Historical v2 runs are read-only. Refuse to overwrite their state.
  const probeStore = new FilesystemStateStore(primaryCwd, taskSlug);
  const existing = await probeStore.getState();
  if (existing) {
    if (existing.lifecycle.status === "done" || existing.lifecycle.status === "failed") {
      log(
        `[harny] run already complete (status=${existing.lifecycle.status}, ended_at=${existing.lifecycle.ended_at ?? "?"}). Use \`harny clean ${taskSlug}\` then rerun.`,
      );
      return { status: existing.lifecycle.status, planPath: planFilePath(primaryCwd, taskSlug), branch: existing.environment.branch, state: existing };
    }
    if (existing.lifecycle.status === "running") {
      if (isPidAlive(existing.lifecycle.pid)) {
        throw new Error(
          `Run ${taskSlug} appears to still be running (pid=${existing.lifecycle.pid}). If it's actually dead, \`harny clean ${taskSlug}\` and retry.`,
        );
      } else {
        const endedAt = new Date().toISOString();
        await probeStore.updateLifecycle({ status: "failed", ended_at: endedAt, ended_reason: `process exited unexpectedly (pid=${existing.lifecycle.pid})`, current_phase: null });
        await probeStore.appendHistory({ at: endedAt, phase: "harness", event: "dead_pid_materialized" });
        const failed = await probeStore.getState();
        return { status: "failed", planPath: planFilePath(primaryCwd, taskSlug), branch: existing.environment.branch, state: failed };
      }
    }
    if (existing.lifecycle.status === "waiting_human") {
      throw new Error(
        `Run ${taskSlug} uses historical state v2 and cannot be resumed. Use \`harny clean ${taskSlug}\` to discard it.`,
      );
    }
  }
  const probeV3 = new FilesystemRunStoreV3(primaryCwd, taskSlug);
  const existingV3 = await probeV3.load();
  if (existingV3) {
    if (["done", "failed", "cancelled"].includes(existingV3.run.status)) return { status: existingV3.run.status === "done" ? "done" : "failed", planPath: planFilePath(primaryCwd, taskSlug), branch: existingV3.workspace.branch, state: existingV3 };
    if (existingV3.run.status === "running" && isPidAlive(existingV3.run.pid)) throw new Error(`Run ${taskSlug} appears to still be running (pid=${existingV3.run.pid}).`);
    if (existingV3.run.status === "running") {
      const failed = await probeV3.mutate((run) => { run.run.status = "failed"; run.run.ended_at = new Date().toISOString(); run.run.ended_reason = `process exited unexpectedly (pid=${run.run.pid})`; run.workspace.reserved = false; }, { type: "run.dead_pid" });
      return { status: "failed", planPath: planFilePath(primaryCwd, taskSlug), branch: failed.workspace.branch, state: failed };
    }
    if (existingV3.run.status === "paused") {
      const snapshot = await materializeHumanExpiry(new V3FeatureRunPersistence(probeV3));
      if (snapshot?.status === "failed") {
        const ended = new Date().toISOString(); const failed = await probeV3.mutate((run) => { run.run.status = "failed"; run.run.ended_at = ended; run.run.ended_reason = "human input expired"; run.workspace.reserved = false; run.pending_human = null; }, { type: "run.human_expired" });
        await patchPointer(failed.run.id, { status: "failed", ended_at: ended }); return { status: "failed", planPath: planFilePath(primaryCwd, taskSlug), branch: failed.workspace.branch, state: failed };
      }
      throw new Error(`Run ${taskSlug} is paused waiting for human input. Use \`harny answer ${existingV3.run.id}\`.`);
    }
  }

  const workspaceProvider = args.workspaceProvider ?? new LocalWorkspaceProvider(git);
  const workspace = await workspaceProvider.prepare({ primaryCwd, taskSlug, isolation, needsBranch: workflow.needsBranch });
  const phaseCwd = workspace.cwd; const worktreePath = workspace.worktreePath; const branch = workspace.branch;
  if (worktreePath) log(`[harny] worktree=${worktreePath}`);

  const planPath = planFilePath(primaryCwd, taskSlug);
  const runId = randomUUID();

  const storeV3 = new FilesystemRunStoreV3(primaryCwd, taskSlug);
  const startedAt = new Date().toISOString();
  {
    const createdV3: RunV3 = { schema_version: 3, run: { id: runId, task_slug: taskSlug, workflow: workflow.id, status: "running", started_at: startedAt, ended_at: null, ended_reason: null, pid: process.pid, parent_run_id: null }, origin: { prompt: args.userPrompt, workflow_source: requestedWorkflow, cwd: primaryCwd, host: hostname(), user: userInfo().username }, workspace: { isolation, primary_cwd: primaryCwd, cwd: phaseCwd, branch, worktree_path: worktreePath, reserved: true }, nodes: {}, artifacts: {}, changesets: {}, deliverables: [], pending_human: null };
    await storeV3.create(createdV3); try { await writePointerV3(createdV3); } catch (error) { warn(`[harny] could not write v3 run pointer: ${(error as Error).message}`); }
  }

  const handleCleanupWorktree = async (
    outcome: "done" | "failed" | "exhausted" | "waiting_human",
  ): Promise<void> => {
    if (outcome === "done") {
      try {
        await workspaceProvider.release(workspace, outcome);
        if (worktreePath) log(`[harny] worktree removed: ${worktreePath}`);
      } catch (err) {
        warn(`[harny] worktree cleanup failed: ${(err as Error).message}`);
      }
    } else {
      await workspaceProvider.release(workspace, outcome);
      if (worktreePath) log(`[harny] worktree preserved: ${worktreePath} (branch: ${branch})`);
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
        await storeV3.mutate((run) => { run.artifacts.phoenix = { id: "phoenix", type: "trace", created_at: new Date().toISOString(), producer: "runtime", value: { project: phoenix.projectName, trace_id: traceId } }; }, { type: "observability.linked" });
      }

      const providerMap = new Map<string, AgentProvider>();
      for (const provider of args.agentProviders ?? []) providerMap.set(provider.id, provider);
      if (args.agentProvider) providerMap.set(args.agentProvider.id, args.agentProvider);
      if (!providerMap.has("claude")) providerMap.set("claude", new ClaudeProvider({ workflowId: workflow.id, runId, taskSlug, primaryCwd, mode, logMode }));
      if (!providerMap.has("codex")) providerMap.set("codex", new CodexProvider());
      const claude = providerMap.get("claude")!;
      const defaultProvider = providerMap.get(nextDefinition.defaults.provider ?? claude.id);
      if (!defaultProvider) throw new Error(`default provider not available: ${nextDefinition.defaults.provider}`);
      const workflowResult = workflow.id === "feature-dev" || workflow.id === "feature-pr" ? await runNextFeatureDev({
            provider: defaultProvider!, providers: providerMap,
            persistence: new V3FeatureRunPersistence(storeV3!), cwd: phaseCwd, primaryCwd, taskSlug, userPrompt: args.userPrompt, variant, workflowId: workflow.id as "feature-dev" | "feature-pr", workflowSpec: requestedWorkflow, mode,
          }) : await runDeclarativeWorkflow({ definition: nextDefinition, persistence: new V3FeatureRunPersistence(storeV3), providers: providerMap, cwd: phaseCwd, primaryCwd, userPrompt: args.userPrompt, branch, mode });

      await handleCleanupWorktree(workflowResult.status);

      if (workflowResult.status !== "waiting_human") await storeV3.mutate((run) => { run.run.status = workflowResult.status === "done" ? "done" : "failed"; run.run.ended_at = new Date().toISOString(); run.run.ended_reason = workflowResult.status; run.workspace.reserved = false; }, { type: workflowResult.status === "done" ? "run.completed" : "run.failed" });
      await patchPointer(runId, { status: workflowResult.status === "waiting_human" ? "paused" : workflowResult.status === "done" ? "done" : "failed", ended_at: workflowResult.status === "waiting_human" ? null : new Date().toISOString() });

      if (workflowResult.status === "failed") {
        log(`[harny] workflow failed: ${workflowResult.error ?? "(no error message)"}`);
      } else {
        log(`[harny] workflow done`);
      }

      const finalState = await storeV3.load();
      return { status: workflowResult.status, planPath, branch, state: finalState };
    },
  );
}
