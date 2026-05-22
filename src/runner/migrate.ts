import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { registryDir } from "../harness/state/registry.js";
import { migrationCwds } from "./context.js";
import { scanCwd } from "./scan.js";
import type { LogMode } from "../harness/types.js";

/**
 * One-shot migration helper. The pointer registry was introduced after
 * `~/.harny/assistants.json` and per-cwd `.harny/<slug>/` directories
 * already existed. On the first invocation post-upgrade — detected by the
 * absence of `~/.harny/runs/` — we scan the current cwd and any cwds in
 * the legacy `assistants.json`, backfilling pointers.
 *
 * The migration is genuinely one-shot: we `mkdir -p` the registry dir at
 * the end even when zero pointers were written, so a user with no legacy
 * runs doesn't trigger a re-scan on every subsequent invocation.
 */
export async function maybeRunMigration(logMode: LogMode): Promise<void> {
  const dir = registryDir();
  if (existsSync(dir)) return;
  const cwds = await migrationCwds();
  let added = 0;
  let refreshed = 0;
  for (const cwd of cwds) {
    try {
      const r = await scanCwd(cwd);
      added += r.added;
      refreshed += r.refreshed;
    } catch {
      // Best-effort: a broken cwd in legacy assistants.json must not abort.
    }
  }
  // Ensure the dir exists so this migration is genuinely one-shot, even when
  // no legacy runs were found.
  await mkdir(dir, { recursive: true });
  if (added + refreshed > 0 && logMode !== "quiet") {
    console.log(
      `[harny] migrated ${added + refreshed} legacy run${added + refreshed === 1 ? "" : "s"} into ${dir}`,
    );
  }
}
