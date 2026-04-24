import type { StateStore } from "../state/store.js";
import type {
  State,
  PhaseEntry,
  HistoryEntry,
  PendingQuestion,
} from "../state/schema.js";

export type StoreCall =
  | { op: "createRun"; initial: State }
  | { op: "getState" }
  | { op: "updateLifecycle"; patch: Partial<State["lifecycle"]> }
  | { op: "appendPhase"; phase: PhaseEntry }
  | {
      op: "updatePhase";
      name: string;
      attempt: number;
      patch: Partial<PhaseEntry>;
    }
  | { op: "appendHistory"; entry: HistoryEntry }
  | { op: "setPendingQuestion"; q: PendingQuestion | null }
  | { op: "patchWorkflowState"; patch: Record<string, unknown> }
  | { op: "setPhoenix"; ref: { project: string; trace_id: string } };

/**
 * In-memory StateStore for L2 tests. Mirrors FilesystemStateStore contract —
 * createRun-twice throws, updatePhase-not-found throws, mutate-before-createRun
 * throws. Records every call on `calls[]` so tests can assert sequence, not
 * just final state.
 */
export class MockStateStore implements StateStore {
  readonly statePath = "/mock/state.json";
  readonly calls: StoreCall[] = [];
  /**
   * Public for setup convenience. Direct mutation bypasses calls[] —
   * intentional escape hatch. Use the StateStore methods when you want the
   * call log to reflect the change.
   */
  state: State | null = null;

  constructor(initial?: State) {
    if (initial) this.state = structuredClone(initial);
  }

  async createRun(initial: State): Promise<void> {
    this.calls.push({ op: "createRun", initial });
    if (this.state) {
      throw new Error("MockStateStore: createRun called twice");
    }
    this.state = structuredClone(initial);
  }

  async getState(): Promise<State | null> {
    this.calls.push({ op: "getState" });
    return this.state ? structuredClone(this.state) : null;
  }

  async updateLifecycle(patch: Partial<State["lifecycle"]>): Promise<void> {
    this.calls.push({ op: "updateLifecycle", patch });
    this.requireState("updateLifecycle");
    Object.assign(this.state!.lifecycle, patch);
  }

  async appendPhase(phase: PhaseEntry): Promise<void> {
    this.calls.push({ op: "appendPhase", phase });
    this.requireState("appendPhase");
    this.state!.phases.push(phase);
  }

  async updatePhase(
    name: string,
    attempt: number,
    patch: Partial<PhaseEntry>,
  ): Promise<void> {
    this.calls.push({ op: "updatePhase", name, attempt, patch });
    this.requireState("updatePhase");
    for (let i = this.state!.phases.length - 1; i >= 0; i--) {
      const p = this.state!.phases[i]!;
      if (p.name === name && p.attempt === attempt) {
        Object.assign(p, patch);
        return;
      }
    }
    throw new Error(
      `MockStateStore: no phase entry name="${name}" attempt=${attempt}`,
    );
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    this.calls.push({ op: "appendHistory", entry });
    this.requireState("appendHistory");
    this.state!.history.push(entry);
  }

  async setPendingQuestion(q: PendingQuestion | null): Promise<void> {
    this.calls.push({ op: "setPendingQuestion", q });
    this.requireState("setPendingQuestion");
    this.state!.pending_question = q;
  }

  async patchWorkflowState(patch: Record<string, unknown>): Promise<void> {
    this.calls.push({ op: "patchWorkflowState", patch });
    this.requireState("patchWorkflowState");
    Object.assign(this.state!.workflow_state, patch);
  }

  async setPhoenix(ref: { project: string; trace_id: string }): Promise<void> {
    this.calls.push({ op: "setPhoenix", ref });
    this.requireState("setPhoenix");
    this.state!.phoenix = ref;
  }

  // --- Convenience accessors ---

  phases(): PhaseEntry[] {
    return this.state?.phases ?? [];
  }

  history(): HistoryEntry[] {
    return this.state?.history ?? [];
  }

  /** Op names in call order. Common assertion shape: expect sequence of ops. */
  callNames(): StoreCall["op"][] {
    return this.calls.map((c) => c.op);
  }

  private requireState(op: string): void {
    if (!this.state) {
      throw new Error(
        `MockStateStore: ${op} called before createRun (or provide initial state in constructor)`,
      );
    }
  }
}
