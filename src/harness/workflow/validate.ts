import type { AgentProvider } from "../providers/types.js";
import type { NormalizedWorkflowDefinition, WorkflowNode, WorkflowPredicate } from "./schema.js";

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid workflow:\n- ${issues.join("\n- ")}`);
  }
}

export function validateWorkflow(
  workflow: NormalizedWorkflowDefinition,
  providers: ReadonlyMap<string, AgentProvider> = new Map(),
): void {
  const issues: string[] = [];
  const byId = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes) {
    if (byId.has(node.id)) issues.push(`duplicate node id: ${node.id}`);
    byId.set(node.id, node);
  }
  for (const node of workflow.nodes) {
    for (const dep of node.depends_on) if (!byId.has(dep)) issues.push(`${node.id} depends on unknown node ${dep}`);
    if (node.type === "human" && !node.timeout && !workflow.defaults.timeout) issues.push(`human node ${node.id} requires a timeout`);
    if (node.type === "command" && isInlineScript(node.command)) issues.push(`${node.id} uses an inline shell script; command nodes require direct argv`);
    if (node.type === "agent") validateProvider(node, workflow.defaults.provider, providers, issues);
    if (node.type === "foreach") validateForeach(node, workflow.defaults.timeout, workflow.defaults.provider, providers, issues);
    visitReferences(node, (id) => {
      if (!byId.has(id)) issues.push(`${node.id} references output of unknown node ${id}`);
      else if (id !== node.id && !dependsOn(node, id, byId)) issues.push(`${node.id} references ${id} without depending on it`);
    });
  }
  detectCycles(workflow.nodes, byId, issues);
  const outcomeType = workflow.outcome.type;
  const hasType = (type: WorkflowNode["type"]) => workflow.nodes.some((node) => node.type === type || (node.type === "foreach" && node.steps.some((step) => step.type === type)));
  if (outcomeType === "pull_request" && !hasType("pull_request")) issues.push("pull_request outcome is not reachable");
  if (outcomeType === "branch" && !hasType("commit")) issues.push("branch outcome is not reachable");
  if (issues.length) throw new WorkflowValidationError(issues);
}
function dependsOn(node: WorkflowNode, target: string, byId: Map<string, WorkflowNode>, seen = new Set<string>()): boolean { for (const id of node.depends_on) { if (id === target) return true; if (!seen.has(id)) { seen.add(id); const dep = byId.get(id); if (dep && dependsOn(dep, target, byId, seen)) return true; } } return false; }
function isInlineScript(command: string[]): boolean { const exe = command[0]?.split("/").at(-1); return ["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(exe ?? "") && command.some((arg) => arg === "-c" || arg === "-Command" || arg === "/c"); }

function validateForeach(node: Extract<WorkflowNode, { type: "foreach" }>, defaultTimeout: number | undefined, defaultProvider: string, providers: ReadonlyMap<string, AgentProvider>, issues: string[]) {
  const seen = new Set<string>();
  for (const step of node.steps) {
    if (seen.has(step.id)) issues.push(`${node.id} has duplicate step id ${step.id}`);
    for (const dep of step.depends_on) if (!seen.has(dep)) issues.push(`${node.id}.${step.id} depends on a step that is missing or not earlier: ${dep}`);
    if (step.retry?.return_to && !seen.has(step.retry.return_to)) issues.push(`${node.id}.${step.id} retry returns to a step that is missing or not earlier: ${step.retry.return_to}`);
    if (step.type === "human" && !step.timeout && !defaultTimeout) issues.push(`human step ${node.id}.${step.id} requires a timeout`);
    if (step.type === "command" && isInlineScript(step.command)) issues.push(`${node.id}.${step.id} uses an inline shell script; command steps require direct argv`);
    if (step.type === "agent") validateProvider(step, defaultProvider, providers, issues);
    seen.add(step.id);
  }
}

function validateProvider(node: Extract<WorkflowNode, { type: "agent" }>, fallback: string, providers: ReadonlyMap<string, AgentProvider>, issues: string[]) {
  if (!providers.size) return;
  const id = node.provider ?? fallback;
  const provider = providers.get(id);
  if (!provider) { issues.push(`${node.id} uses unknown provider ${id}`); return; }
  const mapping = { structured_output: "structuredOutput", resume: "resume", tool_guards: "toolGuards", interactive_questions: "interactiveQuestions" } as const;
  for (const requirement of node.requires) if (!provider.capabilities[mapping[requirement]]) issues.push(`${node.id} requires unsupported capability ${requirement} from ${id}`);
}

function detectCycles(nodes: WorkflowNode[], byId: Map<string, WorkflowNode>, issues: string[]) {
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of byId.get(id)?.depends_on ?? []) if (visit(dep)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  for (const node of nodes) if (visit(node.id)) { issues.push(`dependency cycle includes ${node.id}`); break; }
}

function visitReferences(value: unknown, found: (nodeId: string) => void): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\$\{\{\s*nodes\.([a-z][a-z0-9_-]*)\.outputs(?:\.[^}\s]+)?\s*}}/g)) found(match[1]!);
  } else if (Array.isArray(value)) value.forEach((item) => visitReferences(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => visitReferences(item, found));
}

export function evaluatePredicate(predicate: WorkflowPredicate): boolean {
  if ("equals" in predicate) return Object.is(...predicate.equals);
  if ("not" in predicate) return !evaluatePredicate(predicate.not);
  if ("all" in predicate) return predicate.all.every(evaluatePredicate);
  return predicate.any.some(evaluatePredicate);
}
