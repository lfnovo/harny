# Architecture decision records

Decision records preserve why a consequential choice was made. They complement the current architecture documentation: architecture pages describe how the system works now, while an ADR records the context, alternatives, decision, and consequences at a point in time.

## When to add an ADR

Add one when a change establishes or reverses a durable constraint, such as:

- the execution or persistence model;
- a public workflow or provider contract;
- where privileged effects may occur;
- compatibility and migration policy;
- a security boundary;
- a dependency with a significant operational trade-off.

Do not use ADRs for routine refactors, implementation details, or decisions that are easy to reverse locally.

## File convention

Use `NNNN-short-title.md`, keep accepted records immutable, and add a new record when a decision is superseded.

```markdown
# NNNN. Decision title

Status: proposed | accepted | superseded

## Context and problem

What forces make a decision necessary?

## Decision drivers

- Which properties matter most?

## Considered options

- Option A
- Option B

## Decision

What was chosen and why?

## Consequences

- Positive consequence.
- Negative consequence or accepted trade-off.

## Validation

How can we verify that the decision remains true in the implementation?
```

## Decision log

1. [Use a deterministic declarative DAG runtime](0001-declarative-runtime.md).
2. [Keep one authoritative atomic run snapshot](0002-authoritative-run-snapshot.md).
3. [Restrict commits and pull-request publication to privileged executors](0003-privileged-effects.md).
4. [Keep provider connections global and secrets environment-backed](0004-global-provider-connections.md).
5. [Persist provider usage per attempt and derive aggregates](0005-attempt-usage.md).
