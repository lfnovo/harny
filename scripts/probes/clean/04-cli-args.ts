/**
 * Probe: parseArgs correctly extracts cleanSlug, cleanForce, cleanKill
 * for 'harny clean <slug>' invocations.
 *
 * RUN
 *   bun scripts/probes/clean/04-cli-args.ts
 */

import { parseArgs } from "../../../src/runner.ts";

let failures = 0;

function check(
  name: string,
  argv: string[],
  expected: { cleanSlug: string | null; cleanForce: boolean; cleanKill: boolean },
): void {
  try {
    const result = parseArgs(argv);
    if (result.cleanSlug !== expected.cleanSlug) {
      throw new Error(`cleanSlug: expected ${JSON.stringify(expected.cleanSlug)}, got ${JSON.stringify(result.cleanSlug)}`);
    }
    if (result.cleanForce !== expected.cleanForce) {
      throw new Error(`cleanForce: expected ${expected.cleanForce}, got ${result.cleanForce}`);
    }
    if (result.cleanKill !== expected.cleanKill) {
      throw new Error(`cleanKill: expected ${expected.cleanKill}, got ${result.cleanKill}`);
    }
    console.log(`PASS ${name}`);
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  }
}

check("clean-args-force", ["clean", "foo", "--force"], {
  cleanSlug: "foo",
  cleanForce: true,
  cleanKill: false,
});

check("clean-args-no-flags", ["clean", "foo"], {
  cleanSlug: "foo",
  cleanForce: false,
  cleanKill: false,
});

check("clean-args-force-kill", ["clean", "foo", "--force", "--kill"], {
  cleanSlug: "foo",
  cleanForce: true,
  cleanKill: true,
});

process.exit(failures > 0 ? 1 : 0);
