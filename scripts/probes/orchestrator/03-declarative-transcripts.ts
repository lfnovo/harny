/** Probe: the declarative agent path owns a local incremental transcript. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let failures = 0;
try {
  const runner = await readFile(join(import.meta.dir, "../../../src/harness/workflow/declarativeRunner.ts"), "utf8");
  const claude = await readFile(join(import.meta.dir, "../../../src/harness/providers/claude.ts"), "utf8");
  const codex = await readFile(join(import.meta.dir, "../../../src/harness/providers/codex.ts"), "utf8");
  if (!runner.includes("new TranscriptStore") || !runner.includes("onEvent")) throw new Error("declarative runner is not writing transcript events");
  if (!claude.includes("emitClaudeMessage") || !codex.includes("normalizeEvent")) throw new Error("provider event normalization is missing");
  console.log("PASS declarative-path-transcripts");
} catch (error) {
  console.log(`FAIL declarative-path-transcripts: ${(error as Error).message}`); failures++;
}
process.exit(failures ? 1 : 0);
