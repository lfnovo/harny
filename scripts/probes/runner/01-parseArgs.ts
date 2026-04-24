/**
 * Probe: parseArgs pure unit tests — table-driven flag and subcommand parsing.
 *
 * RUN
 *   bun scripts/probes/runner/01-parseArgs.ts
 */

import { parseArgs } from "../../../src/runner.ts";

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
  );
}

let failures = 0;

function check(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e: unknown) { console.log(`FAIL ${name}: ${(e as Error).message}`); failures++; }
}

// ── Subcommand: ls ────────────────────────────────────────────────────────────
try {
  await Promise.race([
    (async () => {
      check("ls-no-flags", () => {
        const r = parseArgs(["ls"]);
        if (r.registryCmd?.kind !== "ls") throw new Error(`expected kind='ls', got ${r.registryCmd?.kind}`);
      });
      check("ls-status-space", () => {
        const r = parseArgs(["ls", "--status", "done"]);
        if ((r.registryCmd as any)?.status !== "done") throw new Error(`expected status='done'`);
      });
      check("ls-status-eq", () => {
        const r = parseArgs(["ls", "--status=done"]);
        if ((r.registryCmd as any)?.status !== "done") throw new Error(`expected status='done'`);
      });
      check("ls-cwd-space", () => {
        const r = parseArgs(["ls", "--cwd", "/some/path"]);
        if ((r.registryCmd as any)?.cwd !== "/some/path") throw new Error(`expected cwd='/some/path'`);
      });
      check("ls-cwd-eq", () => {
        const r = parseArgs(["ls", "--cwd=/some/path"]);
        if ((r.registryCmd as any)?.cwd !== "/some/path") throw new Error(`expected cwd='/some/path'`);
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL ls-scenarios: ${e.message}`); failures++; }

// ── Subcommand: show ──────────────────────────────────────────────────────────
try {
  await Promise.race([
    (async () => {
      check("show-runId", () => {
        const r = parseArgs(["show", "abc123"]);
        const cmd = r.registryCmd as any;
        if (cmd?.kind !== "show") throw new Error(`expected kind='show'`);
        if (cmd.runId !== "abc123") throw new Error(`expected runId='abc123', got ${cmd.runId}`);
      });
      check("show-tail", () => {
        const cmd = parseArgs(["show", "abc123", "--tail"]).registryCmd as any;
        if (!cmd?.tail) throw new Error(`expected tail=true`);
      });
      check("show-since-space", () => {
        const cmd = parseArgs(["show", "abc123", "--since", "10m"]).registryCmd as any;
        if (cmd?.since !== "10m") throw new Error(`expected since='10m', got ${cmd?.since}`);
      });
      check("show-since-eq", () => {
        const cmd = parseArgs(["show", "abc123", "--since=10m"]).registryCmd as any;
        if (cmd?.since !== "10m") throw new Error(`expected since='10m', got ${cmd?.since}`);
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL show-scenarios: ${e.message}`); failures++; }

// ── Subcommand: answer ────────────────────────────────────────────────────────
try {
  await Promise.race([
    (async () => {
      check("answer-runId", () => {
        const r = parseArgs(["answer", "run-xyz"]);
        const cmd = r.registryCmd as any;
        if (cmd?.kind !== "answer") throw new Error(`expected kind='answer'`);
        if (cmd.runId !== "run-xyz") throw new Error(`expected runId='run-xyz', got ${cmd.runId}`);
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL answer-scenarios: ${e.message}`); failures++; }

// ── Subcommand: ui ────────────────────────────────────────────────────────────
try {
  await Promise.race([
    (async () => {
      check("ui-no-flags", () => {
        const cmd = parseArgs(["ui"]).registryCmd as any;
        if (cmd?.kind !== "ui") throw new Error(`expected kind='ui'`);
      });
      check("ui-no-open", () => {
        const cmd = parseArgs(["ui", "--no-open"]).registryCmd as any;
        if (!cmd?.noOpen) throw new Error(`expected noOpen=true`);
      });
      check("ui-port-space", () => {
        const cmd = parseArgs(["ui", "--port", "3000"]).registryCmd as any;
        if (cmd?.port !== 3000) throw new Error(`expected port=3000, got ${cmd?.port}`);
      });
      check("ui-port-eq", () => {
        const cmd = parseArgs(["ui", "--port=3000"]).registryCmd as any;
        if (cmd?.port !== 3000) throw new Error(`expected port=3000, got ${cmd?.port}`);
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL ui-scenarios: ${e.message}`); failures++; }

// ── Subcommand: clean ─────────────────────────────────────────────────────────
try {
  await Promise.race([
    (async () => {
      check("clean-slug", () => {
        const cmd = parseArgs(["clean", "my-run"]).registryCmd as any;
        if (cmd?.kind !== "clean") throw new Error(`expected kind='clean'`);
        if (cmd.slug !== "my-run") throw new Error(`expected slug='my-run'`);
      });
      check("clean-force", () => {
        const cmd = parseArgs(["clean", "my-run", "--force"]).registryCmd as any;
        if (!cmd?.force) throw new Error(`expected force=true`);
      });
      check("clean-kill", () => {
        const cmd = parseArgs(["clean", "my-run", "--kill"]).registryCmd as any;
        if (!cmd?.kill) throw new Error(`expected kill=true`);
      });
      check("clean-force-kill", () => {
        const cmd = parseArgs(["clean", "my-run", "--force", "--kill"]).registryCmd as any;
        if (!cmd?.force) throw new Error(`expected force=true`);
        if (!cmd?.kill) throw new Error(`expected kill=true`);
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL clean-scenarios: ${e.message}`); failures++; }

// ── Global flags: both --flag value and --flag=value forms ───────────────────
try {
  await Promise.race([
    (async () => {
      check("verbose-long", () => {
        if (parseArgs(["--verbose"]).logMode !== "verbose") throw new Error(`expected logMode='verbose'`);
      });
      // Regression from 3d2dabd: -v short flag must set logMode='verbose'
      check("verbose-short-v", () => {
        if (parseArgs(["-v"]).logMode !== "verbose") throw new Error(`expected logMode='verbose' from -v`);
      });
      check("quiet-flag", () => {
        if (parseArgs(["--quiet"]).logMode !== "quiet") throw new Error(`expected logMode='quiet'`);
      });
      check("workflow-space", () => {
        if (parseArgs(["--workflow", "feature-dev"]).workflow !== "feature-dev")
          throw new Error(`expected workflow='feature-dev'`);
      });
      check("workflow-eq", () => {
        if (parseArgs(["--workflow=feature-dev"]).workflow !== "feature-dev")
          throw new Error(`expected workflow='feature-dev'`);
      });
      // Regression from 3d2dabd: colon in workflow value must round-trip intact
      check("workflow-colon-variant", () => {
        const r = parseArgs(["--workflow=feature-dev:just-bugs", "some prompt"]);
        if (r.workflow !== "feature-dev:just-bugs")
          throw new Error(`expected 'feature-dev:just-bugs', got '${r.workflow}'`);
      });
      check("assistant-space", () => {
        if (parseArgs(["--assistant", "myproject"]).assistant !== "myproject")
          throw new Error(`expected assistant='myproject'`);
      });
      check("assistant-eq", () => {
        if (parseArgs(["--assistant=myproject"]).assistant !== "myproject")
          throw new Error(`expected assistant='myproject'`);
      });
      check("task-space", () => {
        if (parseArgs(["--task", "issue-42"]).task !== "issue-42")
          throw new Error(`expected task='issue-42'`);
      });
      check("task-eq", () => {
        if (parseArgs(["--task=issue-42"]).task !== "issue-42")
          throw new Error(`expected task='issue-42'`);
      });
      check("isolation-space", () => {
        if (parseArgs(["--isolation", "worktree"]).isolation !== "worktree")
          throw new Error(`expected isolation='worktree'`);
      });
      check("isolation-eq", () => {
        if (parseArgs(["--isolation=worktree"]).isolation !== "worktree")
          throw new Error(`expected isolation='worktree'`);
      });
      check("mode-space", () => {
        if (parseArgs(["--mode", "silent"]).mode !== "silent")
          throw new Error(`expected mode='silent'`);
      });
      check("mode-eq", () => {
        if (parseArgs(["--mode=silent"]).mode !== "silent")
          throw new Error(`expected mode='silent'`);
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL global-flag-scenarios: ${e.message}`); failures++; }

// ── Invalid --isolation throws ────────────────────────────────────────────────
try {
  await Promise.race([
    (async () => {
      check("invalid-isolation-throws", () => {
        let threw = false;
        try { parseArgs(["--isolation=bad"]); } catch { threw = true; }
        if (!threw) throw new Error("expected parseArgs to throw for --isolation=bad");
      });
      check("invalid-isolation-space-throws", () => {
        let threw = false;
        try { parseArgs(["--isolation", "bad"]); } catch { threw = true; }
        if (!threw) throw new Error("expected parseArgs to throw for --isolation bad");
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL invalid-isolation: ${e.message}`); failures++; }

// ── No subcommand + prompt → registryCmd null, prompt preserved ───────────────
try {
  await Promise.race([
    (async () => {
      check("no-subcmd-prompt", () => {
        const r = parseArgs(["implement", "feature", "X"]);
        if (r.registryCmd !== null) throw new Error(`expected registryCmd=null, got kind=${r.registryCmd?.kind}`);
        if (r.prompt !== "implement feature X") throw new Error(`expected 'implement feature X', got '${r.prompt}'`);
      });
      check("no-subcmd-empty", () => {
        const r = parseArgs([]);
        if (r.registryCmd !== null) throw new Error(`expected registryCmd=null`);
        if (r.prompt !== "") throw new Error(`expected empty prompt`);
      });
    })(),
    hardDeadline(),
  ]);
} catch (e: any) { console.log(`FAIL no-subcmd-scenarios: ${e.message}`); failures++; }

process.exit(failures > 0 ? 1 : 0);
