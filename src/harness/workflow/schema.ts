import { z } from "zod";

const RetrySchema = z.object({
  max_attempts: z.number().int().min(1).max(100),
  backoff_ms: z.number().int().nonnegative().optional(),
  return_to: z.string().optional(),
}).strict();

const PredicateSchema: z.ZodType<WorkflowPredicate> = z.lazy(() =>
  z.union([
    z.object({ equals: z.tuple([z.unknown(), z.unknown()]) }).strict(),
    z.object({ not: PredicateSchema }).strict(),
    z.object({ all: z.array(PredicateSchema).min(1) }).strict(),
    z.object({ any: z.array(PredicateSchema).min(1) }).strict(),
  ]),
);

export type WorkflowPredicate =
  | { equals: [unknown, unknown] }
  | { not: WorkflowPredicate }
  | { all: WorkflowPredicate[] }
  | { any: WorkflowPredicate[] };

const CommonNode = {
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  depends_on: z.array(z.string()).default([]),
  when: PredicateSchema.optional(),
  timeout: z.number().int().positive().optional(),
  retry: RetrySchema.optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  output_schema: z.record(z.string(), z.unknown()).optional(),
};

const AgentNodeSchema = z.object({
  ...CommonNode,
  type: z.literal("agent"),
  command: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
  guards: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  requires: z.array(z.enum(["structured_output", "resume", "tool_guards", "interactive_questions"])).default([]),
}).strict();
const CommandNodeSchema = z.object({ ...CommonNode, type: z.literal("command"), command: z.array(z.string()).min(1) }).strict();
const HumanNodeSchema = z.object({ ...CommonNode, type: z.literal("human"), question: z.string().min(1), fallback: z.string().optional() }).strict();
const CommitNodeSchema = z.object({ ...CommonNode, type: z.literal("commit"), message: z.string().min(1), changeset: z.string().min(1) }).strict();
const PullRequestNodeSchema = z.object({ ...CommonNode, type: z.literal("pull_request"), title: z.string().min(1), body: z.string().default(""), base: z.string().default("main"), head: z.string().min(1), draft: z.boolean().default(true), existing: z.enum(["allow", "require", "forbid"]).default("allow") }).strict();
const CancelNodeSchema = z.object({ ...CommonNode, type: z.literal("cancel"), reason: z.string().min(1) }).strict();

export const WorkflowStepSchema = z.discriminatedUnion("type", [
  AgentNodeSchema, CommandNodeSchema, HumanNodeSchema, CommitNodeSchema,
  PullRequestNodeSchema, CancelNodeSchema,
]);
const ForeachNodeSchema = z.object({
  ...CommonNode,
  type: z.literal("foreach"),
  items: z.union([z.array(z.unknown()), z.string().min(1)]),
  as: z.string().regex(/^[a-z][a-z0-9_]*$/),
  max_items: z.number().int().min(1).max(1000),
  steps: z.array(WorkflowStepSchema).min(1),
}).strict();

export const WorkflowNodeSchema = z.discriminatedUnion("type", [
  AgentNodeSchema, CommandNodeSchema, HumanNodeSchema, CommitNodeSchema,
  PullRequestNodeSchema, CancelNodeSchema, ForeachNodeSchema,
]);

export const WorkflowDefinitionSchema = z.object({
  version: z.literal(2),
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  defaults: z.object({ provider: z.string(), timeout: z.number().int().positive().optional() }).strict(),
  workspace: z.object({
    isolation: z.enum(["worktree", "inline"]),
    allow_paths: z.array(z.string().min(1)).default([]),
  }).strict(),
  outcome: z.object({ type: z.enum(["branch", "pull_request", "none"]) }).strict(),
  nodes: z.array(WorkflowNodeSchema).min(1),
}).strict();

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type NormalizedWorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
