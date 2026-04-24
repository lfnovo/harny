/**
 * Probe template — canonical starting point for new engine probes.
 *
 * Copy this file, rename to NN-<description>.ts (leading digit required),
 * fill in your scenarios, then delete this comment block.
 * Do not edit in place — this file is the master template.
 *
 * RUN
 *   bun scripts/probes/_template.ts
 *
 * NOTE: The CI runner (scripts/run-probes.ts) filters by /^\d+[a-z]?-.+\.ts$/
 * so this file is intentionally excluded from the probe suite.
 */

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario (a): replace with your first invariant check
try {
  await Promise.race([
    (async () => {
      const name = 'placeholder-scenario-a';
      const value = 1 + 1;
      if (value !== 2) throw new Error(`expected 2, got ${value}`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL placeholder-scenario-a: ${e.message}`);
  failures++;
}

// Scenario (b): replace with your second invariant check
try {
  await Promise.race([
    (async () => {
      const name = 'placeholder-scenario-b';
      const value = typeof 'hello';
      if (value !== 'string') throw new Error(`expected 'string', got '${value}'`);
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL placeholder-scenario-b: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
