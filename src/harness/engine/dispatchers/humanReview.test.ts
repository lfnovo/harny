import { describe, test, expect } from "bun:test";
import { runHumanReview } from "./humanReview.js";
import type {
  HumanReviewRunOptions,
  HumanReviewOutput,
} from "../types.js";

describe("runHumanReview: happy paths", () => {
  test("text answer passes through from askProvider", async () => {
    const controller = new AbortController();
    const expected: HumanReviewOutput = { kind: "text", value: "looks good" };
    const opts: HumanReviewRunOptions = {
      message: "Please review",
      askProvider: () => Promise.resolve(expected),
    };
    const result = await runHumanReview(opts, controller.signal);
    expect(result.kind).toBe("text");
    expect((result as any).value).toBe("looks good");
  });

  test("option pick passes through from askProvider", async () => {
    const controller = new AbortController();
    const expected: HumanReviewOutput = { kind: "option", value: "option_b" };
    const opts: HumanReviewRunOptions = {
      message: "Pick an option",
      options: [
        { value: "option_a", label: "Option A" },
        { value: "option_b", label: "Option B" },
      ],
      askProvider: () => Promise.resolve(expected),
    };
    const result = await runHumanReview(opts, controller.signal);
    expect(result.kind).toBe("option");
    expect((result as any).value).toBe("option_b");
  });
});

describe("runHumanReview: abort + error propagation", () => {
  test("AbortController fires → rejects with 'aborted'", async () => {
    const controller = new AbortController();
    const opts: HumanReviewRunOptions = {
      message: "Waiting forever",
      askProvider: ({ signal }) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("inner aborted")));
        }),
    };
    setTimeout(() => controller.abort(), 50);
    await expect(runHumanReview(opts, controller.signal)).rejects.toThrow(
      /aborted/,
    );
  });

  test("askProvider rejection is propagated with original message", async () => {
    const controller = new AbortController();
    const opts: HumanReviewRunOptions = {
      message: "Will fail",
      askProvider: () => Promise.reject(new Error("provider boom")),
    };
    await expect(runHumanReview(opts, controller.signal)).rejects.toThrow(
      /provider boom/,
    );
  });
});
