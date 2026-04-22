/**
 * Probe 2 — SurrealQL schema for harness state.
 *
 * Defines the tables we'd actually use (harness_run, harness_phase, harness_pending_question)
 * with DEFINE TABLE / DEFINE FIELD typing. Validates:
 *   - DEFINE OVERWRITE for idempotent re-run (key for migrations on every server boot)
 *   - Type enforcement (try inserting bad data, expect rejection)
 *   - Relations: phase belongs to a run via record link
 *
 * Pass: schema applies cleanly on first and second run; type enforcement rejects bad input.
 */

import { Table, RecordId } from "surrealdb";
import { startSurreal, log } from "./_helpers.js";

const SCHEMA = /* surql */ `
  DEFINE TABLE OVERWRITE harness_run SCHEMAFULL;
  DEFINE FIELD OVERWRITE workflow ON harness_run TYPE string;
  DEFINE FIELD OVERWRITE prompt ON harness_run TYPE string;
  DEFINE FIELD OVERWRITE task_slug ON harness_run TYPE string;
  DEFINE FIELD OVERWRITE cwd ON harness_run TYPE string;
  DEFINE FIELD OVERWRITE status ON harness_run TYPE string
    ASSERT $value IN ["running", "waiting_human", "done", "failed"];
  DEFINE FIELD OVERWRITE mode ON harness_run TYPE string
    ASSERT $value IN ["interactive", "silent", "async"];
  DEFINE FIELD OVERWRITE started_at ON harness_run TYPE datetime;
  DEFINE FIELD OVERWRITE ended_at ON harness_run TYPE option<datetime>;
  DEFINE FIELD OVERWRITE pid ON harness_run TYPE option<int>;
  DEFINE FIELD OVERWRITE host ON harness_run TYPE option<string>;
  DEFINE INDEX OVERWRITE run_status ON harness_run COLUMNS status;
  DEFINE INDEX OVERWRITE run_cwd ON harness_run COLUMNS cwd;

  DEFINE TABLE OVERWRITE harness_phase SCHEMAFULL;
  DEFINE FIELD OVERWRITE run ON harness_phase TYPE record<harness_run>;
  DEFINE FIELD OVERWRITE name ON harness_phase TYPE string;
  DEFINE FIELD OVERWRITE attempt ON harness_phase TYPE int;
  DEFINE FIELD OVERWRITE status ON harness_phase TYPE string
    ASSERT $value IN ["running", "completed", "failed", "parked"];
  DEFINE FIELD OVERWRITE session_id ON harness_phase TYPE option<string>;
  DEFINE FIELD OVERWRITE verdict ON harness_phase TYPE option<string>;
  DEFINE FIELD OVERWRITE started_at ON harness_phase TYPE datetime;
  DEFINE FIELD OVERWRITE ended_at ON harness_phase TYPE option<datetime>;

  DEFINE TABLE OVERWRITE harness_pending_question SCHEMAFULL;
  DEFINE FIELD OVERWRITE run ON harness_pending_question TYPE record<harness_run>;
  DEFINE FIELD OVERWRITE kind ON harness_pending_question TYPE string;
  DEFINE FIELD OVERWRITE prompt ON harness_pending_question TYPE string;
  DEFINE FIELD OVERWRITE options_json ON harness_pending_question TYPE option<string>;
  DEFINE FIELD OVERWRITE phase_session_id ON harness_pending_question TYPE option<string>;
  DEFINE FIELD OVERWRITE tool_use_id ON harness_pending_question TYPE option<string>;
  DEFINE FIELD OVERWRITE phase_name ON harness_pending_question TYPE option<string>;
  DEFINE FIELD OVERWRITE asked_at ON harness_pending_question TYPE datetime;
  DEFINE FIELD OVERWRITE answered_at ON harness_pending_question TYPE option<datetime>;
  DEFINE FIELD OVERWRITE answer_json ON harness_pending_question TYPE option<string>;
`;

async function main() {
  log("probe2", "starting surreal in-memory");
  const h = await startSurreal({ storage: "memory", quiet: true });
  let passes = 0;
  const fails: string[] = [];

  try {
    // Apply schema (round 1 — fresh DB).
    await h.db.query(SCHEMA);
    passes++;
    log("probe2", "schema applied (1st time) ok");

    // Apply schema (round 2 — idempotent re-run via DEFINE OVERWRITE).
    await h.db.query(SCHEMA);
    passes++;
    log("probe2", "schema applied (2nd time) ok — DEFINE OVERWRITE idempotent");

    // Insert a valid run + phase, exercising the record-link reference.
    const RUN_TABLE = new Table("harness_run");
    const PHASE_TABLE = new Table("harness_phase");
    const created = await h.db.create<{ id: RecordId }>(RUN_TABLE).content({
      workflow: "feature-dev",
      prompt: "Test schema",
      task_slug: "schema-probe",
      cwd: "/tmp/test",
      status: "running",
      mode: "interactive",
      started_at: new Date(),
    });
    const runRow = Array.isArray(created) ? created[0] : created;
    if (!runRow) throw new Error("run create failed");
    const runId = runRow.id;
    log("probe2", `run created: ${runId}`);

    const phase = await h.db.create<{ id: RecordId }>(PHASE_TABLE).content({
      run: runId,
      name: "planner",
      attempt: 1,
      status: "running",
      started_at: new Date(),
    });
    const phaseRow = Array.isArray(phase) ? phase[0] : phase;
    if (phaseRow?.id) {
      passes++;
      log("probe2", `phase with record-link created: ${phaseRow.id}`);
    } else {
      fails.push("phase create returned empty");
    }

    // Type enforcement — bad status should be rejected.
    let rejected = false;
    try {
      await h.db.create(RUN_TABLE).content({
        workflow: "feature-dev",
        prompt: "bad status",
        task_slug: "bad",
        cwd: "/tmp/test",
        status: "wrong-value", // not in ASSERT list
        mode: "interactive",
        started_at: new Date(),
      });
    } catch (e) {
      rejected = true;
      log("probe2", `bad status rejected as expected: ${(e as Error).message.slice(0, 120)}`);
    }
    if (rejected) {
      passes++;
    } else {
      fails.push("expected ASSERT to reject 'wrong-value' status, but insert succeeded");
    }

    // Graph-style traversal — fetch phases for our run.
    const phaseQuery = await h.db.query<[unknown[]]>(
      "SELECT * FROM harness_phase WHERE run = $r",
      { r: runId },
    );
    const phases = phaseQuery[0];
    if (Array.isArray(phases) && phases.length === 1) {
      passes++;
      log("probe2", `record-link query ok, ${phases.length} phase(s) for run`);
    } else {
      fails.push(
        `record-link query returned ${Array.isArray(phases) ? phases.length : "non-array"}`,
      );
    }
  } catch (e) {
    fails.push(`exception: ${(e as Error).message}`);
  } finally {
    await h.stop();
  }

  console.log(`\n=== Probe 2 result: ${passes}/5 passed ===`);
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
