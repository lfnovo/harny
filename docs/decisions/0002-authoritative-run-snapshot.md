# 0002. Keep one authoritative atomic run snapshot

Status: accepted

## Context and problem

Mirrored plan, engine context, and registry state can disagree after crashes or partial writes. Recovery needs one answer for the current scheduler state.

## Decision drivers

- Local-first operation without a database or daemon.
- Atomic recovery boundaries.
- Readable evidence for CLI and viewer.
- No duplicated aggregate lifecycle state.

## Considered options

- Event sourcing from append-only history.
- Separate plan and runtime files.
- One atomic `run.json` plus audit-only events.

## Decision

`run.json` v4 is the sole authoritative snapshot. `events.jsonl` is append-only audit data. Global run pointers are rebuildable discovery indexes. Outputs live only on producing nodes, and usage totals are derived from attempts.

## Consequences

- Recovery reads one schema-validated file.
- Events can be incomplete without corrupting execution.
- Every mutation rewrites the snapshot atomically.
- Historical schemas are not resumable under the current compatibility policy.

## Validation

RunStore atomicity, schema rejection, interruption recovery, RunView derivation, and pointer rebuild tests enforce the decision.
