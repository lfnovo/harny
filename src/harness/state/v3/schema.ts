import { z } from "zod";

export const ArtifactV3Schema = z.object({ id: z.string(), type: z.string(), created_at: z.string(), producer: z.string(), value: z.unknown() });
export const ChangeSetV3Schema = z.object({ id: z.string(), base_sha: z.string(), entries: z.array(z.object({ path: z.string(), content_hash: z.string().nullable() })), validated_by: z.string().nullable(), committed_sha: z.string().nullable() });
export const NodeAttemptV3Schema = z.object({ number: z.number().int().positive(), status: z.enum(["running", "completed", "failed", "paused"]), started_at: z.string(), ended_at: z.string().nullable(), session: z.object({ provider: z.string(), id: z.string() }).nullable(), error: z.string().nullable() });
export const NodeInstanceV3Schema = z.object({ id: z.string(), type: z.string(), status: z.enum(["pending", "running", "completed", "skipped", "failed", "paused", "cancelled"]), attempts: z.array(NodeAttemptV3Schema), output_artifacts: z.array(z.string()), error: z.string().nullable() });
export const PendingHumanV3Schema = z.object({ node_id: z.string(), question: z.string(), options: z.array(z.unknown()).nullable(), asked_at: z.string(), expires_at: z.string(), session: z.object({ provider: z.string(), id: z.string() }).nullable(), fallback: z.string().nullable() });

export const RunV3Schema = z.object({
  schema_version: z.literal(3),
  run: z.object({ id: z.string(), task_slug: z.string(), workflow: z.string(), status: z.enum(["running", "paused", "done", "failed", "cancelled"]), started_at: z.string(), ended_at: z.string().nullable(), ended_reason: z.string().nullable(), pid: z.number().int(), parent_run_id: z.string().nullable() }),
  origin: z.object({ prompt: z.string(), workflow_source: z.string(), cwd: z.string(), host: z.string(), user: z.string() }),
  workspace: z.object({ isolation: z.enum(["worktree", "inline"]), primary_cwd: z.string(), cwd: z.string(), branch: z.string(), worktree_path: z.string().nullable(), reserved: z.boolean() }),
  nodes: z.record(z.string(), NodeInstanceV3Schema),
  artifacts: z.record(z.string(), ArtifactV3Schema),
  changesets: z.record(z.string(), ChangeSetV3Schema),
  deliverables: z.array(z.string()),
  pending_human: PendingHumanV3Schema.nullable(),
});

export type RunV3 = z.infer<typeof RunV3Schema>;
export type RunEventV3 = { at: string; run_id: string; type: string; node_id?: string; data?: Record<string, unknown> };
