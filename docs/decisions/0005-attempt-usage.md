# 0005. Persist provider usage per attempt and derive aggregates

Status: accepted

## Context and problem

Users need usage visibility, including failed retries. A run-level counter can lose attribution, double count recovery, or drift from provider evidence.

## Decision drivers

- Preserve billed work even when higher-level execution fails.
- Attribute usage to provider, model, node, and attempt.
- Avoid invented cost.
- Keep one authoritative state model.

## Considered options

- Persist only final run totals.
- Emit usage only to an external telemetry system.
- Persist normalized attempt usage and derive views.

## Decision

Write normalized usage to the running attempt immediately after provider completion or partial failure/pause. Derive node, provider, and run totals in `RunView`. Sum only provider-reported cost and expose complete, partial, or none coverage.

## Consequences

- Failed and interrupted attempts remain visible.
- Aggregation cannot diverge from attempt evidence.
- Codex token usage can coexist with absent cost.
- State grows with attempt history, which is already required for recovery and audit.

## Validation

Retry persistence, mixed-provider coverage, pause usage, recovery, and RunView tests enforce the decision.
