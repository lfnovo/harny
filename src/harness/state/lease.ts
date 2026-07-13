import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export interface RunLease { key: string; ownerRunId: string; acquiredAt: string; release(): Promise<void>; }

export async function acquireRunLease(root: string, key: string, ownerRunId: string, pid = process.pid): Promise<RunLease> {
  const dir = join(root, ".harny", "leases"); await mkdir(dir, { recursive: true }); const hash = createHash("sha256").update(key).digest("hex"); const path = join(dir, `${hash}.json`); const acquiredAt = new Date().toISOString();
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const handle = await open(path, "wx"); await handle.writeFile(JSON.stringify({ key, ownerRunId, pid, acquiredAt })); await handle.close(); return { key, ownerRunId, acquiredAt, release: async () => { const current = JSON.parse(await readFile(path, "utf8")); if (current.ownerRunId === ownerRunId) await unlink(path); } }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = JSON.parse(await readFile(path, "utf8"));
      if (isPidAlive(current.pid)) throw new Error(`lease already held for ${key} by run ${current.ownerRunId}`);
      await unlink(path).catch(() => {});
    }
  }
  throw new Error(`could not acquire lease for ${key}`);
}
function isPidAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
