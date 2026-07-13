import type { Plan } from "../types.js";
import type { PhaseEntry } from "../state/schema.js";
import type { WorkflowSnapshot, WorkflowStateStore } from "./runtime.js";
import { FilesystemRunStoreV3 } from "../state/v3/store.js";
import type { ChangeSet } from "../git/changeSet.js";

export interface FeatureRunPersistence extends WorkflowStateStore {
  loadPlan(): Promise<Plan | null>;
  savePlan(plan: Plan): Promise<void>;
  appendPhase(phase: PhaseEntry): Promise<void>;
  updatePhase(name: string, attempt: number, patch: Partial<PhaseEntry>): Promise<void>;
  saveChangeSet(changeSet: ChangeSet, patch?: { validatedBy?: string; committedSha?: string | null }): Promise<void>;
  setPhaseProvider(name: string, attempt: number, provider: string): Promise<void>;
}

export class V3FeatureRunPersistence implements FeatureRunPersistence {
  constructor(private readonly store: FilesystemRunStoreV3) {}
  async load(): Promise<WorkflowSnapshot | null> { const run = await this.store.load(); return (run?.artifacts["runtime-snapshot"]?.value as WorkflowSnapshot | undefined) ?? null; }
  async save(snapshot: WorkflowSnapshot): Promise<void> { await this.store.mutate((run) => {
    run.artifacts["runtime-snapshot"] = { id: "runtime-snapshot", type: "workflow_snapshot", created_at: new Date().toISOString(), producer: "runtime", value: snapshot };
    if (snapshot.status === "paused" && snapshot.pendingHuman) { run.run.status = "paused"; run.pending_human = { node_id: snapshot.pendingHuman.nodeId, question: snapshot.pendingHuman.question, options: snapshot.pendingHuman.options ?? null, asked_at: snapshot.pendingHuman.askedAt, expires_at: snapshot.pendingHuman.expiresAt, session: snapshot.pendingHuman.session ?? null, fallback: snapshot.pendingHuman.fallback ?? null }; }
    else if (run.run.status === "paused" && snapshot.status === "running") { run.run.status = "running"; run.pending_human = null; }
    const pr = snapshot.nodes.pull_request?.output;
    if (pr && typeof pr === "object") { run.artifacts.pull_request = { id: "pull_request", type: "pull_request", created_at: new Date().toISOString(), producer: "pull_request", value: pr }; if (!run.deliverables.includes("pull_request")) run.deliverables.push("pull_request"); }
    for (const instance of Object.values(snapshot.nodes)) {
      const artifactId = instance.output === undefined ? null : `node:${instance.id}:output`; if (artifactId) run.artifacts[artifactId] = { id: artifactId, type: "node_output", created_at: new Date().toISOString(), producer: instance.id, value: instance.output };
      const nodeSession = readSession(instance.output); run.nodes[instance.id] = { id: instance.id, type: "workflow_node", status: instance.status, attempts: (instance.attemptHistory ?? []).map((attempt, index, all) => ({ number: attempt.number, status: attempt.status === "cancelled" ? "failed" : attempt.status, started_at: attempt.startedAt, ended_at: attempt.endedAt ?? null, session: index === all.length - 1 ? nodeSession : null, error: attempt.error ?? null })), output_artifacts: artifactId ? [artifactId] : [], error: instance.error ?? null };
      for (const [stepKey, step] of Object.entries(instance.steps ?? {})) { const id = `${instance.id}:${stepKey.replace(".", ":")}`; const stepArtifact = step.output === undefined ? null : `node:${id}:output`; if (stepArtifact) run.artifacts[stepArtifact] = { id: stepArtifact, type: "node_output", created_at: new Date().toISOString(), producer: id, value: step.output }; const session = readSession(step.output); run.nodes[id] = { id, type: "workflow_step", status: step.status, attempts: (step.attemptHistory ?? []).map((attempt, index, all) => ({ number: attempt.number, status: attempt.status === "cancelled" ? "failed" : attempt.status, started_at: attempt.startedAt, ended_at: attempt.endedAt ?? null, session: index === all.length - 1 ? session : null, error: attempt.error ?? null })), output_artifacts: stepArtifact ? [stepArtifact] : [], error: step.error ?? null }; }
    }
  }, { type: snapshot.status === "paused" ? "run.paused" : "runtime.snapshot" }); }
  async loadPlan(): Promise<Plan | null> { const run = await this.store.load(); return (run?.artifacts.plan?.value as Plan | undefined) ?? null; }
  async savePlan(plan: Plan): Promise<void> { await this.store.mutate((run) => { run.artifacts.plan = { id: "plan", type: "plan", created_at: new Date().toISOString(), producer: "planner", value: structuredClone(plan) }; }, { type: "artifact.plan.updated" }); }
  async appendPhase(phase: PhaseEntry): Promise<void> {
    const key = phaseKey(phase.name, phase.attempt); await this.store.mutate((run) => { run.nodes[key] = { id: key, type: "agent", status: phase.status === "running" ? "running" : "pending", attempts: [{ number: phase.attempt, status: "running", started_at: phase.started_at, ended_at: null, session: phase.session_id ? { provider: "unknown", id: phase.session_id } : null, error: null }], output_artifacts: [], error: null }; }, { type: "node.started", node_id: key });
  }
  async updatePhase(name: string, attempt: number, patch: Partial<PhaseEntry>): Promise<void> {
    const key = phaseKey(name, attempt); await this.store.mutate((run) => { const node = run.nodes[key]; if (!node) throw new Error(`phase ${key} not found`); const row = node.attempts.at(-1)!; row.ended_at = patch.ended_at ?? row.ended_at; row.session = patch.session_id ? { provider: "unknown", id: patch.session_id } : row.session; row.status = patch.status === "completed" ? "completed" : patch.status === "failed" ? "failed" : patch.status === "parked" ? "paused" : row.status; node.status = row.status === "completed" ? "completed" : row.status === "failed" ? "failed" : row.status === "paused" ? "paused" : node.status; if (patch.verdict) { const artifactId = `${key}:output`; run.artifacts[artifactId] = { id: artifactId, type: "agent_output", created_at: patch.ended_at ?? new Date().toISOString(), producer: key, value: patch.verdict }; node.output_artifacts = [artifactId]; } }, { type: "node.finished", node_id: key });
  }
  async saveChangeSet(changeSet: ChangeSet, patch: { validatedBy?: string; committedSha?: string | null } = {}): Promise<void> {
    await this.store.mutate((run) => { const current = run.changesets[changeSet.id]; run.changesets[changeSet.id] = { id: changeSet.id, base_sha: changeSet.base_sha, entries: changeSet.entries, validated_by: patch.validatedBy ?? current?.validated_by ?? null, committed_sha: patch.committedSha !== undefined ? patch.committedSha : current?.committed_sha ?? null }; }, { type: patch.committedSha !== undefined ? "changeset.committed" : patch.validatedBy ? "changeset.validated" : "changeset.captured" });
  }
  async setPhaseProvider(name: string, attempt: number, provider: string): Promise<void> { const key = phaseKey(name, attempt); await this.store.mutate((run) => { const row = run.nodes[key]?.attempts.at(-1); if (row?.session) row.session.provider = provider; }, { type: "node.session_provider", node_id: key }); }
}
function phaseKey(name: string, attempt: number) { return `${name}#${attempt}`; }
function readSession(output: unknown): { provider: string; id: string } | null { if (!output || typeof output !== "object") return null; const session = (output as Record<string, unknown>).session; return session && typeof session === "object" && typeof (session as Record<string, unknown>).provider === "string" && typeof (session as Record<string, unknown>).id === "string" ? session as { provider: string; id: string } : null; }
