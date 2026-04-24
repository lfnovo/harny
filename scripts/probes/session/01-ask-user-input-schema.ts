/**
 * Probe: AskUserQuestion input schema — 2 scenarios, zero real Claude calls.
 *
 * RUN
 *   bun scripts/probes/session/01-ask-user-input-schema.ts
 */

import { AskUserQuestionInputSchema } from "../../../src/harness/askUser.ts";

const DEADLINE_MS = 1000;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario 1: valid-input-parses
try {
  await Promise.race([
    (async () => {
      const name = "valid-input-parses";
      const input = {
        questions: [
          {
            question: "What is your preference?",
            options: [{ label: "Option A" }, { label: "Option B" }],
          },
        ],
      };
      const result = AskUserQuestionInputSchema.safeParse(input);
      if (result.success !== true) {
        throw new Error(
          `expected success=true, got errors: ${JSON.stringify(result.error)}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL valid-input-parses: ${e.message}`);
  failures++;
}

// Scenario 2: malformed-input-error-message
try {
  await Promise.race([
    (async () => {
      const name = "malformed-input-error-message";
      const input = {}; // missing required 'questions'
      const result = AskUserQuestionInputSchema.safeParse(input);
      if (result.success !== false) {
        throw new Error("expected success=false for malformed input");
      }
      const issue = result.error.issues[0];
      if (!issue) throw new Error("expected at least one ZodIssue");
      const path = issue.path.reduce<string>((acc, seg) => {
        if (typeof seg === "number") return `${acc}[${seg}]`;
        const s = String(seg);
        return acc ? `${acc}.${s}` : s;
      }, "");
      const message = `AskUserQuestion input invalid: ${path || "input"} — ${issue.message}`;
      if (!message.includes("questions")) {
        throw new Error(
          `expected message to contain 'questions', got: ${message}`,
        );
      }
      // Accept messages from both Zod v3 ("Required", "invalid_type") and
      // Zod v4 ("Invalid input: expected …", "Invalid input").
      if (!/Required|invalid_type|Invalid|expected/i.test(message)) {
        throw new Error(
          `expected message to contain a human-readable issue word, got: ${message}`,
        );
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL malformed-input-error-message: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
