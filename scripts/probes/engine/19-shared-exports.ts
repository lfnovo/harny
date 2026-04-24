/**
 * Probe: shared-exports — verifies DEFAULT_PLANNER, DEFAULT_DEVELOPER, DEFAULT_VALIDATOR,
 * PlannerVerdictSchema, DeveloperVerdictSchema are all importable from the new shared.ts
 * location and have expected shapes.
 *
 * RUN
 *   bun scripts/probes/engine/19-shared-exports.ts
 */

import {
  DEFAULT_PLANNER,
  DEFAULT_DEVELOPER,
  DEFAULT_VALIDATOR,
  PlannerVerdictSchema,
  DeveloperVerdictSchema,
} from '../../../src/harness/engine/workflows/featureDev/shared.ts';

const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

// Scenario (a): DEFAULT_PLANNER, DEFAULT_DEVELOPER, DEFAULT_VALIDATOR are defined
try {
  await Promise.race([
    (async () => {
      const name = 'phase-configs-defined';
      if (!DEFAULT_PLANNER) throw new Error('DEFAULT_PLANNER is undefined');
      if (!DEFAULT_DEVELOPER) throw new Error('DEFAULT_DEVELOPER is undefined');
      if (!DEFAULT_VALIDATOR) throw new Error('DEFAULT_VALIDATOR is undefined');
      if (typeof DEFAULT_PLANNER.prompt !== 'string' || DEFAULT_PLANNER.prompt.length === 0) {
        throw new Error('DEFAULT_PLANNER.prompt is empty or not a string');
      }
      if (typeof DEFAULT_DEVELOPER.prompt !== 'string' || DEFAULT_DEVELOPER.prompt.length === 0) {
        throw new Error('DEFAULT_DEVELOPER.prompt is empty or not a string');
      }
      if (typeof DEFAULT_VALIDATOR.prompt !== 'string' || DEFAULT_VALIDATOR.prompt.length === 0) {
        throw new Error('DEFAULT_VALIDATOR.prompt is empty or not a string');
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL phase-configs-defined: ${e.message}`);
  failures++;
}

// Scenario (b): PlannerVerdictSchema is a Zod schema with .parse
try {
  await Promise.race([
    (async () => {
      const name = 'planner-verdict-schema-is-zod';
      if (!PlannerVerdictSchema) throw new Error('PlannerVerdictSchema is undefined');
      if (typeof PlannerVerdictSchema.parse !== 'function') {
        throw new Error('PlannerVerdictSchema.parse is not a function');
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL planner-verdict-schema-is-zod: ${e.message}`);
  failures++;
}

// Scenario (c): DeveloperVerdictSchema is a Zod schema with .parse
try {
  await Promise.race([
    (async () => {
      const name = 'developer-verdict-schema-is-zod';
      if (!DeveloperVerdictSchema) throw new Error('DeveloperVerdictSchema is undefined');
      if (typeof DeveloperVerdictSchema.parse !== 'function') {
        throw new Error('DeveloperVerdictSchema.parse is not a function');
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL developer-verdict-schema-is-zod: ${e.message}`);
  failures++;
}

// Scenario (d): prompt guidance phrases are present
try {
  await Promise.race([
    (async () => {
      const name = 'prompt-guidance-phrases';
      if (!DEFAULT_DEVELOPER.prompt.includes('EDIT VS WRITE')) {
        throw new Error('DEFAULT_DEVELOPER.prompt does not contain "EDIT VS WRITE"');
      }
      if (!DEFAULT_VALIDATOR.prompt.includes('harny-probe-')) {
        throw new Error('DEFAULT_VALIDATOR.prompt does not contain "harny-probe-"');
      }
      console.log(`PASS ${name}`);
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL prompt-guidance-phrases: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
