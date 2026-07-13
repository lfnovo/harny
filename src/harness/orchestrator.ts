import { randomUUID } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { realGitOps, type GitOps } from "./gitOps.js";
import type { IsolationMode, LogMode, RunMode } from "./types.js";
import type { AgentProvider } from "./providers/types.js";
import { createConfiguredProviders } from "./providers/config.js";
import { loadWorkflow } from "./workflow/loader.js";
import { validateWorkflow } from "./workflow/validate.js";
import { runDeclarativeWorkflow } from "./workflow/declarativeRunner.js";
import { RunWorkflowPersistence } from "./workflow/persistence.js";
import { RunStore } from "./state/runStore.js";
import type { RunSnapshot } from "./state/runSchema.js";
import { patchPointer, writePointer } from "./state/registry.js";
import { LocalWorkspaceProvider, type WorkspaceProvider } from "./workspace/provider.js";
import type { ForgeProvider } from "./forge/types.js";
import type { PullRequestGitRunner } from "./forge/pullRequestExecutor.js";

function defaultTaskSlug(): string { return `run-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}`; }
export function isPidAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }

export interface HarnessRequest {
  cwd: string;
  userPrompt: string;
  taskSlug?: string;
  workflowId?: string;
  variant?: string;
  isolation?: IsolationMode;
  mode?: RunMode;
  logMode?: LogMode;
  gitOps?: GitOps;
  agentProvider?: AgentProvider;
  agentProviders?: readonly AgentProvider[];
  workspaceProvider?: WorkspaceProvider;
  inputs?: Readonly<Record<string, unknown>>;
  parentRunId?: string;
  startPoint?: string;
  forge?: ForgeProvider;
  prGit?: PullRequestGitRunner;
}

export interface HarnessResult { status: "done" | "failed" | "cancelled" | "waiting_human"; branch: string; state: RunSnapshot | null; }

/** Creates and executes every workflow through the same declarative runtime. */
export async function runHarness(args: HarnessRequest): Promise<HarnessResult> {
  const primaryCwd = args.cwd;
  const git = args.gitOps ?? realGitOps;
  const taskSlug = args.taskSlug?.trim() || defaultTaskSlug();
  const logMode = args.logMode ?? "compact";
  const log = (message: string) => { if (logMode !== "quiet") console.log(message); };
  const warn = (message: string) => { if (logMode !== "quiet") console.warn(message); };
  const requestedWorkflow = args.workflowId ?? "feature-dev";
  const definition = (await loadWorkflow(requestedWorkflow, { cwd: primaryCwd })).definition;
  const isolation = args.isolation ?? definition.workspace.isolation;
  const needsBranch = definition.outcome.type !== "none" || isolation === "worktree";
  const variant = args.variant ?? "default";
  const mode = args.mode ?? (process.stdin.isTTY ? "interactive" : "silent");
  const runId = randomUUID();

  const providers = await createProviders(args, { workflowId: definition.name, runId, taskSlug, primaryCwd, mode, logMode });
  validateWorkflow(definition, providers);
  log(`[harny] cwd=${primaryCwd} isolation=${isolation}`);
  log(`[harny] workflow=${definition.name} task=${taskSlug}`);
  await git.assertIsGitRepo(primaryCwd);
  await git.assertHasInitialCommit(primaryCwd);

  const store = new RunStore(primaryCwd, taskSlug);
  const existing = await store.load();
  if (existing) return handleExisting(existing, store, log);

  const workspaceProvider = args.workspaceProvider ?? new LocalWorkspaceProvider(git);
  const workspace = await workspaceProvider.prepare({ primaryCwd, taskSlug, isolation, needsBranch, startPoint: args.startPoint });
  if (workspace.worktreePath) log(`[harny] worktree=${workspace.worktreePath}`);
  const startedAt = new Date().toISOString();
  const created: RunSnapshot = {
    schema_version: 4,
    run: { id: runId, task_slug: taskSlug, workflow: definition.name, started_at: startedAt, ended_at: null, ended_reason: null, pid: process.pid, parent_run_id: args.parentRunId ?? null },
    origin: { prompt: args.userPrompt, workflow_source: requestedWorkflow, cwd: primaryCwd, host: hostname(), user: userInfo().username },
    workspace: { isolation, primary_cwd: primaryCwd, cwd: workspace.cwd, branch: workspace.branch, worktree_path: workspace.worktreePath, reserved: true },
    inputs: structuredClone(args.inputs ?? {}),
    execution: { workflow: definition.name, status: "running", nodes: Object.fromEntries(definition.nodes.map((node) => [node.id, { id: node.id, status: "pending" as const, attempts: 0 }])) },
    changesets: {},
  };
  await store.create(created);
  try { await writePointer(created); } catch (error) { warn(`[harny] could not write run pointer: ${(error as Error).message}`); }

  return continueRun({ run: (await store.load())!, definition, providers, mode, logMode, variant, workspaceProvider, forge: args.forge, prGit: args.prGit });
}

export async function continueRun(args: { run: RunSnapshot; definition?: Awaited<ReturnType<typeof loadWorkflow>>["definition"]; providers?: ReadonlyMap<string, AgentProvider>; mode: RunMode; logMode: LogMode; variant?: string; workspaceProvider?: WorkspaceProvider; forge?: ForgeProvider; prGit?: PullRequestGitRunner }): Promise<HarnessResult> {
  const run = args.run; const store = new RunStore(run.workspace.primary_cwd, run.run.task_slug); const log = (message: string) => { if (args.logMode !== "quiet") console.log(message); }; const warn = (message: string) => { if (args.logMode !== "quiet") console.warn(message); };
  const providers = args.providers ?? await createProviders({}, { workflowId: run.run.workflow, runId: run.run.id, taskSlug: run.run.task_slug, primaryCwd: run.workspace.primary_cwd, mode: args.mode, logMode: args.logMode });
  const definition = args.definition ?? (await loadWorkflow(run.origin.workflow_source || run.run.workflow, { cwd: run.workspace.primary_cwd, providers })).definition;
  let result: Awaited<ReturnType<typeof runDeclarativeWorkflow>>;
  try { result = await runDeclarativeWorkflow({ definition, persistence: new RunWorkflowPersistence(store), providers, cwd: run.workspace.cwd, primaryCwd: run.workspace.primary_cwd, userPrompt: run.origin.prompt, taskSlug: run.run.task_slug, branch: run.workspace.branch, variant: args.variant ?? "default", mode: args.mode, inputs: run.inputs, forge: args.forge, prGit: args.prGit }); }
  catch (error) { result = { status: "failed", snapshot: (await store.load())!.execution, error: String(error) }; }
  const endedAt = result.status === "waiting_human" ? null : new Date().toISOString();
  await store.mutate((state) => { if (result.status !== "waiting_human") { state.execution.status = result.status; state.run.ended_at = endedAt; state.run.ended_reason = result.status === "done" ? "completed" : result.status === "cancelled" ? "workflow cancelled" : result.error ?? "failed"; state.workspace.reserved = false; } }, { type: result.status === "waiting_human" ? "run.paused" : result.status === "done" ? "run.completed" : result.status === "cancelled" ? "run.cancelled" : "run.failed" });
  await patchPointer(run.run.id, { status: result.status === "waiting_human" ? "paused" : result.status, ended_at: endedAt });
  const workspace = { primaryCwd: run.workspace.primary_cwd, cwd: run.workspace.cwd, isolation: run.workspace.isolation, branch: run.workspace.branch, worktreePath: run.workspace.worktree_path };
  await releaseWorkspace(args.workspaceProvider ?? new LocalWorkspaceProvider(realGitOps), workspace, result.status, log, warn);
  if (result.status === "failed") log(`[harny] workflow failed: ${result.error ?? "unknown error"}`); else log(`[harny] workflow ${result.status === "waiting_human" ? "paused" : result.status}`);
  return { status: result.status, branch: run.workspace.branch, state: await store.load() };
}

async function createProviders(args: Pick<HarnessRequest, "agentProvider" | "agentProviders">, metadata: { workflowId: string; runId: string; taskSlug: string; primaryCwd: string; mode: RunMode; logMode: LogMode }): Promise<Map<string, AgentProvider>> {
  const providers = await createConfiguredProviders(metadata);
  for (const provider of args.agentProviders ?? []) providers.set(provider.id, provider);
  if (args.agentProvider) providers.set(args.agentProvider.id, args.agentProvider);
  return providers;
}

async function handleExisting(existing: RunSnapshot, store: RunStore, log: (message: string) => void): Promise<HarnessResult> {
  if (["done", "failed", "cancelled"].includes(existing.execution.status)) { log(`[harny] run already complete (status=${existing.execution.status}). Use \`harny clean ${existing.run.task_slug}\` then rerun.`); return { status: existing.execution.status === "done" ? "done" : existing.execution.status === "cancelled" ? "cancelled" : "failed", branch: existing.workspace.branch, state: existing }; }
  if (existing.execution.status === "running" && isPidAlive(existing.run.pid)) throw new Error(`Run ${existing.run.task_slug} appears to still be running (pid=${existing.run.pid}).`);
  if (existing.execution.status === "running") {
    const ended = new Date().toISOString();
    const failed = await store.mutate((run) => { run.execution.status = "failed"; run.run.ended_at = ended; run.run.ended_reason = `process exited unexpectedly (pid=${run.run.pid})`; run.workspace.reserved = false; }, { type: "run.dead_pid" });
    await patchPointer(existing.run.id, { status: "failed", ended_at: ended });
    return { status: "failed", branch: failed.workspace.branch, state: failed };
  }
  throw new Error(`Run ${existing.run.task_slug} is paused waiting for human input. Use \`harny answer ${existing.run.id}\`.`);
}

async function releaseWorkspace(provider: WorkspaceProvider, workspace: Awaited<ReturnType<WorkspaceProvider["prepare"]>>, outcome: HarnessResult["status"], log: (message: string) => void, warn: (message: string) => void): Promise<void> {
  try { await provider.release(workspace, outcome); if (workspace.worktreePath) log(outcome === "done" ? `[harny] worktree removed: ${workspace.worktreePath}` : `[harny] worktree preserved: ${workspace.worktreePath} (branch: ${workspace.branch})`); }
  catch (error) { warn(`[harny] worktree cleanup failed: ${(error as Error).message}`); }
}
