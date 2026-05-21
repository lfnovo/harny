import { isAbsolute, resolve } from "node:path";
import { listRunsInCwd } from "../harness/state/filesystem.js";
import { listPointers, writePointer } from "../harness/state/registry.js";

/**
 * Scan a single cwd and emit pointer entries for any `.harny/<slug>/state.json`
 * not already in the registry. Returns the number of pointers written.
 */
export async function scanCwd(cwd: string): Promise<number> {
  const states = await listRunsInCwd(cwd);
  if (states.length === 0) return 0;
  const existing = new Set((await listPointers()).map((p) => p.run_id));
  let written = 0;
  for (const s of states) {
    if (existing.has(s.run_id)) continue;
    await writePointer(s);
    written++;
  }
  return written;
}

export async function handleScan(cmd: { kind: "scan"; cwd?: string }): Promise<void> {
  const target = cmd.cwd
    ? (isAbsolute(cmd.cwd) ? cmd.cwd : resolve(process.cwd(), cmd.cwd))
    : process.cwd();
  const written = await scanCwd(target);
  console.log(`[harny] scan ${target}: ${written} pointer${written === 1 ? "" : "s"} added`);
}
