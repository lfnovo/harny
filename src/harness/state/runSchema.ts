import { z } from "zod";
import { WorkflowSnapshotSchema } from "../workflow/runtime.js";

export const PersistedChangeSetSchema = z.object({
  id: z.string(),
  base_sha: z.string(),
  entries: z.array(z.object({ path: z.string(), content_hash: z.string().nullable() })),
  validated_by: z.string().nullable(),
  committed_sha: z.string().nullable(),
});

export const RunSnapshotSchema = z.object({
  schema_version: z.literal(4),
  run: z.object({
    id: z.string(), task_slug: z.string(), workflow: z.string(),
    started_at: z.string(), ended_at: z.string().nullable(), ended_reason: z.string().nullable(),
    pid: z.number().int(), parent_run_id: z.string().nullable(),
  }),
  origin: z.object({ prompt: z.string(), workflow_source: z.string(), cwd: z.string(), host: z.string(), user: z.string() }),
  workspace: z.object({
    isolation: z.enum(["worktree", "inline"]), primary_cwd: z.string(), cwd: z.string(),
    branch: z.string(), worktree_path: z.string().nullable(), reserved: z.boolean(),
  }),
  inputs: z.record(z.string(), z.unknown()),
  execution: WorkflowSnapshotSchema,
  changesets: z.record(z.string(), PersistedChangeSetSchema),
});

export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;
export type RunEvent = { at: string; run_id: string; type: string; node_id?: string; data?: Record<string, unknown> };
