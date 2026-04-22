/**
 * Probe 1 — Spawn surreal as detached subprocess + WS connection + basic CRUD.
 *
 * Validates the foundational lifecycle pattern that harness server (Mode B) will use:
 * boot → spawn surreal start → connect WS → CRUD → kill subprocess cleanly.
 *
 * SDK 2.x notes (gotchas):
 *   - select/create/update/delete take `Table` or `RecordId` instances, not raw strings.
 *   - `db.merge` is removed; the new pattern is `db.update(id).merge(data)` (fluent).
 *   - Result objects are class instances; use `.toJSON()` or destructure to inspect.
 *
 * Pass: 5/5 ops succeed, subprocess exits clean on stop().
 */

import { Table, RecordId } from "surrealdb";
import { startSurreal, log } from "./_helpers.js";

type Run = {
  workflow: string;
  prompt: string;
  status: "running" | "done" | "failed";
  started_at: string;
};

function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

async function main() {
  log("probe1", "starting surreal in-memory (quiet)");
  const h = await startSurreal({ storage: "memory", quiet: true });
  log("probe1", `surreal up on ${h.url}, ns=${h.namespace} db=${h.database}`);

  const RUN_TABLE = new Table("harness_run");
  let passes = 0;
  const fails: string[] = [];

  try {
    // CREATE — SDK 2.x fluent API: `.create(table).content(data)`
    // Passing data as 2nd arg silently no-ops (record gets created with only id).
    const created = await h.db.create<Run>(RUN_TABLE).content({
      workflow: "feature-dev",
      prompt: "Add a logger",
      status: "running",
      started_at: new Date().toISOString(),
    });
    if (Array.isArray(created) && created.length > 0) {
      passes++;
      log("probe1", "CREATE ok", { sample: plain(created[0]) });
    } else {
      fails.push(`CREATE returned unexpected: ${JSON.stringify(plain(created)).slice(0, 200)}`);
    }

    // SELECT all
    const all = await h.db.select<Run>(RUN_TABLE);
    if (Array.isArray(all) && all.length === 1) {
      passes++;
      log("probe1", `SELECT ok, ${all.length} row(s)`, { row: plain(all[0]) });
    } else {
      fails.push(`SELECT expected 1, got ${Array.isArray(all) ? all.length : "non-array"}`);
    }

    // QUERY (raw + parameterized) — and dump full row to verify all fields stored
    const dumpAll = await h.db.query<[unknown[]]>("SELECT * FROM harness_run");
    log("probe1", "raw SELECT * shows all fields (debug)", {
      rows: plain(dumpAll[0]),
    });

    const queryRes = await h.db.query<[Run[]]>(
      "SELECT * FROM harness_run WHERE workflow = $wf",
      { wf: "feature-dev" },
    );
    const firstResultSet = Array.isArray(queryRes) ? queryRes[0] : null;
    if (Array.isArray(firstResultSet) && firstResultSet.length === 1) {
      passes++;
      log("probe1", "parameterized QUERY ok");
    } else {
      fails.push(
        `parameterized QUERY unexpected shape: ${JSON.stringify(plain(queryRes)).slice(0, 200)}`,
      );
    }

    // UPDATE via fluent merge — `db.merge` was removed; new API is `db.update(id).merge(data)`
    const items = await h.db.select<Run & { id: RecordId }>(RUN_TABLE);
    const first = items[0];
    if (!first) throw new Error("no row to update");
    const updated = await h.db.update<Run>(first.id).merge({ status: "done" });
    const updatedRow = Array.isArray(updated) ? updated[0] : updated;
    if (updatedRow && (updatedRow as Run).status === "done") {
      passes++;
      log("probe1", "UPDATE.merge ok");
    } else {
      fails.push(`UPDATE: status not 'done', got ${JSON.stringify(plain(updated)).slice(0, 200)}`);
    }

    // DELETE
    await h.db.delete<Run>(first.id);
    const after = await h.db.select<Run>(RUN_TABLE);
    if (Array.isArray(after) && after.length === 0) {
      passes++;
      log("probe1", "DELETE ok");
    } else {
      fails.push(`DELETE: rows remain after delete: ${after.length}`);
    }
  } catch (e) {
    fails.push(`exception: ${(e as Error).message}`);
  } finally {
    await h.stop();
    log("probe1", "surreal stopped");
  }

  console.log(`\n=== Probe 1 result: ${passes}/5 passed ===`);
  if (fails.length) {
    console.log("Failures:");
    for (const f of fails) console.log("  -", f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
