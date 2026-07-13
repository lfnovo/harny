import { createInterface } from "node:readline/promises";
import { findRun } from "../harness/state/runDiscovery.js";
import { RunStore } from "../harness/state/runStore.js";
import { RunWorkflowPersistence } from "../harness/workflow/persistence.js";
import { answerWorkflow, materializeHumanExpiry } from "../harness/workflow/runtime.js";
import { patchPointer } from "../harness/state/registry.js";
import { continueRun } from "../harness/orchestrator.js";

export async function handleAnswer(cmd: { kind: "answer"; runId: string; text?: string; json?: string }): Promise<void> {
  const run = await findRun(cmd.runId);
  if (!run) { console.error(`Run not found: ${cmd.runId}`); process.exit(1); }
  const store = new RunStore(run.workspace.primary_cwd, run.run.task_slug);
  const persistence = new RunWorkflowPersistence(store);
  const afterExpiry = await materializeHumanExpiry(persistence);
  if (afterExpiry?.status === "failed") { const ended = new Date().toISOString(); await store.mutate((state) => { state.run.ended_at = ended; state.run.ended_reason = "human input expired"; state.workspace.reserved = false; }, { type: "run.human_expired" }); await patchPointer(run.run.id, { status: "failed", ended_at: ended }); throw new Error(`Run ${cmd.runId} expired before it was answered.`); }
  const fallbackReady = afterExpiry?.status === "running" && !afterExpiry.pendingHuman;
  let value: unknown;
  if (!fallbackReady) {
    if (cmd.json !== undefined) { try { value = JSON.parse(cmd.json); } catch (error) { throw new Error(`--json is invalid: ${String(error)}`); } }
    else if (cmd.text !== undefined) value = cmd.text;
    else { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { value = await rl.question(`${run.execution.pendingHuman?.question ?? "Answer"}\n> `); } finally { rl.close(); } }
    await answerWorkflow(persistence, value);
  }
  await store.mutate((state) => { state.run.pid = process.pid; state.run.ended_reason = null; }, { type: fallbackReady ? "run.human_fallback_resumed" : "run.answered", node_id: run.execution.pendingHuman?.nodeId, data: fallbackReady ? undefined : { answer: value } });
  const result = await continueRun({ run: (await store.load())!, mode: "async", logMode: "compact" });
  if (result.status === "waiting_human") console.log(`[harny] run paused again: ${run.run.id}`);
  else console.log(`[harny] status=${result.status} branch=${run.workspace.branch}`);
}
