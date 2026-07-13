import { z } from "zod";
import type { AgentProvider } from "../providers/types.js";
import { AgentPausedError } from "../providers/types.js";
import type { FeatureRunPersistence } from "./persistence.js";
import type { NormalizedWorkflowDefinition } from "./schema.js";
import { PauseWorkflowError, runWorkflow, type NodeExecutor } from "./runtime.js";
import { resolveCommand } from "./loader.js";
import { createCommandExecutor } from "./commandExecutor.js";
import { createHumanExecutor } from "./humanExecutor.js";
import { captureChangeSet, commitChangeSet, type ChangeSet } from "../git/changeSet.js";
import type { ForgeProvider } from "../forge/types.js";
import { GitHubForgeProvider } from "../forge/github.js";
import { createPullRequestExecutor } from "../forge/pullRequestExecutor.js";
import type { RunMode } from "../types.js";
import { createInterface } from "node:readline/promises";

export async function runDeclarativeWorkflow(args: { definition: NormalizedWorkflowDefinition; persistence: FeatureRunPersistence; providers: ReadonlyMap<string, AgentProvider>; cwd: string; primaryCwd: string; userPrompt: string; branch: string; mode: RunMode; forge?: ForgeProvider }) {
  const agent: NodeExecutor = async (node, context) => {
    if (node.type !== "agent") throw new Error("invalid agent node"); const provider = args.providers.get(node.provider ?? args.definition.defaults.provider); if (!provider) throw new Error(`provider unavailable: ${node.provider ?? args.definition.defaults.provider}`);
    const prompt = await resolveCommand(node.command, { cwd: args.primaryCwd }).then((result) => result.content).catch(() => node.command);
    const schema = schemaFromDefinition(node.output_schema); const resume = (context.checkpoint?.output ?? context.snapshot.nodes[node.id]?.output) as { humanAnswer?: unknown; session?: { provider: string; id: string } } | undefined;
    const request = { phase: node.id, cwd: args.cwd, prompt: `${resume?.humanAnswer !== undefined ? `Human answer: ${JSON.stringify(resume.humanAnswer)}\n\n` : ""}${prompt}\n\nUser request:\n${args.userPrompt}\n\nInputs:\n${JSON.stringify(node.inputs, null, 2)}`, schema, model: node.model, guards: node.guards, allowedTools: node.tools };
    let result;
    try { result = resume?.session?.provider === provider.id && provider.resume ? await provider.resume(resume.session, request) : await provider.run(request); }
    catch (error) { if (error instanceof AgentPausedError) { const asked = new Date(); throw new PauseWorkflowError({ nodeId: node.id, question: error.question, options: error.options, askedAt: asked.toISOString(), expiresAt: new Date(asked.getTime() + (node.timeout ?? args.definition.defaults.timeout ?? 60_000)).toISOString(), resumeNode: true, session: error.session }); } throw error; }
    const output: Record<string, unknown> = result.output && typeof result.output === "object" ? { ...(result.output as Record<string, unknown>) } : { value: result.output };
    if (node.guards.includes("no_git_history")) output.changeSet = await captureChangeSet(args.cwd); return { ...output, session: result.session, usage: result.usage };
  };
  const commit: NodeExecutor = async (node) => { if (node.type !== "commit") throw new Error("invalid commit node"); const changeSet = node.changeset as unknown as ChangeSet; if (!changeSet?.id) throw new Error(`commit ${node.id} did not receive a ChangeSet`); const sha = await commitChangeSet(args.cwd, node.message, changeSet); await args.persistence.saveChangeSet(changeSet, { committedSha: sha }); return { sha, changeSetId: changeSet.id }; };
  const prBase = createPullRequestExecutor({ cwd: args.cwd, forge: args.forge ?? new GitHubForgeProvider(), expectedSha: () => headSha(args.cwd) });
  const pull_request: NodeExecutor = (node, context) => node.type === "pull_request" ? prBase({ ...node, head: node.head === "${{ run.branch }}" ? args.branch : node.head }, context) : Promise.reject(new Error("invalid PR node"));
  const human = createHumanExecutor({ mode: args.mode === "interactive" ? "interactive" : "async", async ask({ question }) { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(`${question}\n> `); } finally { rl.close(); } } }, args.definition.defaults.timeout);
  const snapshot = await runWorkflow({ workflow: args.definition, store: args.persistence, executors: { agent, command: createCommandExecutor(args.cwd), human, commit, pull_request } });
  const failed = Object.values(snapshot.nodes).find((node) => node.status === "failed");
  return { status: snapshot.status === "paused" ? "waiting_human" as const : snapshot.status === "done" ? "done" as const : "failed" as const, snapshot, error: failed?.error };
}

function schemaFromDefinition(definition: Record<string, unknown> | undefined): z.ZodType<Record<string, unknown>> {
  if (!definition) return z.record(z.string(), z.unknown());
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    const required = Array.isArray(definition.required) ? definition.required : []; for (const key of required) if (typeof key === "string" && !(key in value)) ctx.addIssue({ code: "custom", message: `missing required output ${key}` });
    if (definition.type && definition.type !== "object") ctx.addIssue({ code: "custom", message: "v1 agent output_schema must describe an object" });
  });
}
async function headSha(cwd: string) { const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd, stdout: "pipe", stderr: "pipe" }); const output = await new Response(proc.stdout).text(); if (await proc.exited) throw new Error(await new Response(proc.stderr).text()); return output.trim(); }
