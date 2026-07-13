# Testing constitution

The LLM is the only nondeterministic, slow, and expensive dependency. Filesystem, Git, schema validation, the scheduler, provider adapters, forge adapters, and CLI parsing should be exercised deterministically with dependency injection.

Test layers:

1. Pure schemas, predicates, resolvers, parsers, and message composition.
2. Provider, forge, store, workspace, and interaction contracts with fakes.
3. Persisted scheduler scenarios: dependencies, skip, retry, foreach, timeout, cancellation, recovery, human pause/answer/expiry, and ChangeSet integrity.
4. Disposable-repository integration tests for commits, worktrees, v4 state, and PR safety behavior.
5. Probes only for real process, SDK instrumentation, transcript, install, or viewer boundaries.

Every regression should have the narrowest deterministic test that proves the public behavior. Real Claude, Codex, and GitHub runs are final dogfood gates, not the primary test suite.
