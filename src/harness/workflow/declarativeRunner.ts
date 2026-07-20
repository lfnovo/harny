import { createInterface } from "node:readline/promises";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertChangeSetAllowed, assertChangeSetUnchanged, captureChangeSet, commitChangeSet, type ChangeSet } from "../git/changeSet.js";
import type { AgentProvider, AgentSession } from "../providers/types.js";
import { AgentPausedError, AgentProviderError } from "../providers/types.js";
import type { ForgeProvider } from "../forge/types.js";
import { GitHubForgeProvider } from "../forge/github.js";
import { createPullRequestExecutor, type PullRequestGitRunner } from "../forge/pullRequestExecutor.js";
import { composeCommitMessage } from "../workflows/composeCommit.js";
import type { RunMode } from "../types.js";
import type { RunPersistence } from "./persistence.js";
import type { NormalizedWorkflowDefinition } from "./schema.js";
import { PauseWorkflowError, RetryWorkflowStepError, runWorkflow, type NodeExecutionContext, type NodeExecutor } from "./runtime.js";
import { resolveCommand } from "./loader.js";
import { createCommandExecutor } from "./commandExecutor.js";
import { createHumanExecutor } from "./humanExecutor.js";
import { DEFAULT_DEVELOPER, DEFAULT_PLANNER, DEFAULT_VALIDATOR, DeveloperVerdictSchema, PlannerVerdictSchema } from "./featureDevShared.js";
import { resolvePrompt } from "./promptResolver.js";
import { TranscriptStore } from "../transcripts/store.js";
import { schemaFromDefinition } from "./outputSchema.js";

const ValidatorSchema = z.object({ verdict: z.enum(["pass", "fail", "blocked"]), reasons: z.array(z.string()).default([]) });
type PlannerTask = z.infer<typeof PlannerVerdictSchema>["tasks"][number];
type DeveloperOutput = { verdict: z.infer<typeof DeveloperVerdictSchema>; changeSet: ChangeSet };

export interface WorkflowRunRequest {
  definition: NormalizedWorkflowDefinition;
  persistence: RunPersistence;
  providers: ReadonlyMap<string, AgentProvider>;
  cwd: string;
  primaryCwd: string;
  userPrompt: string;
  taskSlug: string;
  branch: string;
  variant: string;
  mode: RunMode;
  inputs?: Readonly<Record<string, unknown>>;
  forge?: ForgeProvider;
  prGit?: PullRequestGitRunner;
}

/** The single execution entry for bundled and user-defined workflows. */
export async function runDeclarativeWorkflow(args: WorkflowRunRequest) {
  const inputs: Record<string, unknown> = { branch: args.branch, user_prompt: args.userPrompt, ...(args.inputs ?? {}) };
  const agent: NodeExecutor = async (node, context) => {
    if (node.type !== "agent") throw new Error("agent executor received another node type");
    const provider = args.providers.get(node.provider ?? args.definition.defaults.provider);
    if (!provider) throw new Error(`provider unavailable: ${node.provider ?? args.definition.defaults.provider}`);
    if (node.command === "planner") return runPlanner(provider, node, context, args);
    if (node.command === "developer" || node.command === "review_fixer") return runDeveloper(provider, node, context, args);
    if (node.command === "validator") return runValidator(provider, node, context, args);
    if (node.command === "final_validator") return runFinalValidator(provider, node, context, args);
    return runGenericAgent(provider, node, context, args);
  };

  const commit: NodeExecutor = async (node, context) => {
    if (node.type !== "commit") throw new Error("commit executor received another node type");
    const source = typeof node.changeset === "string" ? context.foreach?.outputs[node.changeset] : node.changeset;
    const developer = source as DeveloperOutput | ChangeSet | undefined;
    const changeSet = "changeSet" in (developer ?? {}) ? (developer as DeveloperOutput).changeSet : developer as ChangeSet | undefined;
    if (!changeSet?.id) throw new Error(`commit ${node.id} did not receive a ChangeSet`);
    await assertChangeSetUnchanged(args.cwd, changeSet);
    const task = context.foreach?.item as PlannerTask | undefined;
    const verdict = (developer as DeveloperOutput).verdict;
    const validation = context.foreach?.outputs.validator as z.infer<typeof ValidatorSchema> | undefined;
    const plan = context.snapshot.nodes.planner?.output as z.infer<typeof PlannerVerdictSchema> | undefined;
    const message = task && verdict ? composeCommitMessage({ devMessage: verdict.commit_message, taskId: task.id, slug: args.taskSlug, planTaskCount: plan?.tasks.length ?? 1, role: "validator", evidence: validation?.reasons ?? [] }) : node.message;
    const sha = await commitChangeSet(args.cwd, message, changeSet, { allowPaths: args.definition.workspace.allow_paths });
    await args.persistence.saveChangeSet(changeSet, { committedSha: sha });
    return { sha, changeSetId: changeSet.id };
  };

  const prBase = createPullRequestExecutor({
    cwd: args.cwd,
    forge: args.forge ?? new GitHubForgeProvider(),
    git: args.prGit,
    expectedSha: () => headSha(args.cwd),
    expectedRemoteSha: typeof inputs.expected_remote_sha === "string" ? inputs.expected_remote_sha : undefined,
  });
  const pullRequest: NodeExecutor = (node, context) => node.type === "pull_request" ? prBase(node, context) : Promise.reject(new Error("invalid PR node"));
  const human = createHumanExecutor({ mode: args.mode === "interactive" ? "interactive" : "async", async ask({ question }) { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(`${question}\n> `); } finally { rl.close(); } } }, args.definition.defaults.timeout);
  const snapshot = await runWorkflow({ workflow: args.definition, store: args.persistence, inputs, executors: { agent, command: createCommandExecutor(args.cwd), human, commit, pull_request: pullRequest } });
  const failed = findFailed(snapshot.nodes);
  return { status: snapshot.status === "paused" ? "waiting_human" as const : snapshot.status === "done" ? "done" as const : snapshot.status === "cancelled" ? "cancelled" as const : "failed" as const, snapshot, error: failed?.error };
}

async function runPlanner(provider: AgentProvider, node: AgentNode, context: NodeExecutionContext, args: WorkflowRunRequest) {
  const request = { phase: "planner", cwd: args.cwd, prompt: plannerRequest(args.userPrompt, args.definition.outcome.type), systemPrompt: resolvePrompt("feature-dev", args.variant, "planner", args.primaryCwd), schema: PlannerVerdictSchema, allowedTools: DEFAULT_PLANNER.allowedTools, model: node.model ?? DEFAULT_PLANNER.model, maxTurns: DEFAULT_PLANNER.maxTurns, guards: node.guards };
  const result = await callAgent(provider, node, context, args, request);
  return result.output;
}

async function runDeveloper(provider: AgentProvider, node: AgentNode, context: NodeExecutionContext, args: WorkflowRunRequest): Promise<DeveloperOutput> {
  const task = context.foreach?.item as PlannerTask | undefined;
  if (!task) throw new Error(`${node.command} must run inside foreach`);
  const expectedBase = await headSha(args.cwd);
  const prompt = node.command === "review_fixer" ? `Address all review feedback.\n\n${JSON.stringify(task, null, 2)}` : taskPrompt("Execute", task);
  const result = await callAgent(provider, node, context, args, { phase: "developer", taskId: task.id, cwd: args.cwd, prompt, systemPrompt: resolvePrompt("feature-dev", args.variant, "developer", args.primaryCwd), schema: DeveloperVerdictSchema, allowedTools: DEFAULT_DEVELOPER.allowedTools, model: node.model ?? DEFAULT_DEVELOPER.model, maxTurns: DEFAULT_DEVELOPER.maxTurns, guards: node.guards });
  if (result.output.status === "blocked") throw new Error(`developer blocked on task ${task.id}: ${result.output.blocked_reason ?? "unknown"}`);
  const changeSet = await captureChangeSet(args.cwd);
  if (changeSet.base_sha !== expectedBase) { await resetUnauthorizedHistory(args.cwd, expectedBase); throw new Error(`developer changed git history (expected HEAD ${expectedBase}, got ${changeSet.base_sha})`); }
  await assertChangeSetAllowed(args.cwd, changeSet, { allowPaths: args.definition.workspace.allow_paths });
  await args.persistence.saveChangeSet(changeSet);
  return { verdict: result.output, changeSet };
}

async function runValidator(provider: AgentProvider, node: AgentNode, context: NodeExecutionContext, args: WorkflowRunRequest) {
  const foreach = context.foreach;
  const task = context.foreach?.item as PlannerTask | undefined;
  const developer = context.foreach?.outputs.developer as DeveloperOutput | undefined;
  if (!foreach || !task || !developer?.changeSet) throw new Error("validator must follow developer inside foreach");
  await assertChangeSetUnchanged(args.cwd, developer.changeSet);
  const manifest = `\n\nAuthoritative ChangeSet manifest (${developer.changeSet.entries.length} paths):\n${developer.changeSet.entries.map((entry) => `- ${entry.path}`).join("\n") || "- (empty)"}`;
  const result = await withValidatorScratch(args.cwd, `${foreach.index}-${context.attempt.attempt}`, (env) => callAgent(provider, node, context, args, { phase: "validator", taskId: task.id, cwd: args.cwd, prompt: taskPrompt("Validate", task) + manifest, systemPrompt: resolvePrompt("feature-dev", args.variant, "validator", args.primaryCwd) + validatorScratchInstructions(env.TMPDIR!), schema: ValidatorSchema, allowedTools: DEFAULT_VALIDATOR.allowedTools, model: node.model ?? DEFAULT_VALIDATOR.model, maxTurns: DEFAULT_VALIDATOR.maxTurns, guards: node.guards, env }));
  await assertChangeSetUnchanged(args.cwd, developer.changeSet);
  if (result.output.verdict === "fail") throw new RetryWorkflowStepError("developer", result.output.reasons.join("; ") || "validation failed");
  if (result.output.verdict === "blocked") throw new Error(`validator blocked on task ${task.id}: ${result.output.reasons.join("; ")}`);
  await args.persistence.saveChangeSet(developer.changeSet, { validatedBy: result.session?.id ?? provider.id });
  return result.output;
}

async function runFinalValidator(provider: AgentProvider, node: AgentNode, context: NodeExecutionContext, args: WorkflowRunRequest) {
  const expectedState = await captureChangeSet(args.cwd);
  const plan = context.snapshot.nodes.planner?.output ?? args.inputs?.tasks ?? "No explicit plan artifact";
  const prompt = `Validate the final accumulated repository state after all task commits. Re-run every established project-wide gate (typecheck, tests, lint, build when present), confirm the worktree is clean, and verify the complete plan rather than only the last task.\n\nPlan:\n${JSON.stringify(plan, null, 2)}`;
  const finalInstructions = `${resolvePrompt("feature-dev", args.variant, "validator", args.primaryCwd)}\n\nFINAL VALIDATION OVERRIDE: all task ChangeSets have already been committed by the privileged runtime, so a clean git diff is required and is not a no-op failure. Validate the accumulated committed branch and all plan acceptance criteria. Prefix evidence as FINAL/AC entries as appropriate; the per-task one-entry rule does not limit this aggregate report.`;
  const result = await withValidatorScratch(args.cwd, `final-${context.attempt.attempt}`, (env) => callAgent(provider, node, context, args, { phase: "final_validator", cwd: args.cwd, prompt, systemPrompt: finalInstructions + validatorScratchInstructions(env.TMPDIR!), schema: ValidatorSchema, allowedTools: DEFAULT_VALIDATOR.allowedTools, model: node.model ?? DEFAULT_VALIDATOR.model, maxTurns: DEFAULT_VALIDATOR.maxTurns, guards: node.guards, env }));
  await assertChangeSetUnchanged(args.cwd, expectedState);
  if (result.output.verdict !== "pass") throw new Error(`final validation ${result.output.verdict}: ${result.output.reasons.join("; ")}`);
  return result.output;
}

async function runGenericAgent(provider: AgentProvider, node: AgentNode, context: NodeExecutionContext, args: WorkflowRunRequest) {
  const prompt = await resolveCommand(node.command, { cwd: args.primaryCwd }).then((result) => result.content).catch(() => node.command);
  const result = await callAgent(provider, node, context, args, { phase: node.id, cwd: args.cwd, prompt: `${prompt}\n\nUser request:\n${args.userPrompt}\n\nInputs:\n${JSON.stringify(node.inputs, null, 2)}`, schema: schemaFromDefinition(node.output_schema), model: node.model, guards: node.guards, allowedTools: node.tools });
  return result.output;
}

type AgentNode = Extract<NormalizedWorkflowDefinition["nodes"][number], { type: "agent" }>;
async function callAgent<T>(provider: AgentProvider, node: AgentNode, context: NodeExecutionContext, args: WorkflowRunRequest, request: Parameters<AgentProvider["run"]>[0] & { schema: z.ZodType<T> }) {
  const previous = [...(context.checkpoint?.attemptHistory ?? context.snapshot.nodes[node.id]?.attemptHistory ?? [])].reverse().find((attempt) => attempt.session?.provider === provider.id)?.session;
  const parked = (context.checkpoint?.output ?? context.snapshot.nodes[node.id]?.output) as { humanAnswer?: unknown; session?: AgentSession } | undefined;
  const session = parked?.session?.provider === provider.id ? parked.session : previous;
  const nextRequest = parked?.humanAnswer === undefined ? request : { ...request, prompt: `Human answer: ${JSON.stringify(parked.humanAnswer)}\n\n${request.prompt}` };
  const transcripts = new TranscriptStore(args.primaryCwd, args.taskSlug);
  const onEvent = (event: Parameters<NonNullable<typeof nextRequest.onEvent>>[0]) => transcripts.append(context.attempt, provider.id, event).then(() => undefined);
  await onEvent({ type: "request", prompt: nextRequest.prompt, systemPrompt: nextRequest.systemPrompt, model: nextRequest.model, tools: nextRequest.allowedTools, guards: nextRequest.guards });
  const streamedRequest = { ...nextRequest, onEvent };
  if (session && session.connectionFingerprint !== provider.connectionFingerprint) throw new Error(`provider connection changed for ${provider.id}; refusing to resume session ${session.id}`);
  try {
    const result = session && provider.resume ? await provider.resume(session, streamedRequest) : await provider.run(streamedRequest);
    await context.reportAttempt({ session: result.session, usage: result.usage });
    return result;
  } catch (error) {
    if (error instanceof AgentProviderError) await context.reportAttempt(error.metadata);
    if (error instanceof AgentPausedError) { await context.reportAttempt({ session: error.session, usage: error.metadata.usage }); const asked = new Date(); throw new PauseWorkflowError({ nodeId: node.id, question: error.question, options: error.options, askedAt: asked.toISOString(), expiresAt: new Date(asked.getTime() + (node.timeout ?? args.definition.defaults.timeout ?? 60_000)).toISOString(), resumeNode: true, session: error.session }); }
    throw error;
  }
}

function taskPrompt(verb: string, task: PlannerTask): string { return `${verb} task: ${task.title}\n\n${task.description}\n\nAcceptance criteria:\n${task.acceptance.map((item) => `- ${item}`).join("\n")}`; }
function plannerRequest(userPrompt: string, outcome: NormalizedWorkflowDefinition["outcome"]["type"]): string { const delivery = outcome === "pull_request" ? "the privileged pull_request executor will publish a draft PR" : outcome === "branch" ? "the privileged commit executor will create commits" : "there is no external deliverable"; return `${userPrompt}\n\nWorkflow-managed effects: ${delivery}. Never create tasks that commit, push, publish/update a pull request, merge, or deploy.`; }
async function withValidatorScratch<T>(cwd: string, identity: string, run: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const scratch = join(cwd, ".harny", "tmp", `validator-${identity.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
  await mkdir(scratch, { recursive: true });
  try { return await run({ TMPDIR: scratch, TMP: scratch, TEMP: scratch }); }
  finally { await rm(scratch, { recursive: true, force: true }); }
}
function validatorScratchInstructions(scratch: string): string {
  return `\n\nRUNTIME SCRATCH POLICY: the harness assigned ${JSON.stringify(scratch)} as TMPDIR/TMP/TEMP for this attempt. Put every temporary artifact beneath that directory, refer to it through $TMPDIR when possible, and never create fixed files directly under /tmp. The harness removes the assigned directory when the attempt ends.`;
}
function findFailed(nodes: Record<string, { status: string; error?: string; steps?: Record<string, { status: string; error?: string }> }>) { for (const node of Object.values(nodes)) { if (node.status === "failed") return node; const step = Object.values(node.steps ?? {}).find((candidate) => candidate.status === "failed"); if (step) return step; } return undefined; }
async function headSha(cwd: string): Promise<string> { const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "pipe" }); const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]); if (code) throw new Error(`git rev-parse failed: ${stderr.trim()}`); return stdout.trim(); }
async function resetUnauthorizedHistory(cwd: string, sha: string): Promise<void> { const proc = Bun.spawn(["git", "reset", "--mixed", sha], { cwd, stdout: "pipe", stderr: "pipe" }); const stderr = new Response(proc.stderr).text(); if (await proc.exited) throw new Error(`could not restore expected HEAD ${sha}: ${await stderr}`); }
