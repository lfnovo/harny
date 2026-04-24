import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import {
  parseSinceArg,
  backfillFilter,
  tailRun,
} from "../../../src/harness/transcripts/tail.js";

let anyFail = false;

function pass(msg: string) {
  console.log(`PASS ${msg}`);
}

function fail(msg: string) {
  console.log(`FAIL ${msg}`);
  anyFail = true;
}

function makeAssistantEvent(timestamp: number, toolName: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: new Date(timestamp).toISOString(),
    message: {
      content: [
        {
          type: "tool_use",
          id: `tu_${timestamp}`,
          name: toolName,
          input: { key: toolName },
        },
      ],
    },
  });
}

// ── Scenario 1: parse-since ──────────────────────────────────────────────────

async function scenarioParseSince(): Promise<void> {
  const validCases: Array<[string, number]> = [
    ["60", 60],
    ["30s", 30],
    ["5m", 300],
    ["1h", 3600],
  ];
  for (const [input, expected] of validCases) {
    try {
      const result = parseSinceArg(input);
      if (result === expected) {
        pass(`parse-since: "${input}" → ${result}`);
      } else {
        fail(`parse-since: "${input}" → ${result} (expected ${expected})`);
      }
    } catch (err) {
      fail(`parse-since: "${input}" threw unexpectedly: ${(err as Error).message}`);
    }
  }
  try {
    parseSinceArg("bogus");
    fail(`parse-since: "bogus" should have thrown`);
  } catch {
    pass(`parse-since: "bogus" throws`);
  }
}

// ── Scenario 2: backfill-filter ──────────────────────────────────────────────

async function scenarioBackfillFilter(): Promise<void> {
  // Fixed base timestamp so test is deterministic
  const baseNow = 1_700_000_000_000;
  // 10 events spread over 10 minutes, one per minute
  const events = Array.from({ length: 10 }, (_, i) => ({
    timestamp: new Date(baseNow - (10 - i) * 60 * 1000).toISOString(),
    idx: i,
  }));
  // sinceSeconds=120 → cutoff = baseNow - 120000
  // events[8]: ts = baseNow - 2*60000 = baseNow - 120000 (exactly at cutoff → included)
  // events[9]: ts = baseNow - 1*60000 (inside window → included)
  const filtered = backfillFilter(events, 120, baseNow);
  if (filtered.length === 2) {
    pass(`backfill-filter: correct count (2 events within 120s)`);
  } else {
    fail(`backfill-filter: expected 2 events, got ${filtered.length}`);
  }
  const idxs = (filtered as Array<{ idx: number }>).map((e) => e.idx);
  if (idxs.includes(8) && idxs.includes(9)) {
    pass(`backfill-filter: correct events returned (idx 8 and 9)`);
  } else {
    fail(`backfill-filter: expected idx [8,9], got [${idxs.join(",")}]`);
  }
  // Event with no timestamp should be excluded
  const mixed = [{ idx: 0 }, { timestamp: new Date(baseNow - 10 * 1000).toISOString(), idx: 1 }];
  const mixedFiltered = backfillFilter(mixed, 120, baseNow);
  if (mixedFiltered.length === 1 && (mixedFiltered[0] as { idx: number }).idx === 1) {
    pass(`backfill-filter: events without timestamp are excluded`);
  } else {
    fail(`backfill-filter: unexpected result for event without timestamp: ${JSON.stringify(mixedFiltered)}`);
  }
}

// ── Scenario 3: integration ──────────────────────────────────────────────────

async function scenarioIntegration(): Promise<void> {
  const tmpBase = await mkdtemp(join(tmpdir(), "harny-probe-tail-since-"));
  const sessionId = "probe-session-tail-since";

  // Transcript lives at ~/.claude/projects/<encodedCwd>/<sessionId>.jsonl
  const encodedCwd = tmpBase.replace(/\//g, "-");
  const transcriptDir = join(homedir(), ".claude", "projects", encodedCwd);
  const transcriptFile = join(transcriptDir, sessionId + ".jsonl");

  try {
    await mkdir(transcriptDir, { recursive: true });

    const now = Date.now();
    const oldLines = [
      makeAssistantEvent(now - 10 * 60 * 1000, "OldTool1"),
      makeAssistantEvent(now - 8 * 60 * 1000, "OldTool2"),
      makeAssistantEvent(now - 5 * 60 * 1000, "OldTool3"),
    ];
    const recentLines = [
      makeAssistantEvent(now - 60 * 1000, "RecentTool1"),
      makeAssistantEvent(now - 30 * 1000, "RecentTool2"),
    ];
    await writeFile(transcriptFile, [...oldLines, ...recentLines].join("\n") + "\n");

    const state = {
      schema_version: 2,
      run_id: "probe-run-tail-since",
      origin: {
        prompt: "test",
        workflow: "feature-dev",
        task_slug: "test-task",
        started_at: new Date().toISOString(),
        host: "localhost",
        user: "test",
        features: null,
      },
      environment: {
        cwd: tmpBase,
        branch: "main",
        isolation: "inline",
        worktree_path: null,
        mode: "silent",
      },
      lifecycle: {
        status: "running",
        current_phase: "developer",
        ended_at: null,
        ended_reason: null,
        pid: 99999,
      },
      phases: [
        {
          name: "developer",
          attempt: 1,
          started_at: new Date().toISOString(),
          ended_at: null,
          status: "running",
          verdict: null,
          session_id: sessionId,
        },
      ],
      history: [],
      pending_question: null,
      workflow_state: {},
    };

    const statePath = join(tmpBase, "state.json");
    await writeFile(statePath, JSON.stringify(state));

    // Capture console.log output while running tailRun
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 200);
      await tailRun(statePath, 120, ac.signal);
    } finally {
      console.log = origLog;
    }

    const liveIdx = lines.indexOf("── live ──");
    const hasLiveMarker = liveIdx >= 0;
    const beforeLive = liveIdx >= 0 ? lines.slice(0, liveIdx) : [];

    if (hasLiveMarker) {
      pass(`integration: '── live ──' marker present`);
    } else {
      fail(`integration: '── live ──' marker missing. output: ${JSON.stringify(lines)}`);
    }

    const hasRecent1 = beforeLive.some((l) => l.includes("RecentTool1"));
    const hasRecent2 = beforeLive.some((l) => l.includes("RecentTool2"));
    if (hasRecent1 && hasRecent2) {
      pass(`integration: recent events appear before '── live ──'`);
    } else {
      fail(`integration: missing recent events before live marker. lines=${JSON.stringify(lines)}`);
    }

    const hasOld1 = lines.some((l) => l.includes("OldTool1"));
    const hasOld2 = lines.some((l) => l.includes("OldTool2"));
    const hasOld3 = lines.some((l) => l.includes("OldTool3"));
    if (!hasOld1 && !hasOld2 && !hasOld3) {
      pass(`integration: old events (outside window) not in output`);
    } else {
      fail(`integration: old events appeared in output. lines=${JSON.stringify(lines)}`);
    }
  } finally {
    await rm(transcriptDir, { recursive: true, force: true });
    await rm(tmpBase, { recursive: true, force: true });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const timeout = (ms: number, label: string) =>
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    );

  try {
    await Promise.race([scenarioParseSince(), timeout(1500, "parse-since")]);
  } catch (err) {
    fail(`parse-since scenario: ${(err as Error).message}`);
  }

  try {
    await Promise.race([scenarioBackfillFilter(), timeout(1500, "backfill-filter")]);
  } catch (err) {
    fail(`backfill-filter scenario: ${(err as Error).message}`);
  }

  try {
    await Promise.race([scenarioIntegration(), timeout(1500, "integration")]);
  } catch (err) {
    fail(`integration scenario: ${(err as Error).message}`);
  }

  process.exit(anyFail ? 1 : 0);
}

main();
