import { createInterface } from "node:readline/promises";
import { findHistoricalRun } from "../harness/state/v3/discovery.js";
import { FilesystemRunStoreV3 } from "../harness/state/v3/store.js";
import { V3FeatureRunPersistence } from "../harness/workflow/persistence.js";
import { answerWorkflow, materializeHumanExpiry } from "../harness/workflow/runtime.js";
import { ClaudeProvider } from "../harness/providers/claude.js";
import { runNextFeatureDev } from "../harness/workflow/featureDev.js";
import { realGitOps } from "../harness/gitOps.js";
import { patchPointer } from "../harness/state/registry.js";
import { CodexProvider } from "../harness/providers/codex.js";
import { loadWorkflow } from "../harness/workflow/loader.js";
import { runDeclarativeWorkflow } from "../harness/workflow/declarativeRunner.js";
import type { AgentProvider } from "../harness/providers/types.js";

export async function handleAnswer(cmd: { kind: "answer"; runId: string; text?: string; json?: string }): Promise<void> {
  const historical = await findHistoricalRun(cmd.runId);
  if (!historical) { console.error(`Run not found: ${cmd.runId}`); process.exit(1); }
  if (historical.schema_version === 2) throw new Error(`Run ${cmd.runId} uses state v2 and is read-only; v2 runs cannot be resumed.`);
  const run = historical.raw; const store = new FilesystemRunStoreV3(run.workspace.primary_cwd, run.run.task_slug); const persistence = new V3FeatureRunPersistence(store);
  const afterExpiry = await materializeHumanExpiry(persistence);
  if (afterExpiry?.status === "failed") {
    await store.mutate((state) => { state.run.status = "failed"; state.run.ended_at = new Date().toISOString(); state.run.ended_reason = "human input expired"; state.workspace.reserved = false; state.pending_human = null; }, { type: "run.human_expired" });
    await patchPointer(run.run.id, { status: "failed", ended_at: new Date().toISOString() }); throw new Error(`Run ${cmd.runId} expired before it was answered.`);
  }
  const fallbackReady = run.run.status === "paused" && afterExpiry?.status === "running" && !afterExpiry.pendingHuman;
  let value: unknown;
  if (!fallbackReady) {
    if (cmd.json !== undefined) { try { value = JSON.parse(cmd.json); } catch (error) { throw new Error(`--json is invalid: ${String(error)}`); } }
    else if (cmd.text !== undefined) value = cmd.text;
    else { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { value = await rl.question(`${run.pending_human?.question ?? "Answer"}\n> `); } finally { rl.close(); } }
    await answerWorkflow(persistence, value);
  }
  await store.mutate((state) => { state.run.status = "running"; state.run.pid = process.pid; state.run.ended_reason = null; state.pending_human = null; }, { type: fallbackReady ? "run.human_fallback_resumed" : "run.answered", node_id: run.pending_human?.node_id, data: fallbackReady ? undefined : { answer: value } });
  const provider = new ClaudeProvider({ workflowId: run.run.workflow, runId: run.run.id, taskSlug: run.run.task_slug, primaryCwd: run.workspace.primary_cwd, mode: "async", logMode: "compact" }); const providers = new Map<string, AgentProvider>([[provider.id, provider], ["codex", new CodexProvider()]]);
  const definition = (await loadWorkflow(run.origin.workflow_source || run.run.workflow, { cwd: run.workspace.primary_cwd, providers })).definition;
  const result = run.run.workflow === "feature-dev" || run.run.workflow === "feature-pr"
    ? await runNextFeatureDev({ provider, providers, persistence, cwd: run.workspace.cwd, primaryCwd: run.workspace.primary_cwd, taskSlug: run.run.task_slug, userPrompt: run.origin.prompt, variant: "default", workflowId: run.run.workflow, workflowSpec: run.origin.workflow_source, mode: "async" })
    : await runDeclarativeWorkflow({ definition, persistence, providers, cwd: run.workspace.cwd, primaryCwd: run.workspace.primary_cwd, userPrompt: run.origin.prompt, branch: run.workspace.branch, mode: "async" });
  if (result.status === "waiting_human") { await patchPointer(run.run.id, { status: "paused", ended_at: null }); console.log(`[harny] run paused again: ${run.run.id}`); return; }
  const finalStatus: "done" | "failed" = result.status;
  const endedAt = new Date().toISOString(); await store.mutate((state) => { state.run.status = finalStatus; state.run.ended_at = endedAt; state.run.ended_reason = finalStatus; state.workspace.reserved = false; }, { type: finalStatus === "done" ? "run.completed" : "run.failed" });
  await patchPointer(run.run.id, { status: finalStatus, ended_at: endedAt });
  if (result.status === "done" && run.workspace.worktree_path) await realGitOps.removeWorktree(run.workspace.primary_cwd, run.workspace.worktree_path, { force: true });
  console.log(`[harny] status=${result.status} branch=${run.workspace.branch}`);
}
