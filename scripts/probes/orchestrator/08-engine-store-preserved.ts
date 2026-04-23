/**
 * Probe: engine-store-preserved — asserts the runEngineWorkflow call site in
 * orchestrator.ts contains the word 'store'.
 *
 * RUN
 *   bun scripts/probes/orchestrator/08-engine-store-preserved.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const orchestratorPath = join(import.meta.dir, "../../../src/harness/orchestrator.ts");
const source = readFileSync(orchestratorPath, "utf8");

// Find the runEngineWorkflow call block and verify it contains 'store'.
const callIndex = source.indexOf("runEngineWorkflow(");
if (callIndex === -1) {
  console.log("FAIL engine-store-preserved: runEngineWorkflow call not found in orchestrator.ts");
  process.exit(1);
}

// Grab a window around the call site to check for 'store'.
const window = source.slice(callIndex, callIndex + 400);
if (!window.includes("store")) {
  console.log(`FAIL engine-store-preserved: 'store' not found near runEngineWorkflow call:\n${window}`);
  process.exit(1);
}

console.log("PASS engine-store-preserved");
process.exit(0);
