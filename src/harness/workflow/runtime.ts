import type { NormalizedWorkflowDefinition, WorkflowNode, WorkflowStep } from "./schema.js";
import { evaluatePredicate, validateWorkflow } from "./validate.js";
import type { Observer, WorkflowEvent } from "./observer.js";

export type NodeStatus = "pending" | "running" | "completed" | "skipped" | "failed" | "paused" | "cancelled";
export interface RuntimeAttempt { number: number; status: "running" | "completed" | "failed" | "paused" | "cancelled"; startedAt: string; endedAt?: string; error?: string; }
export interface NodeInstance { id: string; status: NodeStatus; attempts: number; attemptHistory?: RuntimeAttempt[]; output?: unknown; error?: string; steps?: Record<string, NodeInstance>; }
export interface PendingHumanInput { nodeId: string; question: string; options?: unknown[]; askedAt: string; expiresAt: string; fallback?: string; resumeNode?: boolean; session?: { provider: string; id: string }; }
export interface WorkflowSnapshot { workflow: string; status: "running" | "paused" | "done" | "failed" | "cancelled"; nodes: Record<string, NodeInstance>; pendingHuman?: PendingHumanInput; }
export interface WorkflowStateStore { load(): Promise<WorkflowSnapshot | null>; save(snapshot: WorkflowSnapshot): Promise<void>; }
export interface NodeExecutionContext { snapshot: WorkflowSnapshot; signal: AbortSignal; checkpoint?: NodeInstance; foreach?: { item: unknown; index: number; outputs: Record<string, unknown> }; }
export type NodeExecutor = (node: WorkflowNode, context: NodeExecutionContext) => Promise<unknown>;

export class RetryWorkflowStepError extends Error {
  constructor(public readonly returnTo: string, message: string) { super(message); }
}
export class PauseWorkflowError extends Error {
  constructor(public readonly pending: PendingHumanInput) { super(`workflow paused at ${pending.nodeId}`); }
}

/** Deterministic v1 scheduler: persisted state is reloaded at every boundary. */
export async function runWorkflow(args: {
  workflow: NormalizedWorkflowDefinition;
  store: WorkflowStateStore;
  executors: Partial<Record<WorkflowNode["type"], NodeExecutor>>;
  signal?: AbortSignal;
  observer?: Observer;
}): Promise<WorkflowSnapshot> {
  validateWorkflow(args.workflow);
  let snapshot = await args.store.load() ?? initialSnapshot(args.workflow);
  if (snapshot.workflow !== args.workflow.name) throw new Error(`snapshot belongs to workflow ${snapshot.workflow}`);
  // A process can disappear after persisting "running" but before the next
  // boundary. Re-queue that node; completed foreach steps remain checkpointed.
  for (const instance of Object.values(snapshot.nodes)) if (instance.status === "running") instance.status = "pending";
  while (snapshot.status === "running") {
    const node = nextReady(args.workflow.nodes, snapshot);
    if (!node) {
      const unfinished = Object.values(snapshot.nodes).some((n) => n.status === "pending" || n.status === "running");
      snapshot.status = unfinished ? "failed" : "done";
      await args.store.save(snapshot); await observe(args.observer, { type: "run.finished", workflow: snapshot.workflow, at: new Date().toISOString(), data: { status: snapshot.status } }); break;
    }
    const instance = snapshot.nodes[node.id]!;
    if (node.when && !evaluatePredicate(resolveReferences(node.when, snapshot) as typeof node.when)) {
      instance.status = "skipped"; await args.store.save(snapshot); snapshot = (await args.store.load())!; continue;
    }
    const executor = node.type === "foreach" || node.type === "cancel" ? undefined : args.executors[node.type];
    if (!executor && node.type !== "foreach" && node.type !== "cancel") throw new Error(`no executor registered for ${node.type}`);
    const maxAttempts = node.retry?.max_attempts ?? 1;
    instance.status = "running"; instance.attempts += 1; instance.attemptHistory ??= []; instance.attemptHistory.push({ number: instance.attempts, status: "running", startedAt: new Date().toISOString() }); await args.store.save(snapshot); await observe(args.observer, { type: "node.started", workflow: snapshot.workflow, nodeId: node.id, at: new Date().toISOString(), data: { attempt: instance.attempts } });
    const controller = new AbortController();
    const onAbort = () => controller.abort(args.signal?.reason);
    args.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = node.timeout ?? args.workflow.defaults.timeout;
    const timer = timeout ? setTimeout(() => controller.abort(new Error(`node ${node.id} timed out`)), timeout) : undefined;
    try {
      instance.output = await abortable(node.type === "foreach"
        ? executeForeach(node, snapshot, args.store, args.executors, controller.signal)
        : node.type === "cancel" ? { reason: node.reason } : executor!(resolveReferences(node, snapshot) as WorkflowNode, { snapshot, signal: controller.signal }), controller.signal);
      if (node.type === "cancel") { instance.status = "cancelled"; snapshot.status = "cancelled"; }
      else {
      instance.status = "completed"; delete instance.error;
      }
      const completedAttempt = instance.attemptHistory?.at(-1); if (completedAttempt) { completedAttempt.status = node.type === "cancel" ? "cancelled" : "completed"; completedAttempt.endedAt = new Date().toISOString(); }
    } catch (error) {
      if (error instanceof PauseWorkflowError) {
        instance.status = "paused"; snapshot.status = "paused"; snapshot.pendingHuman = error.pending;
        const pausedAttempt = instance.attemptHistory?.at(-1); if (pausedAttempt) { pausedAttempt.status = "paused"; pausedAttempt.endedAt = new Date().toISOString(); }
        await args.store.save(snapshot); await observe(args.observer, { type: "node.paused", workflow: snapshot.workflow, nodeId: node.id, at: new Date().toISOString() }); break;
      }
      instance.error = String(error);
      const failedAttempt = instance.attemptHistory?.at(-1); if (failedAttempt) { failedAttempt.status = "failed"; failedAttempt.endedAt = new Date().toISOString(); failedAttempt.error = String(error); }
      instance.status = instance.attempts < maxAttempts ? "pending" : "failed";
      if (instance.status === "failed") snapshot.status = "failed";
    } finally {
      if (timer) clearTimeout(timer); args.signal?.removeEventListener("abort", onAbort);
    }
    const eventType = instance.status === "cancelled" ? "node.cancelled" : instance.error ? "node.failed" : "node.completed";
    await args.store.save(snapshot); await observe(args.observer, { type: eventType, workflow: snapshot.workflow, nodeId: node.id, at: new Date().toISOString(), data: instance.error ? { error: instance.error } : undefined });
    snapshot = (await args.store.load())!;
  }
  return snapshot;
}
async function observe(observer: Observer | undefined, event: WorkflowEvent): Promise<void> { try { await observer?.observe(event); } catch { /* observers never control execution */ } }
function abortable<T>(value: T | Promise<T>, signal: AbortSignal): Promise<T> { const promise = Promise.resolve(value); if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted")); return new Promise((resolve, reject) => { const abort = () => reject(signal.reason ?? new Error("aborted")); signal.addEventListener("abort", abort, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)); }); }

export async function answerWorkflow(store: WorkflowStateStore, value: unknown): Promise<WorkflowSnapshot> {
  const snapshot = await store.load(); if (!snapshot || snapshot.status !== "paused" || !snapshot.pendingHuman) throw new Error("workflow is not waiting for human input");
  if (Date.now() >= Date.parse(snapshot.pendingHuman.expiresAt)) throw new Error("human input has expired");
  const node = findInstance(snapshot, snapshot.pendingHuman.nodeId); if (!node || node.status !== "paused") throw new Error("pending human node is missing");
  if (snapshot.pendingHuman.resumeNode) { node.output = { humanAnswer: value, session: snapshot.pendingHuman.session }; node.status = "pending"; const parentId = snapshot.pendingHuman.nodeId.split(":")[0]!; if (snapshot.nodes[parentId]?.status === "paused") snapshot.nodes[parentId]!.status = "pending"; }
  else { node.output = value; node.status = "completed"; }
  snapshot.status = "running"; delete snapshot.pendingHuman; await store.save(snapshot); return snapshot;
}
function findInstance(snapshot: WorkflowSnapshot, id: string): NodeInstance | undefined { if (snapshot.nodes[id]) return snapshot.nodes[id]; const [parent, index, step] = id.split(":"); return snapshot.nodes[parent!]?.steps?.[`${index}.${step}`]; }

export async function materializeHumanExpiry(store: WorkflowStateStore, now = new Date()): Promise<WorkflowSnapshot | null> {
  const snapshot = await store.load(); if (!snapshot?.pendingHuman || snapshot.status !== "paused" || now.getTime() < Date.parse(snapshot.pendingHuman.expiresAt)) return snapshot;
  const node = snapshot.nodes[snapshot.pendingHuman.nodeId];
  if (snapshot.pendingHuman.fallback && node) { node.output = { expired: true, fallback: snapshot.pendingHuman.fallback }; node.status = "completed"; snapshot.status = "running"; }
  else { if (node) { node.status = "failed"; node.error = "human input expired"; } snapshot.status = "failed"; }
  delete snapshot.pendingHuman; await store.save(snapshot); return snapshot;
}

async function executeForeach(
  node: Extract<WorkflowNode, { type: "foreach" }>, snapshot: WorkflowSnapshot,
  store: WorkflowStateStore,
  executors: Partial<Record<WorkflowNode["type"], NodeExecutor>>, signal: AbortSignal,
): Promise<unknown[]> {
  const items = Array.isArray(node.items) ? node.items : resolveItems(node.items, snapshot);
  if (items.length > node.max_items) throw new Error(`foreach ${node.id} received ${items.length} items, limit is ${node.max_items}`);
  const outputs: unknown[] = [];
  const parent = snapshot.nodes[node.id]!;
  parent.steps ??= {};
  for (let index = 0; index < items.length; index++) {
    const itemOutputs: Record<string, unknown> = {};
    let stepIndex = 0;
    while (stepIndex < node.steps.length) {
      const step = node.steps[stepIndex]!;
      const checkpointId = `${index}.${step.id}`;
      const checkpoint = parent.steps[checkpointId] ??= { id: checkpointId, status: "pending", attempts: 0 };
      if (checkpoint.status === "completed" || checkpoint.status === "skipped") { itemOutputs[step.id] = checkpoint.output; stepIndex += 1; continue; }
      if (!step.depends_on.every((id) => id in itemOutputs)) throw new Error(`foreach step ${step.id} has unsatisfied dependencies`);
      if (step.when && !evaluatePredicate(step.when)) { checkpoint.status = "skipped"; await store.save(snapshot); stepIndex += 1; continue; }
      const executor = executors[step.type];
      if (!executor) throw new Error(`no executor registered for foreach step ${step.type}`);
      checkpoint.status = "running"; checkpoint.attempts += 1; checkpoint.attemptHistory ??= []; checkpoint.attemptHistory.push({ number: checkpoint.attempts, status: "running", startedAt: new Date().toISOString() }); await store.save(snapshot);
      try {
        checkpoint.output = await executor(interpolateStep(step, node.as, items[index]) as WorkflowNode, { snapshot, signal, checkpoint, foreach: { item: items[index], index, outputs: itemOutputs } });
        checkpoint.status = "completed"; delete checkpoint.error; const completed = checkpoint.attemptHistory.at(-1); if (completed) { completed.status = "completed"; completed.endedAt = new Date().toISOString(); } itemOutputs[step.id] = checkpoint.output;
        await store.save(snapshot); stepIndex += 1;
      } catch (error) {
        if (error instanceof PauseWorkflowError) {
          checkpoint.status = "paused"; checkpoint.error = error.message; const paused = checkpoint.attemptHistory?.at(-1); if (paused) { paused.status = "paused"; paused.endedAt = new Date().toISOString(); } const pending = { ...error.pending, nodeId: `${node.id}:${index}:${step.id}` }; await store.save(snapshot); throw new PauseWorkflowError(pending);
        }
        if (error instanceof RetryWorkflowStepError && step.retry?.return_to === error.returnTo && checkpoint.attempts < step.retry.max_attempts) {
          const retryAttempt = checkpoint.attemptHistory?.at(-1); if (retryAttempt) { retryAttempt.status = "failed"; retryAttempt.endedAt = new Date().toISOString(); retryAttempt.error = error.message; }
          const target = node.steps.findIndex((candidate) => candidate.id === error.returnTo);
          for (let reset = target; reset <= stepIndex; reset++) {
            const resetStep = node.steps[reset]!; const resetCheckpoint = parent.steps[`${index}.${resetStep.id}`];
            if (resetCheckpoint) { resetCheckpoint.status = "pending"; delete resetCheckpoint.output; delete resetCheckpoint.error; }
            delete itemOutputs[resetStep.id];
          }
          if (step.retry.backoff_ms) await new Promise((resolve) => setTimeout(resolve, step.retry!.backoff_ms));
          await store.save(snapshot); stepIndex = target; continue;
        }
        checkpoint.status = "failed"; checkpoint.error = String(error); const failed = checkpoint.attemptHistory?.at(-1); if (failed) { failed.status = "failed"; failed.endedAt = new Date().toISOString(); failed.error = String(error); } await store.save(snapshot); throw error;
      }
    }
    outputs.push({ index, item: items[index], outputs: itemOutputs });
  }
  return outputs;
}

function resolveItems(reference: string, snapshot: WorkflowSnapshot): unknown[] {
  const match = reference.match(/^\$\{\{\s*nodes\.([a-z][a-z0-9_-]*)\.outputs(?:\.([a-zA-Z0-9_.-]+))?\s*}}$/);
  if (!match) throw new Error(`invalid foreach items reference: ${reference}`);
  let value: unknown = snapshot.nodes[match[1]!]?.output;
  for (const part of match[2]?.split(".") ?? []) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  if (!Array.isArray(value)) throw new Error(`foreach items reference ${reference} did not resolve to an array`);
  return value;
}

function resolveReferences(value: unknown, snapshot: WorkflowSnapshot): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\$\{\{\s*nodes\.([a-z][a-z0-9_-]*)\.outputs(?:\.([a-zA-Z0-9_.-]+))?\s*}}$/);
    if (exact) return outputPath(snapshot, exact[1]!, exact[2]);
    return value.replace(/\$\{\{\s*nodes\.([a-z][a-z0-9_-]*)\.outputs(?:\.([a-zA-Z0-9_.-]+))?\s*}}/g, (_all, id, path) => { const resolved = outputPath(snapshot, id, path); return typeof resolved === "string" ? resolved : JSON.stringify(resolved); });
  }
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, snapshot));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveReferences(child, snapshot)]));
  return value;
}
function outputPath(snapshot: WorkflowSnapshot, id: string, path?: string): unknown { let value = snapshot.nodes[id]?.output; for (const part of path?.split(".") ?? []) value = value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined; return value; }

function interpolateStep(step: WorkflowStep, alias: string, item: unknown): WorkflowStep {
  const token = `\${{ ${alias} }}`;
  const walk = (value: unknown): unknown => {
    if (value === token) return item;
    if (typeof value === "string") return value.replaceAll(token, typeof item === "string" ? item : JSON.stringify(item));
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
    return value;
  };
  return walk(step) as WorkflowStep;
}

function initialSnapshot(workflow: NormalizedWorkflowDefinition): WorkflowSnapshot {
  return { workflow: workflow.name, status: "running", nodes: Object.fromEntries(workflow.nodes.map((n) => [n.id, { id: n.id, status: "pending", attempts: 0 }])) };
}
function nextReady(nodes: WorkflowNode[], snapshot: WorkflowSnapshot): WorkflowNode | undefined {
  return nodes.find((node) => snapshot.nodes[node.id]?.status === "pending" && node.depends_on.every((id) => ["completed", "skipped"].includes(snapshot.nodes[id]?.status ?? "")));
}
