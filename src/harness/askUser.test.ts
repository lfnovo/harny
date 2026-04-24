import { describe, test, expect } from "bun:test";
import { AskUserQuestionInputSchema } from "./askUser.js";

describe("AskUserQuestionInputSchema", () => {
  test("parses a valid input with one question + two options", () => {
    const input = {
      questions: [
        {
          question: "What is your preference?",
          options: [{ label: "Option A" }, { label: "Option B" }],
        },
      ],
    };
    const result = AskUserQuestionInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  test("rejects malformed input (missing 'questions') with a human-readable issue", () => {
    const result = AskUserQuestionInputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0]!;
    const path = issue.path.reduce<string>((acc, seg) => {
      if (typeof seg === "number") return `${acc}[${seg}]`;
      const s = String(seg);
      return acc ? `${acc}.${s}` : s;
    }, "");
    const message = `AskUserQuestion input invalid: ${path || "input"} — ${issue.message}`;
    expect(message).toContain("questions");
    // Accept messages from Zod v4 (prose) or v3 (tokens) — keeps the test
    // resilient across major bumps.
    expect(message).toMatch(/Required|invalid_type|Invalid|expected/i);
  });
});
