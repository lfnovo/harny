import { z } from "zod";

export const PhoenixRefSchema = z.object({
  project: z.string(),
  trace_id: z.string(),
});

export const PhaseEntrySchema = z.object({
  name: z.string(),
  attempt: z.number().int().min(1),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  status: z.enum(["running", "completed", "failed", "parked"]),
  verdict: z.string().nullable(),
  session_id: z.string().nullable(),
});

export const HistoryEntrySchema = z
  .object({
    at: z.string(),
    phase: z.string(),
    event: z.string(),
  })
  .passthrough();

export const PendingQuestionSchema = z.object({
  id: z.string(),
  kind: z.enum(["user_input", "ask_user_question_batch"]),
  prompt: z.string(),
  /**
   * For kind="user_input": array of string option labels (or null for free-form).
   * For kind="ask_user_question_batch": array of SDK AskUserQuestion question
   * objects ({question, options: string[]}). Stored opaque; consumers cast.
   */
  options: z.array(z.unknown()).nullable(),
  asked_at: z.string(),
  phase_session_id: z.string().nullable(),
  tool_use_id: z.string().nullable(),
  phase_name: z.string().nullable(),
});

export const StateSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.string(),
  origin: z.object({
    prompt: z.string(),
    workflow: z.string(),
    task_slug: z.string(),
    started_at: z.string(),
    host: z.string(),
    user: z.string(),
  }),
  environment: z.object({
    cwd: z.string(),
    branch: z.string(),
    isolation: z.enum(["worktree", "inline"]),
    worktree_path: z.string().nullable(),
    mode: z.enum(["interactive", "silent", "async"]),
  }),
  lifecycle: z.object({
    status: z.enum(["running", "waiting_human", "done", "failed"]),
    current_phase: z.string().nullable(),
    ended_at: z.string().nullable(),
    ended_reason: z.string().nullable(),
    pid: z.number().int(),
  }),
  phases: z.array(PhaseEntrySchema),
  history: z.array(HistoryEntrySchema),
  pending_question: PendingQuestionSchema.nullable(),
  workflow_state: z.record(z.string(), z.unknown()),
  /** Top-level Phoenix link — single trace per harness run, all phases live
   *  inside it as child spans. Absent when Phoenix observability isn't
   *  enabled. On resume, may be overwritten with the resume invocation's
   *  trace; the original trace remains queryable in Phoenix by harness.run_id. */
  phoenix: PhoenixRefSchema.optional(),
});

export type State = z.infer<typeof StateSchema>;
export type PhaseEntry = z.infer<typeof PhaseEntrySchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type PendingQuestion = z.infer<typeof PendingQuestionSchema>;
export type PhoenixRef = z.infer<typeof PhoenixRefSchema>;
