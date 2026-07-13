import type { WorkflowNode } from "./schema.js";
import { PauseWorkflowError, type NodeExecutor } from "./runtime.js";

export interface InteractionAdapter {
  mode: "interactive" | "async";
  ask(request: { question: string; signal: AbortSignal }): Promise<unknown>;
}

export function createHumanExecutor(adapter: InteractionAdapter, inheritedTimeout?: number): NodeExecutor {
  return async (node, { signal }) => {
    if (node.type !== "human") throw new Error("human executor received a non-human node");
    const timeout = node.timeout ?? inheritedTimeout;
    if (!timeout) throw new Error(`human node ${node.id} requires a timeout`);
    if (adapter.mode === "interactive") return await adapter.ask({ question: node.question, signal });
    const askedAt = new Date();
    throw new PauseWorkflowError({ nodeId: node.id, question: node.question, askedAt: askedAt.toISOString(), expiresAt: new Date(askedAt.getTime() + timeout).toISOString(), fallback: node.fallback });
  };
}

export function isHumanNode(node: WorkflowNode): node is Extract<WorkflowNode, { type: "human" }> { return node.type === "human"; }
