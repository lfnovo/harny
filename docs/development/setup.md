# Development setup

## Requirements

- Bun 1.3 or newer.
- Git.
- GitHub CLI for forge probes or live PR dogfood.
- Provider authentication only for live agent tests.

Install dependencies:

```bash
bun install
```

Run the local CLI:

```bash
bun run harny -- --help
bun run harny -- --workflow feature-dev --name example "implement a bounded change"
```

## Standard gates

```bash
bun run typecheck
bun test
bun run probes
npm pack --dry-run
git diff --check
```

Unit and characterization tests must not require paid provider calls. Use injected providers, Git operations, stores, forge implementations, and SDK event streams. Live dogfood is a separate final confidence check when credentials and external side effects are explicitly in scope.

## Repository hygiene

The worktree can contain unrelated user changes. Preserve them and avoid broad cleanup. A Harny self-modification takes effect only in the next CLI process because the running binary is already loaded.

Production TypeScript changes in this repository are expected to land through Harny's own guarded feature workflow. Documentation and configuration can be edited directly, but must still pass links, examples, and packaging checks.
