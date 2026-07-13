# Testing strategy

Harny tests contracts at several boundaries.

## Unit contracts

- Workflow schema and static validation.
- Scheduler readiness, skip, retry, foreach, timeout, cancel, pause, and interruption.
- Provider normalization and resume safety.
- ChangeSet equality and staging.
- State atomicity, pointers, views, usage, and leases.
- Forge idempotency and remote divergence.

## Characterization tests

Feature workflow tests use fake providers and temporary Git repositories to assert user-visible behavior: one/many tasks, retry then pass, blocked roles, exhaustion, empty diff, worktree policy, exact committed content, and terminal state.

## Probes

`bun run probes` exercises seams that benefit from process boundaries, cold installation, viewer HTTP behavior, and signal handling. Probes should be fast, isolated, and explicit about environment dependencies.

## Packaging

`npm pack --dry-run` verifies that runtime assets, bundled YAML, prompts, viewer, examples, and documentation ship. A source test passing does not prove the installed package contains its dependencies or non-TypeScript assets.

## Live dogfood

Use a disposable or intentionally scoped repository. Confirm provider calls, commits, usage, and optional draft PR delivery. Live tests have cost and external side effects, so record when they were intentionally skipped.

## Invariant-first assertions

Prefer assertions on persisted state and observable Git/forge results over private call structure. Tests should make it difficult to regress the invariant, not difficult to refactor the implementation.
