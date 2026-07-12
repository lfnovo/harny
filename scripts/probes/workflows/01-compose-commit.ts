/**
 * Probe: composeCommitMessage invariants
 *
 * RUN
 *   bun scripts/probes/workflows/01-compose-commit.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { $ } from "bun";
import { composeCommitMessage } from "../../../src/harness/workflows/composeCommit.js";

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("hard deadline exceeded")), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario (a): single-word dev trailer task=t1 → no duplicate task= in output
try {
  await Promise.race([
    (async () => {
      const name = "dedup-single-word-trailer";
      const result = composeCommitMessage({
        devMessage: "feat: x\n\ntask=t1",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 1,
        role: "validator",
        evidence: "ev",
      });
      const count = (result.match(/^task=/gm) ?? []).length;
      if (count !== 1) throw new Error(`expected 1 task= line, got ${count}`);
      if (result.includes("task=t1")) throw new Error("old task=t1 trailer not stripped");
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL dedup-single-word-trailer: ${e.message}`);
  failures++;
}

// Scenario (b): multi-word dev trailer task=Add foo bar baz → no duplicate task= in output
try {
  await Promise.race([
    (async () => {
      const name = "dedup-multi-word-trailer";
      const result = composeCommitMessage({
        devMessage: "feat: x\n\ntask=Add foo bar baz",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 1,
        role: "validator",
        evidence: "ev",
      });
      const count = (result.match(/^task=/gm) ?? []).length;
      if (count !== 1) throw new Error(`expected 1 task= line, got ${count}`);
      if (result.includes("task=Add foo bar baz")) throw new Error("multi-word trailer not stripped");
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL dedup-multi-word-trailer: ${e.message}`);
  failures++;
}

// Scenario (c): no dev trailer → exactly one task= in output
try {
  await Promise.race([
    (async () => {
      const name = "no-trailer-appends-once";
      const result = composeCommitMessage({
        devMessage: "feat: x",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 1,
        role: "validator",
        evidence: "ev",
      });
      const count = (result.match(/^task=/gm) ?? []).length;
      if (count !== 1) throw new Error(`expected exactly 1 task= line, got ${count}`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL no-trailer-appends-once: ${e.message}`);
  failures++;
}

// Scenario (d): whitespace-padded trailer task= t1  → no duplicate, exactly one task= in output
try {
  await Promise.race([
    (async () => {
      const name = "dedup-whitespace-padded-trailer";
      const result = composeCommitMessage({
        devMessage: "feat: x\n\ntask= t1 ",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 1,
        role: "validator",
        evidence: "ev",
      });
      const count = (result.match(/^task=/gm) ?? []).length;
      if (count !== 1) throw new Error(`expected 1 task= line, got ${count}`);
      if (result.includes("task= t1")) throw new Error("whitespace-padded trailer not stripped");
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL dedup-whitespace-padded-trailer: ${e.message}`);
  failures++;
}

// Scenario (e): 3-reason validator array → commit body contains exactly 3 lines starting with "  - "
try {
  await Promise.race([
    (async () => {
      const name = "bullet-evidence-three-reasons";
      const result = composeCommitMessage({
        devMessage: "feat: x",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 1,
        role: "validator",
        evidence: ["DIFF: 1 file", "AC1: pass", "AC2: pass"],
      });
      const bulletLines = result.split("\n").filter((l) => l.startsWith("  - "));
      if (bulletLines.length !== 3)
        throw new Error(`expected 3 bullet lines, got ${bulletLines.length}`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL bullet-evidence-three-reasons: ${e.message}`);
  failures++;
}

// Scenario (f): single-task plan (planTaskCount=1) → body contains task=issue-34 and NOT task=issue-34/t1
try {
  await Promise.race([
    (async () => {
      const name = "single-task-slug-no-taskid";
      const result = composeCommitMessage({
        devMessage: "feat: x",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 1,
        role: "validator",
        evidence: "ev",
      });
      if (!result.includes("task=issue-34"))
        throw new Error("task=issue-34 not found in output");
      if (result.includes("task=issue-34/t1"))
        throw new Error("task=issue-34/t1 should not appear in single-task plan");
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL single-task-slug-no-taskid: ${e.message}`);
  failures++;
}

// Scenario (g): multi-task plan (planTaskCount=3) → body contains task=issue-34/t1
try {
  await Promise.race([
    (async () => {
      const name = "multi-task-slug-with-taskid";
      const result = composeCommitMessage({
        devMessage: "feat: x",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 3,
        role: "validator",
        evidence: "ev",
      });
      if (!result.includes("task=issue-34/t1"))
        throw new Error("task=issue-34/t1 not found in multi-task output");
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL multi-task-slug-with-taskid: ${e.message}`);
  failures++;
}

// Scenario (h): empirical git interpret-trailers — validator trailer appears exactly once
try {
  await Promise.race([
    (async () => {
      const name = "git-interpret-trailers-validator-once";
      const msg = composeCommitMessage({
        devMessage: "feat: x",
        taskId: "t1",
        slug: "issue-34",
        planTaskCount: 1,
        role: "validator",
        evidence: ["DIFF: 1 file", "AC1: pass", "AC2: pass"],
      });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harny-probe-"));
      const msgFile = path.join(tmpDir, "COMMIT_EDITMSG");
      fs.writeFileSync(msgFile, msg, "utf8");

      // Init a git repo and teach it both separators so task= is recognized alongside validator:
      await $`git init ${tmpDir}`.quiet();
      await $`git config trailer.separators ':='`.cwd(tmpDir).quiet();

      const parsed = await $`git interpret-trailers --parse < ${msgFile}`.cwd(tmpDir).quiet();
      const stdout = parsed.stdout.toString();
      const validatorLines = stdout
        .split("\n")
        .filter((l) => l.startsWith("validator"));

      if (validatorLines.length !== 1)
        throw new Error(
          `expected exactly 1 validator trailer line, got ${validatorLines.length}: ${JSON.stringify(validatorLines)}`,
        );
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL git-interpret-trailers-validator-once: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
