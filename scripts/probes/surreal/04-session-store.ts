/**
 * Probe 4 — SurrealSessionStore conformance + integration with Claude SDK.
 *
 * Two parts:
 *   A. Conformance — direct exercise of the SessionStore contract from the
 *      docs (without spinning up the SDK). Mirrors the Python conformance
 *      suite shape per the docs.
 *   B. Integration — runs an actual `query()` against Anthropic API with
 *      sessionStore set, captures the resulting session.
 *
 * Part B requires ANTHROPIC_API_KEY in env. If absent, B is skipped with a
 * note (not a failure).
 */

import { startSurreal, log } from "./_helpers.js";
import { SurrealSessionStore, SCHEMA } from "./SurrealSessionStore.js";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";

// Deep-equal that ignores object key order (SDK contract: "deep-equal,
// byte-equal NOT required — Postgres JSONB reorders keys").
function eq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => eq(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length) return false;
  if (!ak.every((k, i) => k === bk[i])) return false;
  return ak.every((k) => eq(ao[k], bo[k]));
}

async function conformance() {
  log("probe4.A", "conformance suite starting");
  const h = await startSurreal({ storage: "memory", quiet: true });
  await h.db.query(SCHEMA);
  const store = new SurrealSessionStore(h.db);
  let passes = 0;
  const fails: string[] = [];

  const pk = "-tmp-conformance";
  const sid1 = "session-aaa";
  const sid2 = "session-bbb";

  try {
    // 1. load() on unknown key returns null.
    const empty = await store.load({ projectKey: pk, sessionId: sid1 });
    if (empty === null) {
      passes++;
      log("probe4.A", "1/8 load on missing key returns null");
    } else {
      fails.push("1: expected null on missing key");
    }

    // 2. append + load roundtrip preserves order and content.
    const batch1: SessionStoreEntry[] = [
      { type: "user", uuid: "u1", text: "hello" },
      { type: "assistant", uuid: "a1", text: "hi" },
      { type: "tool_use", uuid: "t1", name: "Read", input: { path: "/foo" } },
    ];
    await store.append({ projectKey: pk, sessionId: sid1 }, batch1);
    const loaded1 = await store.load({ projectKey: pk, sessionId: sid1 });
    if (loaded1 && eq(loaded1, batch1)) {
      passes++;
      log("probe4.A", "2/8 single-batch roundtrip ok");
    } else {
      fails.push(`2: roundtrip mismatch. got=${JSON.stringify(loaded1)}`);
    }

    // 3. multi-batch append preserves overall order.
    const batch2: SessionStoreEntry[] = [
      { type: "tool_result", uuid: "r1", content: "ok" },
      { type: "assistant", uuid: "a2", text: "done" },
    ];
    await store.append({ projectKey: pk, sessionId: sid1 }, batch2);
    const loaded2 = await store.load({ projectKey: pk, sessionId: sid1 });
    const expected2 = [...batch1, ...batch2];
    if (loaded2 && eq(loaded2, expected2)) {
      passes++;
      log("probe4.A", `3/8 multi-batch order preserved (${loaded2.length} entries)`);
    } else {
      fails.push(`3: multi-batch order mismatch. got=${JSON.stringify(loaded2).slice(0, 200)}`);
    }

    // 4. distinct sessions are isolated.
    await store.append({ projectKey: pk, sessionId: sid2 }, [
      { type: "user", uuid: "u9", text: "different session" },
    ]);
    const sid1Now = await store.load({ projectKey: pk, sessionId: sid1 });
    const sid2Now = await store.load({ projectKey: pk, sessionId: sid2 });
    if (sid1Now?.length === 5 && sid2Now?.length === 1) {
      passes++;
      log("probe4.A", "4/8 sessions isolated by sessionId");
    } else {
      fails.push(
        `4: isolation broken. sid1=${sid1Now?.length} sid2=${sid2Now?.length}`,
      );
    }

    // 5. subpath isolation — subagent transcripts.
    const subBatch: SessionStoreEntry[] = [
      { type: "subagent_user", uuid: "su1", text: "subagent prompt" },
    ];
    await store.append(
      { projectKey: pk, sessionId: sid1, subpath: "subagents/agent-foo" },
      subBatch,
    );
    const mainAfterSub = await store.load({ projectKey: pk, sessionId: sid1 });
    const subOnly = await store.load({
      projectKey: pk,
      sessionId: sid1,
      subpath: "subagents/agent-foo",
    });
    if (mainAfterSub?.length === 5 && subOnly?.length === 1 && eq(subOnly, subBatch)) {
      passes++;
      log("probe4.A", "5/8 subpath isolated from main transcript");
    } else {
      fails.push(
        `5: subpath isolation. main=${mainAfterSub?.length} sub=${subOnly?.length}`,
      );
    }

    // 6. listSessions returns the project's sessions with mtimes.
    const sessions = await store.listSessions(pk);
    log("probe4.A", "listSessions debug", { raw: sessions });
    const ids = sessions.map((s) => s.sessionId).sort();
    if (ids.length === 2 && ids[0] === sid1 && ids[1] === sid2) {
      const mtimesValid = sessions.every(
        (s) => Number.isFinite(s.mtime) && s.mtime > 0,
      );
      if (mtimesValid) {
        passes++;
        log("probe4.A", "6/8 listSessions returns both with valid mtimes");
      } else {
        fails.push(`6: mtimes not valid: ${JSON.stringify(sessions)}`);
      }
    } else {
      fails.push(`6: listSessions ids=${JSON.stringify(ids)}`);
    }

    // 7. listSubkeys finds the subagent.
    const subkeys = await store.listSubkeys({ projectKey: pk, sessionId: sid1 });
    if (subkeys.length === 1 && subkeys[0] === "subagents/agent-foo") {
      passes++;
      log("probe4.A", "7/8 listSubkeys returns subagent path");
    } else {
      fails.push(`7: listSubkeys returned ${JSON.stringify(subkeys)}`);
    }

    // 8. delete cascades from main key to subpaths.
    await store.delete({ projectKey: pk, sessionId: sid1 });
    const afterDelMain = await store.load({ projectKey: pk, sessionId: sid1 });
    const afterDelSub = await store.load({
      projectKey: pk,
      sessionId: sid1,
      subpath: "subagents/agent-foo",
    });
    const sid2Survives = await store.load({ projectKey: pk, sessionId: sid2 });
    if (afterDelMain === null && afterDelSub === null && sid2Survives?.length === 1) {
      passes++;
      log("probe4.A", "8/8 delete cascades main+subpaths, leaves sibling sessions");
    } else {
      fails.push(
        `8: delete cascade. main=${afterDelMain} sub=${afterDelSub} sid2=${sid2Survives?.length}`,
      );
    }
  } finally {
    await h.stop();
  }

  log("probe4.A", `conformance ${passes}/8`);
  return { passes, fails, total: 8 };
}

async function integration() {
  log("probe4.B", "integration starting (uses local Claude Code auth)");

  const h = await startSurreal({ storage: "memory", quiet: true });
  await h.db.query(SCHEMA);
  const store = new SurrealSessionStore(h.db);
  let passes = 0;
  const fails: string[] = [];

  try {
    let sessionId: string | undefined;
    log("probe4.B", "calling Anthropic SDK with sessionStore = SurrealSessionStore");
    for await (const message of query({
      prompt: "Reply with the single word 'ok'.",
      options: {
        model: "claude-haiku-4-5-20251001",
        sessionStore: store,
        maxTurns: 1,
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }
      if (message.type === "result") {
        log("probe4.B", `query done: subtype=${message.subtype} session=${message.session_id}`);
      }
    }

    if (!sessionId) {
      fails.push("no sessionId observed");
      return { passes, fails, total: 1, skipped: false };
    }

    // Did the store get any rows?
    const projects = await store.listSessions(sessionId.split("-")[0] ?? "");
    log("probe4.B", `listSessions sample: ${JSON.stringify(projects).slice(0, 200)}`);

    // Try to find the session under any projectKey.
    const allRows = await h.db.query<[{ project_key: string; count: number }[]]>(
      `SELECT project_key, count() as count FROM harness_session_entry GROUP BY project_key`,
    );
    log("probe4.B", `entries grouped by projectKey: ${JSON.stringify(allRows[0])}`);

    // The SDK chooses the projectKey; just confirm SOME entries landed.
    const totalEntries = (await h.db.query<[{ c: number }[]]>(
      `SELECT count() AS c FROM harness_session_entry GROUP ALL`,
    ))[0]?.[0]?.c ?? 0;

    if (totalEntries > 0) {
      passes++;
      log("probe4.B", `1/1 SDK appended ${totalEntries} transcript entries to Surreal`);
    } else {
      fails.push("no entries appended to Surreal store via SDK");
    }
  } catch (e) {
    fails.push(`exception: ${(e as Error).message}`);
  } finally {
    await h.stop();
  }

  return { passes, fails, total: 1 };
}

async function main() {
  const a = await conformance();
  const b = await integration();

  const totalPasses = a.passes + b.passes;
  const totalChecks = a.total + b.total;
  const allFails = [...a.fails, ...b.fails];

  console.log(`\n=== Probe 4 result: ${totalPasses}/${totalChecks} passed ===`);
  console.log(`  conformance: ${a.passes}/${a.total}`);
  console.log(`  integration: ${b.passes}/${b.total}`);
  if (allFails.length) {
    console.log("Failures:");
    for (const f of allFails) console.log("  -", f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
