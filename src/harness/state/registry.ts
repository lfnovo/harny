import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

const DB_PATH = join(homedir(), ".harness", "runs.db");

export type RunStatus = "running" | "waiting_human" | "done" | "failed";

export type Run = {
  id: string;
  workflow_id: string;
  cwd: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  pending_question_id: string | null;
  task_slug: string;
  branch: string;
  isolation: string | null;
  worktree_path: string | null;
};

export type RunEvent = {
  id?: number;
  run_id: string;
  phase: string;
  event_type: string;
  payload_json: string;
  at: string;
};

export type PendingQuestion = {
  id: string;
  run_id: string;
  kind: string;
  prompt: string;
  options_json: string | null;
  asked_at: string;
  answered_at: string | null;
  answer_json: string | null;
  /** SDK session_id of the phase that parked. NULL for legacy ctx.askUser parks. */
  phase_session_id: string | null;
  /** SDK tool_use_id of the AskUserQuestion call that triggered the park. */
  tool_use_id: string | null;
  /** Phase name that parked (so resumeFromAnswer knows which phase to re-invoke). */
  phase_name: string | null;
};

export class RunRegistry {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.migrate();
  }

  private migrate(): void {
    const rows = this.db.pragma("user_version") as { user_version: number }[];
    const version = rows[0]?.user_version ?? 0;
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT,
          cwd TEXT,
          status TEXT,
          started_at TEXT,
          ended_at TEXT,
          ended_reason TEXT,
          pending_question_id TEXT,
          task_slug TEXT,
          branch TEXT,
          isolation TEXT,
          worktree_path TEXT
        )
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS run_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT,
          phase TEXT,
          event_type TEXT,
          payload_json TEXT,
          at TEXT
        )
      `);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS pending_questions (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          kind TEXT,
          prompt TEXT,
          options_json TEXT,
          asked_at TEXT,
          answered_at TEXT,
          answer_json TEXT
        )
      `);
      this.db.pragma("user_version = 1");
    }
    if (version < 2) {
      // Tier 3b — async park for AskUserQuestion needs SDK session/tool/phase metadata.
      this.db.exec(`ALTER TABLE pending_questions ADD COLUMN phase_session_id TEXT`);
      this.db.exec(`ALTER TABLE pending_questions ADD COLUMN tool_use_id TEXT`);
      this.db.exec(`ALTER TABLE pending_questions ADD COLUMN phase_name TEXT`);
      this.db.pragma("user_version = 2");
    }
  }

  insertRun(run: {
    id: string;
    workflow_id: string;
    cwd: string;
    status: RunStatus;
    started_at: string;
    task_slug: string;
    branch: string;
    isolation?: string | null;
    worktree_path?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, workflow_id, cwd, status, started_at, task_slug, branch, isolation, worktree_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.workflow_id,
        run.cwd,
        run.status,
        run.started_at,
        run.task_slug,
        run.branch,
        run.isolation ?? null,
        run.worktree_path ?? null,
      );
  }

  updateRun(id: string, patch: Partial<Omit<Run, "id">>): void {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    const values = entries.map(([, v]) => (v === undefined ? null : v));
    this.db.prepare(`UPDATE runs SET ${sets} WHERE id = ?`).run(...values, id);
  }

  getRun(id: string): Run | null {
    return this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Run | null;
  }

  listRuns(opts: {
    status?: string;
    cwd?: string;
    workflow_id?: string;
    limit?: number;
  } = {}): Run[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) {
      conditions.push("status = ?");
      params.push(opts.status);
    }
    if (opts.cwd) {
      conditions.push("cwd = ?");
      params.push(opts.cwd);
    }
    if (opts.workflow_id) {
      conditions.push("workflow_id = ?");
      params.push(opts.workflow_id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(opts.limit ?? 50);
    return this.db
      .prepare(`SELECT * FROM runs ${where} ORDER BY started_at DESC LIMIT ?`)
      .all(...params) as Run[];
  }

  insertEvent(event: Omit<RunEvent, "id">): void {
    this.db
      .prepare(
        `INSERT INTO run_events (run_id, phase, event_type, payload_json, at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(event.run_id, event.phase, event.event_type, event.payload_json, event.at);
  }

  getEvents(runId: string, limit = 20): RunEvent[] {
    return this.db
      .prepare(
        "SELECT * FROM run_events WHERE run_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(runId, limit) as RunEvent[];
  }

  insertQuestion(q: {
    id: string;
    run_id: string;
    kind: string;
    prompt: string;
    options_json?: string | null;
    asked_at: string;
    phase_session_id?: string | null;
    tool_use_id?: string | null;
    phase_name?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO pending_questions (id, run_id, kind, prompt, options_json, asked_at, phase_session_id, tool_use_id, phase_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        q.id,
        q.run_id,
        q.kind,
        q.prompt,
        q.options_json ?? null,
        q.asked_at,
        q.phase_session_id ?? null,
        q.tool_use_id ?? null,
        q.phase_name ?? null,
      );
  }

  answerQuestion(id: string, answer: string): void {
    this.db
      .prepare(
        `UPDATE pending_questions SET answered_at = ?, answer_json = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), JSON.stringify(answer), id);
  }

  getQuestion(id: string): PendingQuestion | null {
    return this.db
      .prepare("SELECT * FROM pending_questions WHERE id = ?")
      .get(id) as PendingQuestion | null;
  }

  getPendingQuestion(runId: string): PendingQuestion | null {
    return this.db
      .prepare(
        "SELECT * FROM pending_questions WHERE run_id = ? AND answered_at IS NULL ORDER BY asked_at DESC LIMIT 1",
      )
      .get(runId) as PendingQuestion | null;
  }
}

let _registry: RunRegistry | null = null;
export function getRegistry(): RunRegistry {
  if (!_registry) _registry = new RunRegistry();
  return _registry;
}
