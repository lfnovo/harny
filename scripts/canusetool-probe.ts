/**
 * Tier 3b probe: confirm SDK canUseTool deny+resume semantics for AskUserQuestion.
 *
 * Questions to answer:
 *  1. When canUseTool returns {behavior:"deny", interrupt:true} for AskUserQuestion,
 *     does the for-await loop terminate? What's the result.subtype?
 *  2. Same with interrupt:false (or omitted). Different?
 *  3. If we resume the session and inject the answer as a user message, does the
 *     model proceed or re-call AskUserQuestion?
 *
 * Findings (run 2026-04-21, claude-haiku-4-5):
 *
 *   A. deny WITHOUT interrupt:
 *      - Loop CONTINUES. Model receives the deny message as a synthetic user/tool_result,
 *        falls back to picking a default itself, and the run completes normally
 *        with subtype="success".
 *      - Useful for silent-via-deny if we ever want it, but kills the "park"
 *        intent because the model proceeds anyway.
 *
 *   B. deny WITH interrupt:true:
 *      - Loop TERMINATES with subtype="error_during_execution" and the iterator
 *        THROWS:  Error: Claude Code returned an error result: [ede_diagnostic]
 *                 result_type=user last_content_type=n/a stop_reason=null
 *      - Model emits NO further turns after the deny. Clean park signal.
 *      - This is what async mode uses.
 *
 *   C. resume(A) with prompt prefix carrying the answer:
 *      - resume: <sessionId-from-A> works. Model does NOT re-call
 *        AskUserQuestion. Reads the injected answer from the new user message,
 *        proceeds to a final assistant turn, subtype="success".
 *
 *   D. resume(B — the interrupted/error session) with prompt prefix carrying
 *      the answer:
 *      - resume STILL works after error_during_execution termination.
 *        Model integrates the injected answer and finishes cleanly.
 *      - Confirms our design: park = deny+interrupt (B-style), resume = new
 *        query with resume:sessionId + prompt prefix injecting the Q&A.
 *
 *   Design implications locked in:
 *   - Async park returns {behavior:"deny", interrupt:true}. sessionRecorder
 *     catches the thrown Error AND/OR detects subtype="error_during_execution"
 *     in combination with a closure-captured parkState flag.
 *   - Silent mode strips AskUserQuestion from allowedTools (cleanest; no
 *     wasted turns). Falling back to deny-without-interrupt would also work
 *     but is slower and noisier.
 *   - Resume reuses session_id; the prompt prefix carries the Q&A; the model
 *     does not need any synthetic tool_result injection.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

type EventLog = Array<{ when: string; detail: unknown }>;

async function runScenario(
  label: string,
  opts: {
    interrupt: boolean | undefined;
    resumeSessionId?: string;
    extraPromptPrefix?: string;
  },
): Promise<{ sessionId: string | null; subtype: string | null; events: EventLog }> {
  console.log(`\n=== Scenario: ${label} ===`);
  const events: EventLog = [];
  let sessionId: string | null = null;
  let subtype: string | null = null;
  let askedToolUseId: string | undefined;

  const userPrompt =
    (opts.extraPromptPrefix ?? "") +
    "Help me pick a CTA button color for a fintech landing page. " +
    "If you are uncertain about user preferences, USE the AskUserQuestion tool with 1-2 multi-choice questions. " +
    "Otherwise just decide. After deciding, write a single sentence stating the choice.";

  const q = query({
    prompt: userPrompt,
    options: {
      model: "claude-haiku-4-5-20251001",
      permissionMode: "bypassPermissions",
      allowedTools: ["AskUserQuestion"],
      maxTurns: 5,
      ...(opts.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        ctx: { signal: AbortSignal; toolUseID?: string },
      ) => {
        events.push({
          when: "canUseTool",
          detail: { toolName, toolUseId: ctx.toolUseID, input },
        });
        if (toolName === "AskUserQuestion") {
          askedToolUseId = ctx.toolUseID;
          if (opts.interrupt === undefined) {
            return { behavior: "deny", message: "Parked." };
          }
          return {
            behavior: "deny",
            message: "Parked.",
            interrupt: opts.interrupt,
          };
        }
        return { behavior: "allow", updatedInput: input };
      },
    },
  });

  try {
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init" && sessionId === null) {
        sessionId = (msg as { session_id?: string }).session_id ?? null;
      }
      if (msg.type === "result") {
        subtype = (msg as { subtype?: string }).subtype ?? null;
      }
      events.push({ when: "msg", detail: { type: msg.type, subtype: (msg as { subtype?: string }).subtype } });
    }
  } catch (err) {
    events.push({ when: "loop-throw", detail: String(err) });
  }

  console.log(`  sessionId=${sessionId}`);
  console.log(`  subtype=${subtype}`);
  console.log(`  asked toolUseId=${askedToolUseId ?? "<none>"}`);
  console.log(`  events:`);
  for (const e of events) {
    console.log(`    [${e.when}] ${JSON.stringify(e.detail)}`);
  }
  return { sessionId, subtype, events };
}

async function main() {
  // Scenario A: deny without interrupt flag
  const a = await runScenario("A: deny, no interrupt flag", { interrupt: undefined });

  // Scenario B: deny with interrupt:true
  const b = await runScenario("B: deny, interrupt:true", { interrupt: true });

  // Scenario C: resume session A with an injected answer
  if (a.sessionId) {
    await runScenario("C: resume A with injected answer", {
      interrupt: undefined,
      resumeSessionId: a.sessionId,
      extraPromptPrefix:
        "The user already answered: choose 'electric blue'. Use that answer; do NOT call AskUserQuestion again. ",
    });
  } else {
    console.log("\nSkipping scenario C — no sessionId from A");
  }

  // Scenario D: resume session B with an injected answer
  if (b.sessionId) {
    await runScenario("D: resume B with injected answer", {
      interrupt: undefined,
      resumeSessionId: b.sessionId,
      extraPromptPrefix:
        "The user already answered: choose 'forest green'. Use that answer; do NOT call AskUserQuestion again. ",
    });
  } else {
    console.log("\nSkipping scenario D — no sessionId from B");
  }
}

main().catch((err) => {
  console.error("PROBE ERROR:", err);
  process.exit(1);
});
