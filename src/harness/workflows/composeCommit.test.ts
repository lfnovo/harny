import { describe, test, expect } from "bun:test";
import { composeCommitMessage } from "./composeCommit.js";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

describe("composeCommitMessage", () => {
  test("no-existing-trailer: appends task= and role: evidence once", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x",
      taskId: "t1",
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=t1")).toBe(1);
    expect(result.endsWith("task=t1\nvalidator: ev")).toBe(true);
  });

  test("one-existing-trailer: does not duplicate task=", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t1",
      taskId: "t1",
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=t1")).toBe(1);
  });

  test("two-existing-trailers: collapses to exactly one", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t1\ntask=t1",
      taskId: "t1",
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=t1")).toBe(1);
  });

  test("different-id-existing: strips old id, appends new id", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t999",
      taskId: "t1",
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=t1")).toBe(1);
    expect(countOccurrences(result, "task=t999")).toBe(0);
  });

  test("reviewer role: uses reviewer: prefix, not validator:", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t1",
      taskId: "t1",
      role: "reviewer",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=t1")).toBe(1);
    expect(result).toContain("reviewer: ev");
    expect(result).not.toContain("validator:");
  });
});
