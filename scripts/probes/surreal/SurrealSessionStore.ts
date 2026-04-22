/**
 * SurrealSessionStore — implements the Claude Agent SDK SessionStore interface
 * against a SurrealDB instance. Probe-quality (no migrations, no retries beyond
 * what the SDK already does, no auth pooling). Production version belongs in
 * packages/core/src/state.
 *
 * Schema:
 *   harness_session_entry:
 *     project_key  string
 *     session_id   string
 *     subpath      option<string>      // null for main transcript
 *     batch_id     string              // unique per append() call (timestamp + random)
 *     entry_idx    int                 // 0-based position within the batch
 *     entry        object              // the raw SessionStoreEntry POJO
 *     at           datetime            // server insert time
 *
 *   Order on load: ORDER BY batch_id ASC, entry_idx ASC
 *   This preserves "append-call order within a process; commit-time across
 *   processes" per the SDK contract.
 */

import type {
  SessionStore,
  SessionKey,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { Surreal, Table } from "surrealdb";

const TABLE = new Table("harness_session_entry");

export const SCHEMA = /* surql */ `
  DEFINE TABLE OVERWRITE harness_session_entry SCHEMAFULL;
  DEFINE FIELD OVERWRITE project_key ON harness_session_entry TYPE string;
  DEFINE FIELD OVERWRITE session_id ON harness_session_entry TYPE string;
  DEFINE FIELD OVERWRITE subpath ON harness_session_entry TYPE option<string>;
  DEFINE FIELD OVERWRITE batch_id ON harness_session_entry TYPE string;
  DEFINE FIELD OVERWRITE entry_idx ON harness_session_entry TYPE int;
  DEFINE FIELD OVERWRITE entry ON harness_session_entry FLEXIBLE TYPE object;
  DEFINE FIELD OVERWRITE at ON harness_session_entry TYPE datetime;
  DEFINE INDEX OVERWRITE entry_lookup ON harness_session_entry
    COLUMNS project_key, session_id, subpath, batch_id, entry_idx;
`;

export class SurrealSessionStore implements SessionStore {
  constructor(private db: Surreal) {}

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const batchId = `${Date.now().toString().padStart(16, "0")}_${crypto.randomUUID()}`;
    const rows = entries.map((entry, idx) => {
      // SurrealDB option<string> wants the field omitted (NONE), not JS null.
      const row: Record<string, unknown> = {
        project_key: key.projectKey,
        session_id: key.sessionId,
        batch_id: batchId,
        entry_idx: idx,
        entry,
        at: new Date(),
      };
      if (key.subpath !== undefined) row.subpath = key.subpath;
      return row;
    });
    await this.db.insert(TABLE, rows);
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const subpathClause = key.subpath === undefined ? "subpath IS NONE" : "subpath = $sp";
    // SurrealQL requires ORDER BY columns to be in the SELECT list.
    const sql = `
      SELECT entry, batch_id, entry_idx FROM harness_session_entry
      WHERE project_key = $pk AND session_id = $sid AND (${subpathClause})
      ORDER BY batch_id ASC, entry_idx ASC
    `;
    const params: Record<string, unknown> = {
      pk: key.projectKey,
      sid: key.sessionId,
    };
    if (key.subpath !== undefined) params.sp = key.subpath;

    const res = await this.db.query<[{ entry: SessionStoreEntry }[]]>(sql, params);
    const rows = res[0];
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.map((r) => r.entry);
  }

  async listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    // SurrealDB aggregates on datetime via math::max return a Date instance
    // (not a string). Wrap in time::max for explicit datetime aggregation,
    // and project at_arr to ensure we collect non-aggregated rows correctly.
    const res = await this.db.query<
      [{ session_id: string; latest: Date | string }[]]
    >(
      `
        SELECT session_id, time::max(at) AS latest
        FROM harness_session_entry
        WHERE project_key = $pk
        GROUP BY session_id
      `,
      { pk: projectKey },
    );
    const rows = res[0] ?? [];
    return rows.map((r) => {
      const t =
        r.latest instanceof Date ? r.latest.getTime() : new Date(r.latest).getTime();
      return { sessionId: r.session_id, mtime: t };
    });
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath === undefined) {
      // Cascade: delete main + all subpaths for this session.
      await this.db.query(
        `DELETE harness_session_entry WHERE project_key = $pk AND session_id = $sid`,
        { pk: key.projectKey, sid: key.sessionId },
      );
    } else {
      await this.db.query(
        `DELETE harness_session_entry WHERE project_key = $pk AND session_id = $sid AND subpath = $sp`,
        { pk: key.projectKey, sid: key.sessionId, sp: key.subpath },
      );
    }
  }

  async listSubkeys(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    const res = await this.db.query<[{ subpath: string | null }[]]>(
      `
        SELECT subpath FROM harness_session_entry
        WHERE project_key = $pk AND session_id = $sid AND subpath != NULL
        GROUP BY subpath
      `,
      { pk: key.projectKey, sid: key.sessionId },
    );
    return (res[0] ?? [])
      .map((r) => r.subpath)
      .filter((s): s is string => typeof s === "string");
  }
}
