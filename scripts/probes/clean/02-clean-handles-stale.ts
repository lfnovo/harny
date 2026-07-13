/**
 * Probe: cleanRun proceeds when run.json has status='running' but pid is
 * dead (stale-pid case). Should warn and complete cleanup without --force.
 *
 * RUN
 *   bun scripts/probes/clean/02-clean-handles-stale.ts
 */

import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanRun } from "../../../src/harness/clean.ts";

const DEADLINE_MS = 10000;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario: pid=999999 (dead), no --force → should warn + proceed
try {
  await Promise.race([
    (async () => {
      const name = "clean-handles-stale";

      // Use a real git repo so removeWorktree/deleteLocalBranch don't fail
      const primaryCwd = await (async () => {
        const p = join(tmpdir(), `harny-probe-02-${Date.now()}`);
        await mkdir(p, { recursive: true });
        const proc = Bun.spawn(["git", "init", p], { stdout: "ignore", stderr: "ignore" });
        await proc.exited;
        if (proc.exitCode !== 0) throw new Error(`git init failed (exit ${proc.exitCode})`);
        return p;
      })();

      const slug = "test-stale-slug";
      const stateDir = join(primaryCwd, ".harny", slug);
      await mkdir(stateDir, { recursive: true });

      const state = { schema_version: 4, run: { pid: 999999 }, execution: { status: "running" } };
      await writeFile(join(stateDir, "run.json"), JSON.stringify(state), "utf8");

      // Should NOT throw (stale pid → warn and proceed)
      await cleanRun(primaryCwd, slug, false, {});

      // State dir must be gone after successful cleanup
      if (existsSync(stateDir)) {
        throw new Error(`stateDir ${stateDir} should have been removed but still exists`);
      }

      // Cleanup temp git repo
      await rm(primaryCwd, { recursive: true, force: true });

      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: unknown) {
  console.log(`FAIL clean-handles-stale: ${(e as Error).message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
