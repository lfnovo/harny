/**
 * Probe: Claude Agent SDK → Phoenix via Arize OpenInference instrumentation.
 *
 * This is the "official" path documented at
 *   https://arize.com/docs/phoenix/integrations/typescript/claude-agent-sdk
 *
 * Compared to probe 01 (which used the SDK's built-in OTel export):
 *   - Produces AGENT + TOOL spans following OpenInference semantic conventions
 *     (openinference.span.kind=AGENT / TOOL, input.value, output.value, etc.)
 *   - Renders nicely in Phoenix's trace view (which was designed around OI).
 *   - Does NOT need the CLAUDE_CODE_ENABLE_TELEMETRY env dance — the
 *     instrumentation patches the SDK at import time.
 *
 * Approach: register phoenix-otel first, instrument the SDK namespace via
 * manuallyInstrument (required because the SDK is ESM-only), then run a real
 * query with tool uses. After running, inspect Phoenix.
 */

import { register } from "@arizeai/phoenix-otel";
import { ClaudeAgentSDKInstrumentation } from "@arizeai/openinference-instrumentation-claude-agent-sdk";
import * as ClaudeAgentSDKNS from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Instrumentation setup -------------------------------------------------

const tracerProvider = register({
  projectName: "harness-oi-probe",
  url: "http://localhost:6006",
});

// WORKAROUND: ESM namespaces are frozen in stock Node/Bun, so the Arize
// instrumentation's `target.query = wrapQuery(...)` assignment throws.
// Shallow-copy the namespace into a mutable object and instrument THAT.
// Call `query` through this mutable copy so the patched version runs.
const ClaudeAgentSDK: Record<string, unknown> = { ...ClaudeAgentSDKNS };

const instrumentation = new ClaudeAgentSDKInstrumentation();
instrumentation.manuallyInstrument(ClaudeAgentSDK as never);

const query = ClaudeAgentSDK.query as typeof ClaudeAgentSDKNS.query;
console.log("[probe] OpenInference instrumentation registered");

// --- Probe body ------------------------------------------------------------

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "phoenix-oi-probe-"));
  writeFileSync(join(dir, "alpha.txt"), "the secret word is narwhal\n");
  writeFileSync(join(dir, "beta.txt"), "the secret word is marmot\n");
  console.log(`[probe] test dir: ${dir}`);

  let sessionId: string | undefined;
  let toolUses = 0;
  let resultText = "";

  for await (const message of query({
    prompt: `In ${dir}, read all .txt files and tell me the two secret words separated by a comma. Then verify both files exist via Bash 'ls'.`,
    options: {
      model: "claude-haiku-4-5-20251001",
      cwd: dir,
      allowedTools: ["Read", "Bash", "Glob"],
      maxTurns: 6,
    },
  })) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
      console.log(`[probe] session_id: ${sessionId}`);
    }
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          toolUses++;
          console.log(`[probe] tool_use: ${block.name}`);
        }
      }
    }
    if (message.type === "result") {
      console.log(`[probe] result subtype=${message.subtype}`);
      if ("result" in message && typeof message.result === "string") {
        resultText = message.result;
      }
    }
  }

  // Give exporter time to flush before we force shutdown.
  await new Promise((r) => setTimeout(r, 2000));
  await tracerProvider.shutdown();

  console.log(`\n=== Probe summary ===`);
  console.log(`session_id : ${sessionId}`);
  console.log(`tool_uses  : ${toolUses}`);
  console.log(`result     : ${resultText.slice(0, 200)}`);
  console.log(`\nOpen http://localhost:6006 → project "harness-oi-probe"`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
