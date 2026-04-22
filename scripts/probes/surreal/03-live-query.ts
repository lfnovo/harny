/**
 * Probe 3 — LIVE SELECT DX in TypeScript.
 *
 * Subscriber connects, opens a live subscription on harness_run table.
 * Producer (separate connection on the same surreal instance) writes 5 records
 * with delays. Subscriber should receive 5 CREATE notifications.
 *
 * Also tests:
 *   - UPDATE notifications (merge a row, expect UPDATE action)
 *   - DELETE notifications
 *   - kill() cleanly stops the subscription
 *
 * Pass: 5 CREATE + 1 UPDATE + 1 DELETE notifications observed; kill works.
 */

import { Surreal, Table } from "surrealdb";
import { startSurreal, log } from "./_helpers.js";

async function main() {
  log("probe3", "starting surreal");
  const h = await startSurreal({ storage: "memory", quiet: true });

  const RUN_TABLE = new Table("harness_run");
  type Action = "CREATE" | "UPDATE" | "DELETE" | "KILLED";
  const events: { action: Action; at: number; recordId: string }[] = [];

  // Set up a SECOND connection for the subscriber (so we can prove it's not
  // intra-handle and that two clients see push notifications independently).
  const subscriber = new Surreal();
  await subscriber.connect(h.url);
  await subscriber.signin({ username: h.user, password: h.pass });
  await subscriber.use({ namespace: h.namespace, database: h.database });

  log("probe3", "subscriber connected; opening live subscription");
  const live = await subscriber.live(RUN_TABLE);

  const unsub = live.subscribe((msg) => {
    events.push({
      action: msg.action as Action,
      at: Date.now(),
      recordId: String(msg.recordId),
    });
    log("probe3", `event: action=${msg.action} record=${String(msg.recordId)}`);
  });

  // Producer writes via the original connection (h.db).
  await Bun.sleep(80); // make sure subscription is fully set up
  const t0 = Date.now();

  log("probe3", "producer writing 5 runs with 40ms gap");
  const ids: unknown[] = [];
  for (let i = 0; i < 5; i++) {
    const created = await h.db.create(RUN_TABLE).content({
      workflow: "feature-dev",
      prompt: `prompt ${i}`,
      task_slug: `slug-${i}`,
      cwd: "/tmp/test",
      status: "running",
      mode: "interactive",
      started_at: new Date(),
    });
    const row = Array.isArray(created) ? created[0] : created;
    if (row && (row as { id?: unknown }).id !== undefined) {
      ids.push((row as { id: unknown }).id);
    }
    await Bun.sleep(40);
  }

  // Update one record.
  if (ids[0]) {
    await h.db.update(ids[0] as never).merge({ status: "done" });
    await Bun.sleep(80);
  }

  // Delete one record.
  if (ids[1]) {
    await h.db.delete(ids[1] as never);
    await Bun.sleep(80);
  }

  // Wait for any in-flight events.
  await Bun.sleep(200);

  // Kill the subscription.
  await live.kill();
  unsub();
  log("probe3", "live.kill() called");

  // Counter-test: writing AFTER kill should not produce events.
  await h.db.create(RUN_TABLE).content({
    workflow: "feature-dev",
    prompt: "post-kill",
    task_slug: "post-kill",
    cwd: "/tmp/test",
    status: "running",
    mode: "interactive",
    started_at: new Date(),
  });
  await Bun.sleep(150);

  await subscriber.close();
  await h.stop();

  // Tally.
  const creates = events.filter((e) => e.action === "CREATE").length;
  const updates = events.filter((e) => e.action === "UPDATE").length;
  const deletes = events.filter((e) => e.action === "DELETE").length;

  // Latency from first write to first event.
  const firstEvent = events[0];
  const latency = firstEvent ? firstEvent.at - t0 : -1;

  let passes = 0;
  const fails: string[] = [];
  if (creates === 5) passes++;
  else fails.push(`expected 5 CREATE events, got ${creates}`);
  if (updates === 1) passes++;
  else fails.push(`expected 1 UPDATE event, got ${updates}`);
  if (deletes === 1) passes++;
  else fails.push(`expected 1 DELETE event, got ${deletes}`);
  if (events.length === 7) passes++;
  else fails.push(`expected 7 total events (no post-kill leak), got ${events.length}`);

  log(
    "probe3",
    `tally: creates=${creates} updates=${updates} deletes=${deletes} total=${events.length} firstLatencyMs=${latency}`,
  );

  console.log(`\n=== Probe 3 result: ${passes}/4 passed ===`);
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
