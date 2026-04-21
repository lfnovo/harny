import type { Workflow } from "../workflow.js";
import { featureDev } from "./featureDev/index.js";
import { issueTriage } from "./issueTriage.js";
import { docs } from "./docs.js";

const registry = new Map<string, Workflow>([
  [featureDev.id, featureDev as Workflow],
  [issueTriage.id, issueTriage as Workflow],
  [docs.id, docs as Workflow],
]);

export function getWorkflow(id: string): Workflow {
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
