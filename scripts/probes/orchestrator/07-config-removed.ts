/**
 * Probe: config-removed — asserts src/harness/config.ts does not exist.
 *
 * RUN
 *   bun scripts/probes/orchestrator/07-config-removed.ts
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const configPath = join(import.meta.dir, "../../../src/harness/config.ts");

if (existsSync(configPath)) {
  console.log(`FAIL config-removed: src/harness/config.ts still exists at ${configPath}`);
  process.exit(1);
} else {
  console.log("PASS config-removed: src/harness/config.ts does not exist");
  process.exit(0);
}
