import { isAbsolute, resolve } from "node:path";
import { listRunsInCwd } from "../harness/state/filesystem.js";
import { listPointers, writePointer } from "../harness/state/registry.js";

export type ScanResult = {
  added: number;
  refreshed: number;
};

/**
 * Scan a single cwd and emit pointer entries for every state.json found,
 * overwriting drifted pointers (refresh semantics) and adding new ones.
 */
export async function scanCwd(cwd: string): Promise<ScanResult> {
  const states = await listRunsInCwd(cwd);
  if (states.length === 0) return { added: 0, refreshed: 0 };
  const existing = new Set((await listPointers()).map((p) => p.run_id));
  let added = 0;
  let refreshed = 0;
  for (const s of states) {
    await writePointer(s);
    if (existing.has(s.run_id)) refreshed++;
    else added++;
  }
  return { added, refreshed };
}

export async function handleScan(cmd: { kind: "scan"; cwd?: string }): Promise<void> {
  const target = cmd.cwd
    ? (isAbsolute(cmd.cwd) ? cmd.cwd : resolve(process.cwd(), cmd.cwd))
    : process.cwd();
  const result = await scanCwd(target);
  console.log(
    `[harny] scan ${target}: ${result.added} added, ${result.refreshed} refreshed`,
  );
}
