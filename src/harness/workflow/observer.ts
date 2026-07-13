export interface WorkflowEvent {
  type: "node.started" | "node.completed" | "node.failed" | "node.paused" | "node.cancelled" | "run.finished";
  workflow: string;
  nodeId?: string;
  at: string;
  data?: Record<string, unknown>;
}

/** Optional side-channel; persisted state remains authoritative. */
export interface Observer {
  observe(event: WorkflowEvent): void | Promise<void>;
}

export const noopObserver: Observer = { observe() {} };
