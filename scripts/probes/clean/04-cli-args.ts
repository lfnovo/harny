/**
 * Probe: parseArgs correctly builds a RegistryCmd of kind 'clean' with
 * slug, force, and kill for 'harny clean <slug>' invocations.
 *
 * RUN
 *   bun scripts/probes/clean/04-cli-args.ts
 */

import { parseArgs } from "../../../src/runner.ts";

let failures = 0;

function check(
  name: string,
  argv: string[],
  expected: { slug: string; force?: boolean; kill?: boolean },
): void {
  try {
    const result = parseArgs(argv);
    const cmd = result.registryCmd;
    if (!cmd || cmd.kind !== "clean") {
      throw new Error(`expected registryCmd.kind='clean', got ${cmd?.kind ?? "null"}`);
    }
    if (cmd.slug !== expected.slug) {
      throw new Error(`slug: expected ${JSON.stringify(expected.slug)}, got ${JSON.stringify(cmd.slug)}`);
    }
    if (!!cmd.force !== !!(expected.force ?? false)) {
      throw new Error(`force: expected ${expected.force ?? false}, got ${cmd.force ?? false}`);
    }
    if (!!cmd.kill !== !!(expected.kill ?? false)) {
      throw new Error(`kill: expected ${expected.kill ?? false}, got ${cmd.kill ?? false}`);
    }
    console.log(`PASS ${name}`);
  } catch (e: unknown) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failures++;
  }
}

check("clean-args-force", ["clean", "foo", "--force"], {
  slug: "foo",
  force: true,
  kill: false,
});

check("clean-args-no-flags", ["clean", "foo"], {
  slug: "foo",
  force: false,
  kill: false,
});

check("clean-args-force-kill", ["clean", "foo", "--force", "--kill"], {
  slug: "foo",
  force: true,
  kill: true,
});

process.exit(failures > 0 ? 1 : 0);
