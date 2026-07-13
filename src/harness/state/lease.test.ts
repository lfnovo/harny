import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireRunLease } from "./lease.js";

test("run lease prevents concurrent PR work and releases by owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "harny-lease-")); const first = await acquireRunLease(root, "github:o/r#7", "run-1");
  await expect(acquireRunLease(root, "github:o/r#7", "run-2")).rejects.toThrow("already held"); await first.release();
  const second = await acquireRunLease(root, "github:o/r#7", "run-2"); expect(second.ownerRunId).toBe("run-2"); await second.release();
});
test("run lease reclaims a dead owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "harny-lease-dead-")); await acquireRunLease(root, "github:o/r#8", "dead", 99999999);
  const recovered = await acquireRunLease(root, "github:o/r#8", "new"); expect(recovered.ownerRunId).toBe("new"); await recovered.release();
});
