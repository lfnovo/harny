import type { Workflow } from "../workflow.js";
import type { WorkflowDefinition } from "../engine/types.js";
import { featureDev } from "./featureDev/index.js";
import echoCommit from "../engine/workflows/echoCommit.js";
import featureDevEngine from "../engine/workflows/featureDev.js";
import auto from "../engine/workflows/auto.js";

const registry = new Map<string, Workflow | WorkflowDefinition<any>>([
  [featureDev.id, featureDev as Workflow],
  [echoCommit.id, echoCommit],
  [featureDevEngine.id, featureDevEngine],
  [auto.id, auto],
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
