/**
 * Probe: composeCommitMessage — 5 scenarios, 1500ms each, under 4s total.
 *
 * RUN
 *   bun scripts/probes/workflows/01-compose-commit.ts
 */

import { composeCommitMessage } from "../../../src/harness/workflows/composeCommit.ts";

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms),
  );
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

const startMs = Date.now();
let failures = 0;

// (a) no-existing-trailer
{
  const name = "no-existing-trailer";
  try {
    const result = await Promise.race([
      Promise.resolve(composeCommitMessage({ devMessage: "feat: x", taskId: "t1", role: "validator", evidence: "ev" })),
      timeout(1500),
    ]);
    const count = countOccurrences(result, "task=t1");
    if (count === 1 && result.endsWith("task=t1\nvalidator: ev")) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: count=${count} result=${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  }
}

// (b) one-existing-trailer
{
  const name = "one-existing-trailer";
  try {
    const result = await Promise.race([
      Promise.resolve(composeCommitMessage({ devMessage: "feat: x\n\ntask=t1", taskId: "t1", role: "validator", evidence: "ev" })),
      timeout(1500),
    ]);
    const count = countOccurrences(result, "task=t1");
    if (count === 1) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected exactly 1 'task=t1', got ${count} in ${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  }
}

// (c) two-existing-trailers
{
  const name = "two-existing-trailers";
  try {
    const result = await Promise.race([
      Promise.resolve(composeCommitMessage({ devMessage: "feat: x\n\ntask=t1\ntask=t1", taskId: "t1", role: "validator", evidence: "ev" })),
      timeout(1500),
    ]);
    const count = countOccurrences(result, "task=t1");
    if (count === 1) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: expected exactly 1 'task=t1', got ${count} in ${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  }
}

// (d) different-id-existing
{
  const name = "different-id-existing";
  try {
    const result = await Promise.race([
      Promise.resolve(composeCommitMessage({ devMessage: "feat: x\n\ntask=t999", taskId: "t1", role: "validator", evidence: "ev" })),
      timeout(1500),
    ]);
    const countT1 = countOccurrences(result, "task=t1");
    const countT999 = countOccurrences(result, "task=t999");
    if (countT1 === 1 && countT999 === 0) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: task=t1 count=${countT1} task=t999 count=${countT999} result=${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  }
}

// (e) reviewer-role
{
  const name = "reviewer-role";
  try {
    const result = await Promise.race([
      Promise.resolve(composeCommitMessage({ devMessage: "feat: x\n\ntask=t1", taskId: "t1", role: "reviewer", evidence: "ev" })),
      timeout(1500),
    ]);
    const countT1 = countOccurrences(result, "task=t1");
    const hasReviewer = result.includes("reviewer: ev");
    const hasValidator = result.includes("validator:");
    if (countT1 === 1 && hasReviewer && !hasValidator) {
      console.log(`PASS ${name}`);
    } else {
      console.log(`FAIL ${name}: countT1=${countT1} hasReviewer=${hasReviewer} hasValidator=${hasValidator} result=${JSON.stringify(result)}`);
      failures++;
    }
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  }
}

const elapsedMs = Date.now() - startMs;
console.log(`total elapsed: ${elapsedMs}ms`);
if (elapsedMs > 4000) {
  console.log("FAIL: total elapsed exceeded 4000ms");
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
