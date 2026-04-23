/**
 * Probe: no-harny-json — asserts zero occurrences of 'harny.json' in src/.
 *
 * RUN
 *   bun scripts/probes/orchestrator/06-no-harny-json.ts
 */

import { join } from "node:path";

const srcDir = join(import.meta.dir, "../../../src");

// grep exits 0 when matches found, 1 when no matches — invert sense for our check.
const result = Bun.spawnSync(
  ["grep", "-r", "--include=*.ts", "-l", "harny.json", srcDir],
  { stdout: "pipe", stderr: "pipe" },
);

const output = await new Response(result.stdout).text();
const trimmed = output.trim();

if (result.exitCode === 0 && trimmed.length > 0) {
  console.log(`FAIL no-harny-json: found 'harny.json' in src/ files:\n${trimmed}`);
  process.exit(1);
} else {
  console.log("PASS no-harny-json");
  process.exit(0);
}
