import type { Workflow } from "../workflow.js";
import type { WorkflowDefinition } from "../engine/types.js";
import { featureDev } from "./featureDev/index.js";
import { issueTriage } from "./issueTriage.js";
import { docs } from "./docs.js";
import echoCommit from "../engine/workflows/echoCommit.js";

const registry = new Map<string, Workflow | WorkflowDefinition<any>>([
  [featureDev.id, featureDev as Workflow],
  [issueTriage.id, issueTriage as Workflow],
  [docs.id, docs as Workflow],
  [echoCommit.id, echoCommit],
]);

export function isEngineWorkflow(
  w: Workflow | WorkflowDefinition<any>,
): w is WorkflowDefinition<any> {
  return "machine" in w && !("run" in w);
}

export function getWorkflow(id: string): Workflow | WorkflowDefinition<any> {
  const workflow = registry.get(id);
  if (!workflow) {
    const known = [...registry.keys()].join(", ");
    throw new Error(
      `Unknown workflow "${id}". Available workflows: ${known}`,
    );
  }
  return workflow;
}

export { registry };
