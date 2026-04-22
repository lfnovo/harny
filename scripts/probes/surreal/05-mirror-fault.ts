/**
 * Probe 5 — mirror_error fault injection.
 *
 * Confirms the SDK contract that SessionStore mirroring is best-effort:
 *   - If `append()` rejects, the SDK emits `{type:"system", subtype:"mirror_error"}`
 *     into the stream and continues.
 *   - The query completes successfully.
 *   - The local JSONL transcript is intact (durability is local-first).
 *
 * Approach: wrap SurrealSessionStore so we kill the underlying surreal mid-stream
 * and the next append() rejects. Observe the iterator and final state.
 *
 * Pass:
 *   - At least one mirror_error event observed.
 *   - Query terminates with subtype=success.
 *   - Local SDK session file exists with > 0 lines.
 */

import { startSurreal, log } from "./_helpers.js";
import { SurrealSessionStore, SCHEMA } from "./SurrealSessionStore.js";
import type {
  SessionStore,
  SessionKey,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

class FaultyStore implements SessionStore {
  appendCalls = 0;
  inner: SurrealSessionStore;
  killAfter: number;
  onKill: () => Promise<void>;

  constructor(inner: SurrealSessionStore, killAfter: number, onKill: () => Promise<void>) {
    this.inner = inner;
    this.killAfter = killAfter;
    this.onKill = onKill;
  }

  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    this.appendCalls++;
    if (this.appendCalls === this.killAfter) {
      log("probe5", `killing surreal before append #${this.appendCalls}`);
      await this.onKill();
      // Give the WS some time to actually close.
      await Bun.sleep(200);
    }
    return this.inner.append(key, entries);
  }
  load = async (k: SessionKey) => this.inner.load(k);
  listSessions = async (pk: string) => this.inner.listSessions(pk);
  delete = async (k: SessionKey) => this.inner.delete(k);
  listSubkeys = async (k: { projectKey: string; sessionId: string }) =>
    this.inner.listSubkeys(k);
}

async function main() {
  log("probe5", "starting surreal in-memory");
  const h = await startSurreal({ storage: "memory", quiet: true });
  await h.db.query(SCHEMA);
  const inner = new SurrealSessionStore(h.db);

  // Kill surreal after the 2nd append batch — early enough that more batches
  // are likely (SDK batches at ~100ms cadence) but late enough to confirm
  // some mirror writes succeeded first.
  let killed = false;
  const store = new FaultyStore(inner, 2, async () => {
    if (killed) return;
    killed = true;
    h.proc.kill();
    await h.proc.exited;
  });

  let mirrorErrors = 0;
  let resultSubtype: string | undefined;
  let sessionId: string | undefined;
  let exception: string | undefined;

  try {
    log("probe5", "running query() with FaultyStore");
    for await (const message of query({
      prompt: "Reply with three sentences about why durability matters.",
      options: {
        model: "claude-haiku-4-5-20251001",
        sessionStore: store,
        maxTurns: 1,
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }
      if (
        message.type === "system" &&
        // @ts-expect-error — mirror_error is a runtime subtype not in the public union
        message.subtype === "mirror_error"
      ) {
        mirrorErrors++;
        log("probe5", `mirror_error received (count=${mirrorErrors})`);
      }
      if (message.type === "result") {
        resultSubtype = message.subtype;
      }
    }
  } catch (e) {
    exception = (e as Error).message;
  }

  log(
    "probe5",
    `done. appendCalls=${store.appendCalls} mirrorErrors=${mirrorErrors} resultSubtype=${resultSubtype} sessionId=${sessionId} exception=${exception}`,
  );

  // Check local SDK transcript exists.
  const projectKeySafe = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
  const sessionFile = sessionId
    ? join(homedir(), ".claude", "projects", projectKeySafe, `${sessionId}.jsonl`)
    : "";
  const localExists = sessionFile && existsSync(sessionFile);
  const localLines = localExists ? readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).length : 0;
  log("probe5", `local transcript: path=${sessionFile} exists=${localExists} lines=${localLines}`);

  // Cleanup. surreal already killed; don't double-stop.
  await Bun.sleep(50);

  let passes = 0;
  const fails: string[] = [];
  if (mirrorErrors > 0) {
    passes++;
  } else {
    fails.push(`expected at least 1 mirror_error, got ${mirrorErrors}`);
  }
  if (resultSubtype === "success") {
    passes++;
  } else {
    fails.push(`expected resultSubtype=success, got ${resultSubtype} (exception=${exception})`);
  }
  if (localExists && localLines > 0) {
    passes++;
  } else {
    fails.push(`local transcript missing or empty: exists=${localExists} lines=${localLines}`);
  }

  console.log(`\n=== Probe 5 result: ${passes}/3 passed ===`);
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
