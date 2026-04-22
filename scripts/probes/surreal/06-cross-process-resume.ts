/**
 * Probe 6 — Cross-process session resume via SessionStore.
 *
 * Validates the load-bearing claim from the docs: a session whose local JSONL
 * has been removed can still be resumed if the entries live in the store.
 *
 * Approach: simulate "host B has no local copy" by deleting
 * ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl between phase 1 and 2.
 * Both phases run from the same cwd (so projectKey/auth match) but only the
 * store has the transcript when phase 2 runs. If resume works, the store
 * supplied it (the SDK materializes the store data to a temp JSONL before
 * spawning the subprocess).
 *
 * Pass:
 *   - Phase 1: capture sessionId, store has entries.
 *   - Local JSONL physically deleted before phase 2.
 *   - Phase 2 resume succeeds.
 *   - The model demonstrates context retention (echoes the secret token).
 */

import { startSurreal, log } from "./_helpers.js";
import { SurrealSessionStore, SCHEMA } from "./SurrealSessionStore.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";

const SECRET_TOKEN = "azure-rhinoceros-7891";

async function main() {
  log("probe6", "starting surreal in-memory");
  const h = await startSurreal({ storage: "memory", quiet: true });
  await h.db.query(SCHEMA);
  const store = new SurrealSessionStore(h.db);

  let sessionId: string | undefined;
  let phase1Subtype: string | undefined;
  let phase2Subtype: string | undefined;
  let phase2Text = "";
  let localFileDeleted = false;

  try {
    // PHASE 1 — establish session with unique secret. Local + store both write.
    log("probe6", "PHASE 1: establish context with secret token");
    for await (const message of query({
      prompt: `Remember this token exactly: ${SECRET_TOKEN}. Just acknowledge with "got it".`,
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
        phase1Subtype = message.subtype;
      }
    }
    log("probe6", `phase 1 done. session=${sessionId} subtype=${phase1Subtype}`);

    if (!sessionId) throw new Error("no sessionId from phase 1");

    // Verify the store actually got entries.
    const totalEntries =
      (
        await h.db.query<[{ c: number }[]]>(
          `SELECT count() AS c FROM harness_session_entry WHERE session_id = $sid GROUP ALL`,
          { sid: sessionId },
        )
      )[0]?.[0]?.c ?? 0;
    log("probe6", `store has ${totalEntries} entries for session ${sessionId}`);

    // Physically remove the local JSONL — forces phase 2 to load from store.
    const projectKeySafe = process.cwd().replace(/[^A-Za-z0-9]/g, "-");
    const localPath = join(
      homedir(),
      ".claude",
      "projects",
      projectKeySafe,
      `${sessionId}.jsonl`,
    );
    if (existsSync(localPath)) {
      rmSync(localPath);
      localFileDeleted = true;
      log("probe6", `removed local ${localPath}`);
    } else {
      log("probe6", `WARN: local JSONL not found at ${localPath}`);
    }

    // PHASE 2 — resume; local is gone so the store MUST be the source.
    log("probe6", "PHASE 2: resume with NO local transcript");
    for await (const message of query({
      prompt:
        "What was the token I asked you to remember? Answer with only the token, nothing else.",
      options: {
        model: "claude-haiku-4-5-20251001",
        sessionStore: store,
        resume: sessionId,
        maxTurns: 1,
      },
    })) {
      if (message.type === "result") {
        phase2Subtype = message.subtype;
        if ("result" in message && typeof message.result === "string") {
          phase2Text = message.result;
        }
      }
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") phase2Text += block.text;
        }
      }
    }
    log(
      "probe6",
      `phase 2 done. subtype=${phase2Subtype} text="${phase2Text.slice(0, 200)}"`,
    );
  } finally {
    await h.stop();
  }

  let passes = 0;
  const fails: string[] = [];
  if (sessionId) passes++;
  else fails.push("no sessionId");
  if (phase1Subtype === "success") passes++;
  else fails.push(`phase 1 subtype was ${phase1Subtype}`);
  if (localFileDeleted) passes++;
  else fails.push("local JSONL was not deleted (cannot prove store-only resume)");
  if (phase2Subtype === "success") passes++;
  else fails.push(`phase 2 subtype was ${phase2Subtype}`);
  if (phase2Text.includes(SECRET_TOKEN)) passes++;
  else fails.push(`phase 2 text did not contain SECRET_TOKEN. got: "${phase2Text.slice(0, 200)}"`);

  console.log(`\n=== Probe 6 result: ${passes}/5 passed ===`);
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
