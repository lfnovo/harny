# 0001. Use a deterministic declarative DAG runtime

Status: accepted

## Context and problem

The original execution engine tied feature development to one provider and encoded control flow in an XState-specific implementation. Harny needs user-defined workflows, multiple providers, inspectable recovery, and a smaller local runtime.

## Decision drivers

- Provider-neutral workflow definitions.
- Predictable ordering and persisted recovery.
- Static validation before workspace or provider cost.
- A small implementation that can be characterized end to end.

## Considered options

- Keep XState as the public workflow engine.
- Implement a sequential persisted DAG scheduler.
- Encode orchestration inside agent prompts.

## Decision

Use normalized YAML DAGs and a custom scheduler that executes one ready node at a time in declaration order. `depends_on` preserves graph semantics; v2 intentionally excludes parallel execution.

## Consequences

- Runtime behavior is easy to reason about and recover.
- Workflows can be validated independently of provider SDKs.
- Parallelism and arbitrary scripting remain unavailable.
- Scheduler correctness and persistence boundaries are Harny's responsibility.

## Validation

Schema/loader tests, scheduler ordering/recovery tests, and bundled workflow characterization tests must pass without XState.
