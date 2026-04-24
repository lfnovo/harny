# Probe Authoring Guide

Probes are standalone Bun scripts that validate harness behavior without making real Claude/SDK calls. This guide captures the conventions and traps every probe author needs to know.

## Running a probe

```
bun scripts/probes/<subdir>/<probe>.ts
```

Exit 0 means all scenarios passed. Exit 1 means at least one failed. Validators re-run probes and read exit code, so output lines must stay machine-parseable.

## Probe shape contract

Every probe follows the same skeleton:

```
N scenarios, each raced against a 1500 ms hardDeadline()
Total wall-clock target: under 8 s (usually under 5 s)
Sole exit point: process.exit(failures > 0 ? 1 : 0)
```

The canonical starting point is `_templates/validator-smoke.ts`. Copy it, rename it, fill in the fixture data. Do not invent a new structure from scratch.

### Required stdout format

Each scenario must emit exactly one of:

```
PASS <scenario-name>
FAIL <scenario-name>: <reason>
```

The `PASS`/`FAIL` prefix is load-bearing — validators parse it. Do not emit other formats or omit the prefix.

### Canonical structure

```typescript
const DEADLINE_MS = 1500;

function hardDeadline(): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error('hard deadline exceeded')), DEADLINE_MS),
  );
}

let failures = 0;

try {
  await Promise.race([
    (async () => {
      // scenario logic
      console.log('PASS <name>');
    })(),
    hardDeadline(),
  ]);
} catch (e: any) {
  console.log(`FAIL <name>: ${e.message}`);
  failures++;
}

process.exit(failures > 0 ? 1 : 0);
```

Each scenario is an independent `try/catch` block — a failure in one must not prevent later scenarios from running.

## Race-wrapper guidance

`Promise.race([scenario, hardDeadline()])` is required for I/O-bound scenarios: filesystem reads, child-process spawning, network calls, or anything that can hang indefinitely.

Pure-sync computations — string transforms, Zod validation, in-memory logic — cannot hang, so the race wrapper adds noise without safety. Wrapping them is acceptable but not required. Current probes wrap unconditionally; that is fine, just know it is optional for sync-only code.

## Regex traps

### Import-path false positives

A naive pattern like `harnyActions\.(\w+)` matches more than you expect. Consider a workflow file that contains:

```typescript
import { harnyActions } from '../harnyActions.js';
```

The string literal `'../harnyActions.js'` contains `harnyActions.js`, which matches `harnyActions\.(\w+)` — a false positive that reports `js` as an action key reference.

**Fix:** add a negative lookbehind on `/` before the identifier:

```
/(?<!\/)harnyActions\.(\w+)/g
```

The `(?<!\/)` guard rejects any match where `harnyActions` is preceded by `/`, which is always the case inside a path segment but never the case at a real call site.

Concrete example: `engine/07-actions-contract.ts` line 61 uses this pattern to scan workflow files for undefined action references without accidentally matching import paths.

**General rule:** when writing a regex to match a dotted identifier (`foo\.bar`) in source text that may also appear in import paths, guard with `(?<!\/)` (or an equivalent negative lookbehind) before the leading word.
