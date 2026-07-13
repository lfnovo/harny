import type { ChangeSet } from "../git/changeSet.js";
import { RunStore } from "../state/runStore.js";
import type { WorkflowSnapshot, WorkflowStateStore } from "./runtime.js";

export interface RunPersistence extends WorkflowStateStore {
  saveChangeSet(changeSet: ChangeSet, patch?: { validatedBy?: string; committedSha?: string | null }): Promise<void>;
}

/** Thin field adapter: the scheduler state is stored exactly once in run.execution. */
export class RunWorkflowPersistence implements RunPersistence {
  constructor(private readonly store: RunStore) {}

  async load(): Promise<WorkflowSnapshot | null> { return (await this.store.load())?.execution ?? null; }

  async save(execution: WorkflowSnapshot): Promise<void> {
    await this.store.mutate((run) => { run.execution = structuredClone(execution); }, {
      type: execution.status === "paused" ? "run.paused" : "execution.checkpoint",
    });
  }

  async saveChangeSet(changeSet: ChangeSet, patch: { validatedBy?: string; committedSha?: string | null } = {}): Promise<void> {
    await this.store.mutate((run) => {
      const current = run.changesets[changeSet.id];
      run.changesets[changeSet.id] = {
        id: changeSet.id,
        base_sha: changeSet.base_sha,
        entries: changeSet.entries,
        validated_by: patch.validatedBy ?? current?.validated_by ?? null,
        committed_sha: patch.committedSha !== undefined ? patch.committedSha : current?.committed_sha ?? null,
      };
    }, { type: patch.committedSha !== undefined ? "changeset.committed" : patch.validatedBy ? "changeset.validated" : "changeset.captured" });
  }
}
