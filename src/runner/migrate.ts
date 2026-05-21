import { existsSync } from "node:fs";
import { registryDir, listPointers } from "../harness/state/registry.js";
import { migrationCwds } from "./context.js";
import { scanCwd } from "./scan.js";
import type { LogMode } from "../harness/types.js";

/**
 * One-shot migration helper. The pointer registry was introduced after
 * `~/.harny/assistants.json` and per-cwd `.harny/<slug>/` directories
 * already existed. On first invocation post-upgrade we backfill pointers
 * so `ls`/`show`/`ui` are not suddenly empty.
 *
 * Trigger: registry dir does not exist OR is empty. We scan the current
 * cwd and any cwds registered in the legacy `assistants.json`. Subsequent
 * runs are no-ops because `createRun` writes pointers inline.
 */
export async function maybeRunMigration(logMode: LogMode): Promise<void> {
  const dir = registryDir();
  const registryAbsent = !existsSync(dir);
  if (!registryAbsent) {
    const pointers = await listPointers();
    if (pointers.length > 0) return;
  }
  const cwds = await migrationCwds();
  let total = 0;
  for (const cwd of cwds) {
    try {
      total += await scanCwd(cwd);
    } catch {
      // Best-effort: a broken cwd in legacy assistants.json must not abort.
    }
  }
  if (total > 0 && logMode !== "quiet") {
    console.log(`[harny] migrated ${total} legacy run${total === 1 ? "" : "s"} into ${dir}`);
  }
}
