/**
 * Probe: cleanRun with force=true terminates a live child process, then cleans.
 *
 * Spawns a 30s-sleeping child, writes state.json with its pid, calls cleanRun
 * with force=true, and asserts the child is dead within the deadline.
 *
 * RUN
 *   bun scripts/probes/clean/03-clean-force-kills.ts
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanRun } from "../../../src/harness/clean.ts";

const DEADLINE_MS = 10000;

let failures = 0;

try {
  await Promise.race([
    (async () => {
      const name = "clean-force-kills";

      // Use a real git repo so git operations in cleanRun don't error
      const primaryCwd = await (async () => {
        const p = join(tmpdir(), `harny-probe-03-${Date.now()}`);
        await mkdir(p, { recursive: true });
        const proc = Bun.spawn(["git", "init", p], { stdout: "ignore", stderr: "ignore" });
        await proc.exited;
        if (proc.exitCode !== 0) throw new Error(`git init failed (exit ${proc.exitCode})`);
        return p;
      })();

      // Spawn a 30s-sleeping child
      const child = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
      const childPid = child.pid;

      // Verify it's alive before the test
      let aliveBeforeClean = false;
      try {
        process.kill(childPid, 0);
        aliveBeforeClean = true;
      } catch {
        // dead already
      }
      if (!aliveBeforeClean) throw new Error(`child pid ${childPid} not alive before cleanRun`);

      const slug = "test-force-slug";
      const stateDir = join(primaryCwd, ".harny", slug);
      await mkdir(stateDir, { recursive: true });

      const state = {
        schema_version: 2,
        run_id: "test-run",
        origin: { prompt: "x", workflow: "feature-dev", task_slug: slug, started_at: new Date().toISOString(), host: "localhost", user: "test", features: null },
        environment: { cwd: primaryCwd, branch: `harny/${slug}`, isolation: "inline", worktree_path: null, mode: "silent" },
        lifecycle: { status: "running", current_phase: null, ended_at: null, ended_reason: null, pid: childPid },
        phases: [],
        history: [],
        pending_question: null,
        workflow_state: {},
        workflow_chosen: null,
      };
      await writeFile(join(stateDir, "state.json"), JSON.stringify(state), "utf8");

      // Should terminate the child and clean up
      await cleanRun(primaryCwd, slug, false, { force: true });

      // Wait for Bun to reap the child (exited promise)
      await Promise.race([
        child.exited,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("child.exited timed out")), 2000),
        ),
      ]);

      // Assert child is dead
      let stillAlive = false;
      try {
        process.kill(childPid, 0);
        stillAlive = true;
      } catch {
        // ESRCH = dead, as expected
      }
      if (stillAlive) {
        throw new Error(`child pid ${childPid} is still alive after cleanRun with force=true`);
      }

      // Assert state dir is gone
      if (existsSync(stateDir)) {
        throw new Error(`stateDir ${stateDir} should have been removed but still exists`);
      }

      // Cleanup temp git repo
      await rm(primaryCwd, { recursive: true, force: true });

      console.log(`PASS ${name}`);
    })(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
    ),
  ]);
} catch (e: unknown) {
  console.log(`FAIL clean-force-kills: ${(e as Error).message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
