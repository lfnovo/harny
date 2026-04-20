import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  const events: Array<{ when: string; detail: unknown }> = [];

  const result = query({
    prompt:
      "Run the shell command `echo harness-probe-ok` using the Bash tool, then stop.",
    options: {
      model: "claude-haiku-4-5-20251001",
      permissionMode: "bypassPermissions",
      allowedTools: ["Bash"],
      maxTurns: 3,
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              async (input: unknown, toolUseId: string | undefined) => {
                events.push({
                  when: "PreToolUse",
                  detail: { toolUseId, input },
                });
                console.log("[HOOK] PreToolUse fired for Bash");
                return { continue: true };
              },
            ],
          },
        ],
      },
    },
  });

  let finalSubtype: string | undefined;
  for await (const msg of result) {
    if (msg.type === "result") {
      finalSubtype = (msg as { subtype?: string }).subtype;
      break;
    }
  }

  console.log("\n=== PROBE RESULT ===");
  console.log("final result subtype:", finalSubtype);
  console.log("hook events captured:", events.length);
  console.log(JSON.stringify(events, null, 2));
  if (events.length > 0) {
    console.log("\nCONCLUSION: hooks DO fire in Single Message Input mode.");
  } else {
    console.log(
      "\nCONCLUSION: hooks did NOT fire in Single Message Input mode.",
    );
  }
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
