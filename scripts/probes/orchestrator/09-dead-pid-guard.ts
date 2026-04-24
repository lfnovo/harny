/**
 * Probe: dead-pid-guard — asserts that runHarness throws "crashed mid-execution"
 * when state.json shows status=running with a dead pid.
 *
 * RUN
 *   bun scripts/probes/orchestrator/09-dead-pid-guard.ts
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runHarness } from "../../../src/harness/orchestrator.ts";

const PROBE_NAME = "09-dead-pid-guard";

function makeTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "harny-e2e-"));
  const g = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: dir });
  g(["init"]);
  g(["config", "user.email", "test@harny.local"]);
  g(["config", "user.name", "Harny Test"]);
  writeFileSync(join(dir, "README.md"), "# Test\n");
  g(["add", "README.md"]);
  g(["commit", "-m", "seed"]);
  return dir;
}

async function main(): Promise<void> {
  const tmpDir = makeTmpRepo();
  const taskSlug = "dead-pid-test";

  try {
    const stateDir = join(tmpDir, ".harny", taskSlug);
    mkdirSync(stateDir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(
      join(stateDir, "state.json"),
      JSON.stringify({
        schema_version: 2,
        run_id: "00000000-0000-0000-0000-000000000000",
        origin: {
          prompt: "test",
          workflow: "feature-dev",
          task_slug: taskSlug,
          started_at: now,
          host: "test-host",
          user: "test-user",
          features: null,
        },
        environment: {
          cwd: tmpDir,
          branch: `harny/${taskSlug}`,
          isolation: "worktree",
          worktree_path: null,
          mode: "silent",
        },
        lifecycle: {
          status: "running",
          current_phase: null,
          ended_at: null,
          ended_reason: null,
          pid: 99999999,
        },
        phases: [],
        history: [{ at: now, phase: "harness", event: "run_started" }],
        pending_question: null,
        workflow_state: {},
        workflow_chosen: null,
      }),
    );

    let threw = false;
    let errorMessage = "";
    try {
      await runHarness({
        cwd: tmpDir,
        userPrompt: "test",
        taskSlug,
        mode: "silent",
        logMode: "quiet",
      });
    } catch (err: unknown) {
      threw = true;
      errorMessage = (err as Error).message ?? "";
    }

    if (!threw) {
      throw new Error("expected runHarness to throw but it did not");
    }
    if (!errorMessage.includes("crashed mid-execution")) {
      throw new Error(
        `expected error message to contain "crashed mid-execution", got: ${errorMessage}`,
      );
    }

    console.log(`PASS ${PROBE_NAME}`);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
}

await main().catch((e: unknown) => {
  console.log(`FAIL ${PROBE_NAME}: ${(e as Error).message}`);
  process.exit(1);
});
