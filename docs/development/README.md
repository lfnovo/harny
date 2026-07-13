# Developing Harny

This section is for contributors changing Harny's runtime, providers, state, CLI, viewer, or bundled workflows.

Read the repository's root `AGENTS.md` before making changes. It contains current operational rules and codebase-specific hazards. `CLAUDE.md` is only a compatibility redirect to the same canonical instructions.

## Contributor path

1. [Development setup](setup.md) — install dependencies and run typecheck, tests, probes, and package validation.
2. [Architecture overview](architecture.md) — system context, component boundaries, and dependency direction.
3. [Repository map](repository-map.md) — responsibility and ownership of each core module.
4. [Run lifecycle](runtime-lifecycle.md) — CLI to loader, workspace, scheduler, executor, state boundary, and cleanup.
5. **Runtime invariants** — properties every feature and recovery path must preserve.
6. **State and recovery** — snapshot schema, atomic writes, events, discovery, and interrupted attempts.
7. [Adding a provider](adding-a-provider.md) — capabilities, normalized results, sessions, usage, errors, and contract tests.
8. [Adding a node type](adding-a-node.md) — schema, validation, executor, privileged effects, persistence, and recovery.
9. [Adding a bundled workflow](adding-a-workflow.md) — commands, static validation, tests, and documentation.
10. [Testing strategy](testing.md) — unit contracts, characterization tests, probes, package checks, and live dogfood.
11. [Release checklist](release.md) — compatibility decisions, documentation, and final gates.

## Core invariants

- `run.json` v4 is the only authoritative runtime snapshot.
- The scheduler runs one ready node at a time in declaration order.
- Provider capabilities fail validation before workspace or provider effects.
- Provider usage belongs to the attempt that produced it; totals are derived views.
- Provider events are normalized and appended to that attempt's local transcript; transcripts never drive execution.
- Resume requires the same logical provider and connection fingerprint.
- Agents do not commit, push, publish pull requests, merge, or deploy directly.
- The developer produces a ChangeSet and the validator approves that exact content.
- Implemented diff, validated diff, and committed diff must remain equal.
- Every run reaches a finite terminal state or a persisted human pause.

## Architecture views

The architecture documentation should stay small and useful:

- one system-context diagram showing the developer, Harny, providers, Git, and GitHub;
- one component diagram showing CLI, loader, scheduler, executors, ports, state, workspace, and viewer;
- focused sequence diagrams for a normal agent attempt, retry, human pause/resume, and PR delivery.

Diagrams should explain boundaries and ownership, not mirror every TypeScript type.
