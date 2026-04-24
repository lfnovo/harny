import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, appendFile, mkdir, rm } from "node:fs/promises";
import { tailRun } from "../../../src/harness/transcripts/tail.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Scenario: live-tail ───────────────────────────────────────────────────────

async function scenarioLiveTail(): Promise<void> {
  const tmpBase = await mkdtemp(join(tmpdir(), "harny-probe-tail-live-"));
  const plannerSessionId = "probe-planner-live";
  const developerSessionId = "probe-developer-live";

  // Transcript paths mirror what tailRun computes internally
  const encodedCwd = tmpBase.replace(/\//g, "-");
  const transcriptDir = join(homedir(), ".claude", "projects", encodedCwd);
  const plannerTranscript = join(transcriptDir, plannerSessionId + ".jsonl");
  const developerTranscript = join(transcriptDir, developerSessionId + ".jsonl");

  try {
    await mkdir(transcriptDir, { recursive: true });

    const t0 = Date.now();
    const plannerStartedAt = new Date(t0).toISOString();
    const statePath = join(tmpBase, "state.json");

    const makeBaseState = (overrides: {
      status: string;
      currentPhase: string | null;
      endedAt: string | null;
      phases: Array<{
        name: string;
        startedAt: string;
        endedAt: string | null;
        phaseStatus: string;
        sessionId: string;
      }>;
    }) => ({
      schema_version: 2,
      run_id: "probe-run-tail-live",
      origin: {
        prompt: "test",
        workflow: "feature-dev",
        task_slug: "test-task",
        started_at: new Date(t0).toISOString(),
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
        status: overrides.status,
        current_phase: overrides.currentPhase,
        ended_at: overrides.endedAt,
        ended_reason: null,
        pid: 99999,
      },
      phases: overrides.phases.map((p) => ({
        name: p.name,
        attempt: 1,
        started_at: p.startedAt,
        ended_at: p.endedAt,
        status: p.phaseStatus,
        verdict: null,
        session_id: p.sessionId,
      })),
      history: [],
      pending_question: null,
      workflow_state: {},
    });

    // t=0: write initial planner event and state
    await writeFile(plannerTranscript, makeAssistantEvent(t0, "PlannerTool") + "\n");
    await writeFile(
      statePath,
      JSON.stringify(
        makeBaseState({
          status: "running",
          currentPhase: "planner",
          endedAt: null,
          phases: [
            {
              name: "planner",
              startedAt: plannerStartedAt,
              endedAt: null,
              phaseStatus: "running",
              sessionId: plannerSessionId,
            },
          ],
        }),
      ),
    );

    // Capture console.log output before starting tailRun
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    const ac = new AbortController();

    // Mutation coroutine: drives state transitions while tailRun is running
    async function mutate(): Promise<void> {
      // t=300ms: append a second planner event while still in planner phase
      await sleep(300);
      await appendFile(plannerTranscript, makeAssistantEvent(Date.now(), "PlannerTool2") + "\n");

      // t=800ms: switch state to developer phase, write first developer event
      await sleep(500);
      const devStartedAt = new Date().toISOString();
      await writeFile(developerTranscript, makeAssistantEvent(Date.now(), "DevTool") + "\n");
      await writeFile(
        statePath,
        JSON.stringify(
          makeBaseState({
            status: "running",
            currentPhase: "developer",
            endedAt: null,
            phases: [
              {
                name: "planner",
                startedAt: plannerStartedAt,
                endedAt: new Date().toISOString(),
                phaseStatus: "completed",
                sessionId: plannerSessionId,
              },
              {
                name: "developer",
                startedAt: devStartedAt,
                endedAt: null,
                phaseStatus: "running",
                sessionId: developerSessionId,
              },
            ],
          }),
        ),
      );

      // t=1500ms: mark run done; tailRun detects this at its ~t=2000ms state check
      await sleep(700);
      await writeFile(
        statePath,
        JSON.stringify(
          makeBaseState({
            status: "done",
            currentPhase: null,
            endedAt: new Date().toISOString(),
            phases: [
              {
                name: "planner",
                startedAt: plannerStartedAt,
                endedAt: new Date().toISOString(),
                phaseStatus: "completed",
                sessionId: plannerSessionId,
              },
              {
                name: "developer",
                startedAt: devStartedAt,
                endedAt: new Date().toISOString(),
                phaseStatus: "completed",
                sessionId: developerSessionId,
              },
            ],
          }),
        ),
      );
    }

    try {
      await Promise.race([
        Promise.all([tailRun(statePath, undefined, ac.signal), mutate()]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("live-tail timed out after 5000ms")), 5000),
        ),
      ]);
    } finally {
      console.log = origLog;
      ac.abort();
    }

    // ── Assertions ──────────────────────────────────────────────────────────

    const devMarkerIdx = lines.indexOf("── phase: developer ──");
    const doneMarkerIdx = lines.indexOf("── done: done ──");

    // (a) Initial planner events visible in stdout
    const hasPlannerTool = lines.some((l) => l.includes("PlannerTool"));
    if (hasPlannerTool) {
      pass(`live-tail: (a) PlannerTool events visible in stdout`);
    } else {
      fail(`live-tail: (a) PlannerTool events missing. output: ${JSON.stringify(lines)}`);
    }

    // (b) Phase-transition marker for developer present
    if (devMarkerIdx >= 0) {
      pass(`live-tail: (b) '── phase: developer ──' marker present`);
    } else {
      fail(
        `live-tail: (b) '── phase: developer ──' marker missing. output: ${JSON.stringify(lines)}`,
      );
    }

    // (c) DevTool events appear after the developer marker
    const hasDevToolAfterMarker =
      devMarkerIdx >= 0 && lines.slice(devMarkerIdx).some((l) => l.includes("DevTool"));
    if (hasDevToolAfterMarker) {
      pass(`live-tail: (c) DevTool events appear after developer marker`);
    } else {
      fail(
        `live-tail: (c) DevTool events not found after developer marker. output: ${JSON.stringify(lines)}`,
      );
    }

    // (d) Final done marker present
    if (doneMarkerIdx >= 0) {
      pass(`live-tail: (d) '── done: done ──' marker present`);
    } else {
      fail(
        `live-tail: (d) '── done: done ──' marker missing. output: ${JSON.stringify(lines)}`,
      );
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
    await Promise.race([scenarioLiveTail(), timeout(7000, "live-tail")]);
  } catch (err) {
    fail(`live-tail scenario: ${(err as Error).message}`);
  }

  process.exit(anyFail ? 1 : 0);
}

main();
