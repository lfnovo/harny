// Subprocess fixture for L3 SIGTERM/SIGINT exit-handler tests.
// Usage: bun sigterm-fixture.ts <repoCwd> <taskSlug>
// Calls runHarness with a never-resolving engineRunner so the process
// stays alive after state.json is written, letting the test send a signal.
import { runHarness } from "../../orchestrator.js";

const cwd = process.argv[2];
const taskSlug = process.argv[3];
if (!cwd || !taskSlug) {
  console.error("Usage: sigterm-fixture.ts <cwd> <taskSlug>");
  process.exit(2);
}

await runHarness({
  cwd,
  taskSlug,
  userPrompt: "sigterm integration test fixture",
  mode: "silent",
  logMode: "quiet",
  isolation: "inline",
  _engineRunner: () => new Promise(() => {}),
});
