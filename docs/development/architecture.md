# Architecture overview

## System context

```text
Developer
  │ CLI / YAML / human answers
  ▼
Harny ───────► Claude or Codex
  │                │ sessions, output, usage, streamed events
  │ Git            ▼
  ├──────────► local repository and worktrees
  │
  └──────────► GitHub through gh (optional draft PR)
```

Harny is the local control plane. Providers reason and use tools; Git owns code history; GitHub owns pull requests; the repository filesystem owns authoritative run state and attempt-scoped transcripts.

## Core components

```text
CLI
  → workflow loader + static validator
  → orchestrator + workspace provider
  → persistent scheduler
  → typed node executors
      → AgentProvider
      → command process
      → human interaction
      → ChangeSet commit
      → ForgeProvider
  → RunStore + TranscriptStore
  → RunView → CLI show / viewer
```

Dependency direction matters:

- workflow definitions depend on provider-neutral capabilities, not SDK types;
- vendor SDK details end inside provider adapters;
- provider adapters normalize SDK events before the runtime persists them;
- scheduler state does not depend on CLI or viewer representations;
- `RunView` derives presentation data from persisted state;
- privileged executors own Git history and forge mutation.

## Explicit seams

- `AgentProvider`: model/session/usage boundary.
- `WorkspaceProvider`: inline/worktree lifecycle.
- `ForgeProvider`: PR find/create/update.
- `WorkflowStateStore` and `RunPersistence`: scheduler and ChangeSet persistence.
- `Observer`: non-authoritative runtime notifications.
- `AgentEventSink` and `TranscriptStore`: append-only provider evidence scoped to a node attempt.
- injected Git and subprocess runners: deterministic tests for privileged effects.

See [runtime lifecycle](runtime-lifecycle.md) for sequence and [repository map](repository-map.md) for code ownership.
