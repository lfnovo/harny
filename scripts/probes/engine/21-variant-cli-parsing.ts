/**
 * Probe: variant CLI parsing — pure string logic, zero IO.
 * Validates the workflowArg.split(':') logic for three cases.
 *
 * RUN
 *   bun scripts/probes/engine/21-variant-cli-parsing.ts
 */

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario (a): 'feature-dev:just-bugs' → id='feature-dev', variant='just-bugs'
try {
  await Promise.race([
    (async () => {
      const name = 'colon-splits-id-and-variant';
      const workflowArg = 'feature-dev:just-bugs';
      const parts = workflowArg.split(':');
      const baseWorkflowId = parts[0] ?? 'feature-dev';
      const variant = parts[1] ?? 'default';
      if (baseWorkflowId !== 'feature-dev') {
        throw new Error(`expected 'feature-dev', got '${baseWorkflowId}'`);
      }
      if (variant !== 'just-bugs') {
        throw new Error(`expected 'just-bugs', got '${variant}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL colon-splits-id-and-variant: ${e.message}`);
  failures++;
}

// Scenario (b): 'feature-dev' → id='feature-dev', variant='default'
try {
  await Promise.race([
    (async () => {
      const name = 'no-colon-defaults-variant';
      const workflowArg = 'feature-dev';
      const parts = workflowArg.split(':');
      const baseWorkflowId = parts[0] ?? 'feature-dev';
      const variant = parts[1] ?? 'default';
      if (baseWorkflowId !== 'feature-dev') {
        throw new Error(`expected 'feature-dev', got '${baseWorkflowId}'`);
      }
      if (variant !== 'default') {
        throw new Error(`expected 'default', got '${variant}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL no-colon-defaults-variant: ${e.message}`);
  failures++;
}

// Scenario (c): no-flag default → workflowArg falls back to 'feature-dev', variant='default'
try {
  await Promise.race([
    (async () => {
      const name = 'default-workflow-no-flag';
      // Simulates: args.workflowId is undefined, falls back to 'feature-dev'
      const workflowArg = (null as string | null) ?? 'feature-dev';
      const parts = workflowArg.split(':');
      const baseWorkflowId = parts[0] ?? 'feature-dev';
      const variant = parts[1] ?? 'default';
      if (baseWorkflowId !== 'feature-dev') {
        throw new Error(`expected 'feature-dev', got '${baseWorkflowId}'`);
      }
      if (variant !== 'default') {
        throw new Error(`expected 'default', got '${variant}'`);
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL default-workflow-no-flag: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
