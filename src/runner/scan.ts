import { isAbsolute, resolve } from "node:path";
import { listRunsInCwd } from "../harness/state/runDiscovery.js";
import { listPointers, writePointer } from "../harness/state/registry.js";

export type ScanResult = { added: number; refreshed: number };
export async function scanCwd(cwd: string): Promise<ScanResult> {
  const runs = await listRunsInCwd(cwd); const existing = new Set((await listPointers()).map((pointer) => pointer.run_id)); let added = 0; let refreshed = 0;
  for (const run of runs) { await writePointer(run); if (existing.has(run.run.id)) refreshed++; else added++; }
  return { added, refreshed };
}
export async function handleScan(cmd: { kind: "scan"; cwd?: string }): Promise<void> { const target = cmd.cwd ? (isAbsolute(cmd.cwd) ? cmd.cwd : resolve(process.cwd(), cmd.cwd)) : process.cwd(); const result = await scanCwd(target); console.log(`[harny] scan ${target}: ${result.added} added, ${result.refreshed} refreshed`); }
