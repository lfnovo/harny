/**
 * Probe: Anthropic SDK → Phoenix OTLP integration.
 *
 * Goal: confirm that turning on the SDK's built-in OpenTelemetry export and
 * pointing it at a local Phoenix instance produces useful traces in Phoenix's
 * UI without us writing any rendering code.
 *
 * Pre-req: `docker run -d --name harness-phoenix-probe -p 6006:6006 -p 4317:4317
 *           arizephoenix/phoenix:latest` (UI + OTLP HTTP both on :6006).
 *
 * What this exercises:
 *   - Multiple turns (assistant text + tool call + tool result + final text)
 *     so we get to see whether Phoenix renders tool spans well.
 *   - Both an `interaction` span (the agent loop) and `llm_request` spans
 *     (per Anthropic API call) and `tool` spans (one per tool use).
 *
 * After running, open http://localhost:6006 and inspect the trace.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PHOENIX_OTLP = "http://127.0.0.1:6006";

async function main() {
  // Create a small test directory the agent can poke at — gives us real
  // tool-use spans in the trace.
  const dir = mkdtempSync(join(tmpdir(), "phoenix-probe-"));
  writeFileSync(join(dir, "hello.txt"), "the secret word is octopus\n");
  writeFileSync(join(dir, "world.txt"), "the secret word is mango\n");
  console.log(`[probe] test dir: ${dir}`);

  const otelEnv = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_EXPORTER_OTLP_ENDPOINT: PHOENIX_OTLP,
    // Push fast so we don't depend on shutdown flush.
    OTEL_METRIC_EXPORT_INTERVAL: "1000",
    OTEL_LOGS_EXPORT_INTERVAL: "1000",
    OTEL_TRACES_EXPORT_INTERVAL: "1000",
    // Capture content too so we can see prompts/results in the UI.
    OTEL_LOG_USER_PROMPTS: "1",
    OTEL_LOG_TOOL_DETAILS: "1",
    OTEL_LOG_TOOL_CONTENT: "1",
    // Tag service so traces are easy to find.
    OTEL_SERVICE_NAME: "harness-probe",
    OTEL_RESOURCE_ATTRIBUTES: "service.version=0.0.1,deployment.environment=probe",
  };

  console.log("[probe] running query() with OTLP → Phoenix");
  let sessionId: string | undefined;
  let turns = 0;
  let toolUses = 0;
  let resultText = "";

  for await (const message of query({
    prompt: `In ${dir}, read all .txt files and tell me the two secret words separated by a comma. Then make sure both files exist via Bash 'ls'.`,
    options: {
      model: "claude-haiku-4-5-20251001",
      cwd: dir,
      allowedTools: ["Read", "Bash", "Glob"],
      maxTurns: 6,
      env: { ...process.env, ...otelEnv },
    },
  })) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
      console.log(`[probe] session_id: ${sessionId}`);
    }
    if (message.type === "assistant") {
      turns++;
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

  console.log(`\n=== Probe summary ===`);
  console.log(`session_id : ${sessionId}`);
  console.log(`turns      : ${turns}`);
  console.log(`tool_uses  : ${toolUses}`);
  console.log(`result     : ${resultText.slice(0, 200)}`);
  console.log(`\nNow open http://localhost:6006 and look for:`);
  console.log(`  - Project "harness-probe" (set via OTEL_SERVICE_NAME)`);
  console.log(`  - Trace containing claude_code.interaction span`);
  console.log(`  - Child spans: claude_code.llm_request (per API call)`);
  console.log(`  - Child spans: claude_code.tool (one per tool use)`);
  console.log(`  - Span attributes should include model, tokens, latency`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
