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
  // --- existing tests updated with new required parameters ---

  test("no-existing-trailer: appends task= and role: evidence once", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
    expect(result.endsWith("task=issue-34\nvalidator: ev")).toBe(true);
  });

  test("one-existing-trailer: does not duplicate task=", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t1",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
  });

  test("two-existing-trailers: collapses to exactly one", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t1\ntask=t1",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
  });

  test("different-id-existing: strips old id, appends new slug", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t999",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
    expect(countOccurrences(result, "task=t999")).toBe(0);
  });

  test("reviewer role: uses reviewer: prefix, not validator:", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t1",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "reviewer",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
    expect(result).toContain("reviewer: ev");
    expect(result).not.toContain("validator:");
  });

  // --- dedup scenarios (a)-(d) ---

  test("dedup (a): dev trailer task=t1 (single-word) is stripped, not duplicated", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=t1",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=")).toBe(1);
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
    expect(countOccurrences(result, "task=t1")).toBe(0);
  });

  test("dedup (b): dev trailer task=Add foo bar baz (multi-word) is stripped, not duplicated", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask=Add foo bar baz",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=")).toBe(1);
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
    expect(countOccurrences(result, "task=Add foo bar baz")).toBe(0);
  });

  test("dedup (c): no dev task= trailer - composer appends it once", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=")).toBe(1);
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
  });

  test("dedup (d): whitespace-padded trailer task= t1  is stripped, not duplicated", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x\n\ntask= t1 ",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(countOccurrences(result, "task=issue-34")).toBe(1);
    expect(countOccurrences(result, "task= t1")).toBe(0);
  });

  // --- validator bullet formatting ---

  test("evidence array produces indented bullet list under validator:", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: ["DIFF: 1 file", "AC1: pass", "AC2: pass"],
    });
    expect(result).toContain("validator:\n  - DIFF: 1 file\n  - AC1: pass\n  - AC2: pass");
  });

  // --- reviewer backward compat ---

  test("reviewer role with string evidence produces single-line reviewer: ev", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "reviewer",
      evidence: "ev",
    });
    expect(result).toContain("reviewer: ev");
    expect(result).not.toContain("reviewer:\n");
  });

  // --- slug trailer format ---

  test("single-task plan (planTaskCount=1) emits task=<slug> without taskId", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 1,
      role: "validator",
      evidence: "ev",
    });
    expect(result).toContain("task=issue-34");
    expect(result).not.toContain("task=issue-34/t1");
  });

  test("multi-task plan (planTaskCount=3) emits task=<slug>/<taskId>", () => {
    const result = composeCommitMessage({
      devMessage: "feat: x",
      taskId: "t1",
      slug: "issue-34",
      planTaskCount: 3,
      role: "validator",
      evidence: "ev",
    });
    expect(result).toContain("task=issue-34/t1");
  });
});
