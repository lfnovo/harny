/**
 * Probe: cleanRun refuses to remove artifacts when the run's pid is alive
 * and --force is not passed.
 *
 * RUN
 *   bun scripts/probes/clean/01-clean-refuses-live.ts
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanRun } from "../../../src/harness/clean.ts";

const DEADLINE_MS = 5000;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario: pid=process.pid (self, guaranteed alive), no --force → must throw
try {
  await Promise.race([
    (async () => {
      const name = "clean-refuses-live";

      const primaryCwd = await (async () => {
        const p = join(tmpdir(), `harny-probe-01-${Date.now()}`);
        await mkdir(p, { recursive: true });
        return p;
      })();

      const slug = "test-live-slug";
      const stateDir = join(primaryCwd, ".harny", slug);
      await mkdir(stateDir, { recursive: true });

      const state = {
        schema_version: 2,
        run_id: "test-run",
        origin: { prompt: "x", workflow: "feature-dev", task_slug: slug, started_at: new Date().toISOString(), host: "localhost", user: "test", features: null },
        environment: { cwd: primaryCwd, branch: `harny/${slug}`, isolation: "inline", worktree_path: null, mode: "silent" },
        lifecycle: { status: "running", current_phase: null, ended_at: null, ended_reason: null, pid: process.pid },
        phases: [],
        history: [],
        pending_question: null,
        workflow_state: {},
        workflow_chosen: null,
      };
      await writeFile(join(stateDir, "state.json"), JSON.stringify(state), "utf8");

      let threw = false;
      let errorMsg = "";
      try {
        await cleanRun(primaryCwd, slug, false, {});
      } catch (err: unknown) {
        threw = true;
        errorMsg = (err as Error).message ?? "";
      }

      if (!threw) {
        throw new Error("expected cleanRun to throw but it did not");
      }
      if (!errorMsg.includes("active") && !errorMsg.includes("refusing")) {
        throw new Error(`error message should contain 'active' or 'refusing', got: ${errorMsg}`);
      }

      // State dir must still be present (no cleanup happened)
      if (!existsSync(join(stateDir, "state.json"))) {
        throw new Error("state.json was removed despite refusal — artifacts must be preserved");
      }

      // Cleanup temp dir
      await rm(primaryCwd, { recursive: true, force: true });

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: unknown) {
  console.log(`FAIL clean-refuses-live: ${(e as Error).message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
