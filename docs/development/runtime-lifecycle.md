# Runtime lifecycle

## New run

1. CLI resolves cwd, prompt, workflow spec, variant, mode, isolation, and slug.
2. Loader resolves and parses YAML.
3. Provider config loads from the user-global file.
4. Static validation checks graph, references, policies, outcome, and capabilities.
5. Orchestrator validates Git and checks for an existing slug.
6. Workspace provider creates inline context or branch/worktree.
7. `RunStore` atomically creates v4 state and appends `run.created`.
8. Global pointer is written best-effort.
9. Scheduler loads persisted execution and selects one ready node.
10. It persists a running attempt before invoking an executor.
11. Provider session/usage metadata is persisted as soon as available.
12. Completion, failure, retry, pause, or cancellation is persisted.
13. Final lifecycle, pointer, and workspace reservation are updated.

## Agent attempt

The declarative runner resolves provider and prior compatible session, builds a normalized request, then invokes `run` or `resume`. Provider errors can report partial metadata. Special developer and validator roles wrap the provider call with ChangeSet checks.

## Interruption

At startup, a persisted running node is treated as interrupted. Its current attempt becomes failed with an interruption reason and the node returns to pending. Usage already reported remains. Nested completed steps remain checkpoints.

## Human pause

The executor throws a typed pause carrying question and session. Scheduler marks the node and attempt paused; orchestrator leaves end time null and workspace reserved. `answer` changes the relevant instance back to pending or completed and invokes the same continuation path.

## Terminal cleanup

Success removes an isolated worktree. Failure preserves it. Branches and state remain until explicit `harny clean` so users can review evidence and code.
