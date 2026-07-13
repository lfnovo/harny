import { z } from "zod";
import type { AgentProvider, AgentSession } from "../providers/types.js";
import { AgentPausedError } from "../providers/types.js";
import { planFilePath } from "../state/plan.js";
import type { Plan, PlanTask } from "../types.js";
import { captureChangeSet, assertChangeSetUnchanged, commitChangeSet, type ChangeSet } from "../git/changeSet.js";
import { composeCommitMessage } from "../workflows/composeCommit.js";
import { DEFAULT_DEVELOPER, DEFAULT_PLANNER, DEFAULT_VALIDATOR, DeveloperVerdictSchema, PlannerVerdictSchema } from "./featureDevShared.js";
import { resolvePrompt } from "./promptResolver.js";
import { WorkflowDefinitionSchema, type NormalizedWorkflowDefinition } from "./schema.js";
import { PauseWorkflowError, RetryWorkflowStepError, runWorkflow, type NodeExecutionContext, type NodeExecutor } from "./runtime.js";
import { validateWorkflow } from "./validate.js";
import { loadWorkflow } from "./loader.js";
import type { ForgeProvider } from "../forge/types.js";
import { GitHubForgeProvider } from "../forge/github.js";
import { createPullRequestExecutor } from "../forge/pullRequestExecutor.js";
import type { PullRequestGitRunner } from "../forge/pullRequestExecutor.js";
import type { FeatureRunPersistence } from "./persistence.js";
import { createHumanExecutor } from "./humanExecutor.js";
import type { RunMode } from "../types.js";
import { createInterface } from "node:readline/promises";

const ValidatorSchema = z.object({ verdict: z.enum(["pass", "fail", "blocked"]), reasons: z.array(z.string()).default([]) });
type PlannerOutput = z.infer<typeof PlannerVerdictSchema>;

export const featureDevWorkflow: NormalizedWorkflowDefinition = WorkflowDefinitionSchema.parse({
  version: 1, name: "feature-dev", defaults: { provider: "claude", timeout: 30 * 60_000 },
  workspace: { isolation: "worktree" }, outcome: { type: "branch" },
  nodes: [
    { id: "planner", type: "agent", command: "planner", depends_on: [], requires: ["structured_output"], inputs: {} },
    { id: "persist_plan", type: "command", command: ["persist_plan"], depends_on: ["planner"], inputs: {} },
    { id: "tasks", type: "foreach", items: "${{ nodes.planner.outputs.tasks }}", as: "task", max_items: 100, depends_on: ["persist_plan"], inputs: {}, steps: [
      { id: "developer", type: "agent", command: "developer", depends_on: [], requires: ["structured_output", "tool_guards"], guards: ["no_plan_writes", "no_git_history"], inputs: {} },
      { id: "validator", type: "agent", command: "validator", depends_on: ["developer"], requires: ["structured_output", "tool_guards"], guards: ["read_only"], retry: { max_attempts: 3, return_to: "developer" }, inputs: {} },
      { id: "commit", type: "commit", message: "feature-dev", changeset: "developer", depends_on: ["validator"], inputs: {} },
    ] },
  ],
});

export async function runNextFeatureDev(args: {
  provider: AgentProvider; persistence: FeatureRunPersistence; cwd: string; primaryCwd: string; taskSlug: string;
  userPrompt: string; variant: string; providers?: ReadonlyMap<string, AgentProvider>; workflowId?: "feature-dev" | "feature-pr"; workflowSpec?: string; forge?: ForgeProvider; prGit?: PullRequestGitRunner; mode?: RunMode;
}): Promise<{ status: "done" | "failed" | "waiting_human"; error?: string }> {
  const providers = new Map(args.providers ?? []); providers.set(args.provider.id, args.provider);
  const persistence = args.persistence;
  const workflow = (await loadWorkflow(args.workflowSpec ?? args.workflowId ?? "feature-dev", { cwd: args.primaryCwd, providers })).definition;
  validateWorkflow(workflow, providers);
  const path = planFilePath(args.primaryCwd, args.taskSlug);
  let plan: Plan | null = await persistence.loadPlan();
  const callAgent = async <T>(provider: AgentProvider, node: Extract<Parameters<NodeExecutor>[0], { type: "agent" }>, context: NodeExecutionContext, name: string, attempt: number, request: Parameters<AgentProvider["run"]>[0] & { schema: z.ZodType<T> }, prior?: AgentSession) => {
    const resume = (context.checkpoint?.output ?? context.snapshot.nodes[node.id]?.output) as { humanAnswer?: unknown; session?: AgentSession } | undefined;
    const session = resume?.session?.provider === provider.id ? resume.session : prior?.provider === provider.id ? prior : undefined;
    const resumedRequest = resume?.humanAnswer !== undefined ? { ...request, prompt: `Human answer: ${JSON.stringify(resume.humanAnswer)}\n\n${request.prompt}` } : request;
    try { return await runAgentPhase(persistence, provider, name, attempt, resumedRequest, session); }
    catch (error) { if (error instanceof AgentPausedError) { const asked = new Date(); throw new PauseWorkflowError({ nodeId: node.id, question: error.question, options: error.options, askedAt: asked.toISOString(), expiresAt: new Date(asked.getTime() + (node.timeout ?? workflow.defaults.timeout ?? 60_000)).toISOString(), resumeNode: true, session: error.session }); } throw error; }
  };
  const agent: NodeExecutor = async (node, context) => {
    if (node.type !== "agent") throw new Error("agent executor received a non-agent node");
    const provider = providers.get(node.provider ?? workflow.defaults.provider);
    if (!provider) throw new Error(`provider not registered: ${node.provider ?? workflow.defaults.provider}`);
    if (node.command === "planner") {
      const result = await callAgent(provider, node, context, "planner", 1, {
        phase: "planner", cwd: args.cwd, prompt: args.userPrompt,
        systemPrompt: resolvePrompt("feature-dev", args.variant, "planner", args.primaryCwd),
        schema: PlannerVerdictSchema, allowedTools: DEFAULT_PLANNER.allowedTools, model: DEFAULT_PLANNER.model,
      });
      const output = result.output;
      plan = createPlan(args, output, result.session);
      return output;
    }
    const task = context.foreach?.item as PlannerOutput["tasks"][number];
    if (!task) throw new Error(`${node.command} must run inside foreach`);
    const planTask = plan?.tasks.find((candidate) => candidate.id === task.id);
    if (!planTask || !plan) throw new Error(`plan task ${task.id} not found`);
    if (node.command === "developer") {
      planTask.status = "in_progress"; planTask.attempts += 1; plan.iterations_global += 1; await persistence.savePlan(plan);
      const expectedBase = await headSha(args.cwd);
      const prior = sessionFromHistory(planTask, "developer");
      const request = { phase: "developer", taskId: task.id, cwd: args.cwd, prompt: taskPrompt("Execute", task),
        systemPrompt: resolvePrompt("feature-dev", args.variant, "developer", args.primaryCwd), schema: DeveloperVerdictSchema,
        allowedTools: DEFAULT_DEVELOPER.allowedTools, model: DEFAULT_DEVELOPER.model, guards: node.guards };
      const result = await callAgent(provider, node, context, "developer", planTask.attempts, request, prior);
      addHistory(planTask, "developer", result.session);
      if (result.output.status === "blocked") { planTask.status = "failed"; await persistence.savePlan(plan); throw new Error(`developer blocked on task ${task.id}: ${result.output.blocked_reason ?? "unknown"}`); }
      const changeSet = await captureChangeSet(args.cwd);
      if (changeSet.base_sha !== expectedBase) { await resetUnauthorizedHistory(args.cwd, expectedBase); throw new Error(`developer changed git history (expected HEAD ${expectedBase}, got ${changeSet.base_sha})`); }
      await persistence.saveChangeSet(changeSet);
      await persistence.savePlan(plan);
      return { verdict: result.output, changeSet };
    }
    if (node.command === "validator") {
      const developer = context.foreach?.outputs.developer as { verdict: z.infer<typeof DeveloperVerdictSchema>; changeSet: ChangeSet };
      if (!developer) throw new Error("validator missing developer output");
      await assertChangeSetUnchanged(args.cwd, developer.changeSet);
      const prior = sessionFromHistory(planTask, "validator");
      const request = { phase: "validator", taskId: task.id, cwd: args.cwd, prompt: taskPrompt("Validate", task),
        systemPrompt: resolvePrompt("feature-dev", args.variant, "validator", args.primaryCwd), schema: ValidatorSchema,
        allowedTools: DEFAULT_VALIDATOR.allowedTools, model: DEFAULT_VALIDATOR.model, guards: node.guards };
      const result = await callAgent(provider, node, context, "validator", planTask.attempts, request, prior);
      addHistory(planTask, "validator", result.session); await assertChangeSetUnchanged(args.cwd, developer.changeSet); await persistence.savePlan(plan);
      if (result.output.verdict === "fail") throw new RetryWorkflowStepError("developer", result.output.reasons.join("; ") || "validation failed");
      if (result.output.verdict === "blocked") { planTask.status = "failed"; await persistence.savePlan(plan); throw new Error(`validator blocked on task ${task.id}`); }
      await persistence.saveChangeSet(developer.changeSet, { validatedBy: result.session?.id ?? provider.id });
      return result.output;
    }
    throw new Error(`unknown feature-dev agent command ${node.command}`);
  };
  const command: NodeExecutor = async (node, context) => {
    if (node.type !== "command" || node.command[0] !== "persist_plan") throw new Error("unsupported command");
    if (!plan) {
      const planner = context.snapshot.nodes.planner?.output as PlannerOutput;
      plan = createPlan(args, planner);
    }
    await persistence.savePlan(plan); return { path };
  };
  const commit: NodeExecutor = async (node, context) => {
    if (node.type !== "commit" || !plan) throw new Error("invalid commit context");
    const task = context.foreach!.item as PlannerOutput["tasks"][number]; const planTask = plan.tasks.find((candidate) => candidate.id === task.id)!;
    const developer = context.foreach!.outputs.developer as { verdict: z.infer<typeof DeveloperVerdictSchema>; changeSet: ChangeSet };
    const validator = context.foreach!.outputs.validator as z.infer<typeof ValidatorSchema>;
    const message = composeCommitMessage({ devMessage: developer.verdict.commit_message, taskId: task.id, slug: args.taskSlug, planTaskCount: plan.tasks.length, role: "validator", evidence: validator.reasons });
    const sha = await commitChangeSet(args.cwd, message, developer.changeSet);
    await persistence.saveChangeSet(developer.changeSet, { committedSha: sha });
    planTask.status = "done"; planTask.commit_sha = sha; await persistence.savePlan(plan); return { sha, changeSetId: developer.changeSet.id };
  };
  const branch = `harny/${args.taskSlug}`;
  const prExecutor = createPullRequestExecutor({ cwd: args.cwd, forge: args.forge ?? new GitHubForgeProvider(), git: args.prGit, expectedSha: async () => {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: args.cwd, stdout: "pipe", stderr: "pipe" }); const output = await new Response(proc.stdout).text(); if (await proc.exited) throw new Error(await new Response(proc.stderr).text()); return output.trim();
  } });
  const pull_request: NodeExecutor = async (node, context) => {
    if (node.type !== "pull_request") throw new Error("invalid PR node");
    return await prExecutor({ ...node, head: node.head === "${{ run.branch }}" ? branch : node.head }, context);
  };
  const human = createHumanExecutor({ mode: args.mode === "interactive" ? "interactive" : "async", async ask({ question }) { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(`${question}\n> `); } finally { rl.close(); } } }, workflow.defaults.timeout);
  const snapshot = await runWorkflow({ workflow, store: persistence, executors: { agent, command, commit, pull_request, human } });
  const finalPlan = plan as Plan | null;
  if (finalPlan) { finalPlan.status = snapshot.status === "done" ? "done" : "failed"; await persistence.savePlan(finalPlan); }
  const failed = Object.values(snapshot.nodes).find((node) => node.status === "failed");
  return snapshot.status === "done" ? { status: "done" } : snapshot.status === "paused" ? { status: "waiting_human" } : { status: "failed", error: failed?.error ?? (snapshot.status === "cancelled" ? "workflow cancelled" : undefined) };
}

function createPlan(args: { primaryCwd: string; cwd: string; taskSlug: string; userPrompt: string }, output: PlannerOutput, session?: AgentSession): Plan {
  const now = new Date().toISOString(); return { task_slug: args.taskSlug, primary_cwd: args.primaryCwd, user_prompt: args.userPrompt, branch: `harny/${args.taskSlug}`,
    isolation: args.cwd === args.primaryCwd ? "inline" : "worktree", worktree_path: args.cwd === args.primaryCwd ? null : args.cwd,
    created_at: now, updated_at: now, status: "in_progress", summary: output.summary, iterations_global: 0,
    tasks: output.tasks.map((task) => ({ ...task, status: "pending", attempts: 0, commit_sha: null, history: [] })), metadata: { ...(session ? { planner_session_id: session.id } : {}) } };
}
function taskPrompt(verb: string, task: PlannerOutput["tasks"][number]): string { return `${verb} task: ${task.title}\n\n${task.description}\n\nAcceptance criteria:\n${task.acceptance.map((item) => `- ${item}`).join("\n")}`; }
function addHistory(task: PlanTask, role: string, session?: AgentSession) { if (session) task.history.push({ role, provider: session.provider, session_id: session.id, at: new Date().toISOString() }); }
function sessionFromHistory(task: PlanTask, role: string): AgentSession | undefined { const entry = [...task.history].reverse().find((item) => item.role === role); return entry ? { id: entry.session_id, provider: typeof entry.provider === "string" ? entry.provider : "claude" } : undefined; }
async function runAgentPhase<T>(store: Pick<FeatureRunPersistence, "appendPhase" | "updatePhase" | "setPhaseProvider">, provider: AgentProvider, name: string, attempt: number, request: Parameters<AgentProvider["run"]>[0] & { schema: z.ZodType<T> }, session?: AgentSession) {
  const started_at = new Date().toISOString(); await store.appendPhase({ name, attempt, started_at, ended_at: null, status: "running", verdict: null, session_id: session?.id ?? null });
  try {
    const result = session && provider.resume ? await provider.resume(session, request) : await provider.run(request);
    await store.updatePhase(name, attempt, { ended_at: new Date().toISOString(), status: "completed", verdict: JSON.stringify(result.output), session_id: result.session?.id ?? null }); if (result.session) await store.setPhaseProvider(name, attempt, result.session.provider); return result;
  } catch (error) { await store.updatePhase(name, attempt, { ended_at: new Date().toISOString(), status: error instanceof AgentPausedError ? "parked" : "failed", session_id: error instanceof AgentPausedError ? error.session.id : null }); if (error instanceof AgentPausedError) await store.setPhaseProvider(name, attempt, error.session.provider); throw error; }
}
async function headSha(cwd: string): Promise<string> { const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); if (code) throw new Error(`git rev-parse failed: ${stderr.trim()}`); return stdout.trim(); }
async function resetUnauthorizedHistory(cwd: string, sha: string): Promise<void> { const proc = Bun.spawn(["git", "reset", "--mixed", sha], { cwd, stdout: "pipe", stderr: "pipe" }); const stderr = new Response(proc.stderr).text(); if (await proc.exited) throw new Error(`could not restore validated HEAD: ${(await stderr).trim()}`); }
