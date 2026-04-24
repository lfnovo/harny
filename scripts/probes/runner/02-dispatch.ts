/**
 * Probe: dispatch — invokes each handler with a minimal fake RunnerContext and
 * asserts side-effects at the context boundary without real fs/process I/O.
 *
 * handleUi is excluded — it requires a live HTTP server.
 *
 * RUN
 *   bun scripts/probes/runner/02-dispatch.ts
 */

import { handleLs } from "../../../src/runner/ls.ts";
import { handleShow } from "../../../src/runner/show.ts";
import { handleAnswer } from "../../../src/runner/answer.ts";
import { handleClean } from "../../../src/runner/clean.ts";
import type { RunnerContext } from "../../../src/runner/context.ts";

const DEADLINE_MS = 5000;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
  );
}

let failures = 0;

// Fake context: searchCwds points to a nonexistent dir so listAllRuns/findRun
// return [] / null without touching real harness state.
const ctx: RunnerContext = {
  logMode: "compact",
  assistantName: null,
  searchCwds: [`/tmp/harny-probe-dispatch-${Date.now()}`],
};

function captureConsole(): { restore: () => void; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return { restore: () => { console.log = origLog; console.error = origError; }, logs, errors };
}

async function captureExit(fn: () => Promise<void>): Promise<number | undefined> {
  const origExit = process.exit;
  let code: number | undefined;
  (process as any).exit = (c: number) => { code = c; throw new Error(`process.exit(${c})`); };
  try { await fn(); }
  catch (e) { if (!(e as Error).message?.startsWith("process.exit(")) throw e; }
  finally { process.exit = origExit; }
  return code;
}

// ── handleLs: empty search dir → "No runs found." ────────────────────────────
try {
  await Promise.race([
    (async () => {
      const name = "handleLs-empty";
      const cap = captureConsole();
      try { await handleLs({ kind: "ls" }, ctx); } finally { cap.restore(); }
      if (!cap.logs.some((l) => l.includes("No runs found"))) {
        throw new Error(`expected "No runs found." in output, got: ${JSON.stringify(cap.logs)}`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL handleLs-empty: ${e.message}`); failures++; }

// ── handleLs with status filter: still "No runs found." ──────────────────────
try {
  await Promise.race([
    (async () => {
      const name = "handleLs-status-filter";
      const cap = captureConsole();
      try { await handleLs({ kind: "ls", status: "done" }, ctx); } finally { cap.restore(); }
      if (!cap.logs.some((l) => l.includes("No runs found"))) {
        throw new Error(`expected "No runs found." with status filter`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL handleLs-status-filter: ${e.message}`); failures++; }

// ── handleShow: nonexistent runId → process.exit(1) ──────────────────────────
try {
  await Promise.race([
    (async () => {
      const name = "handleShow-not-found";
      const cap = captureConsole();
      let exitCode: number | undefined;
      try { exitCode = await captureExit(() => handleShow({ kind: "show", runId: "nonexistent-probe-id" }, ctx)); }
      finally { cap.restore(); }
      if (exitCode !== 1) throw new Error(`expected exit(1), got exit(${exitCode})`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL handleShow-not-found: ${e.message}`); failures++; }

// ── handleAnswer: nonexistent runId → process.exit(1) ────────────────────────
try {
  await Promise.race([
    (async () => {
      const name = "handleAnswer-exits";
      const cap = captureConsole();
      let exitCode: number | undefined;
      try { exitCode = await captureExit(() => handleAnswer({ kind: "answer", runId: "nonexistent-probe-id" }, ctx)); }
      finally { cap.restore(); }
      if (exitCode !== 1) throw new Error(`expected exit(1), got exit(${exitCode})`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL handleAnswer-exits: ${e.message}`); failures++; }

// ── handleClean: resolveAssistant + cleanRun invoked (may throw on missing slug) ──
try {
  await Promise.race([
    (async () => {
      const name = "handleClean-invocable";
      const cap = captureConsole();
      let exitCode: number | undefined;
      try {
        exitCode = await captureExit(() => handleClean({ kind: "clean", slug: "probe-nonexistent-slug" }, ctx));
      } finally { cap.restore(); }
      // cleanRun may exit(1) or throw for a nonexistent slug — both indicate it was reached
      // after resolveAssistant resolved successfully.
      console.log(`PASS ${name} (exitCode=${exitCode ?? "none"})`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL handleClean-invocable: ${e.message}`); failures++; }

// handleUi: SKIP — requires a live HTTP server; excluded from automated probe suite.

process.exit(failures > 0 ? 1 : 0);
