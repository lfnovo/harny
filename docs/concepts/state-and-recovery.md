# Persisted state and recovery

Harny is local-first: an atomic JSON snapshot in the target repository drives execution. No database or daemon is required.

`run.json` combines immutable origin, workspace identity, scheduler instances, attempts, and ChangeSets. A save occurs before and after important executor boundaries. Atomic replacement prevents readers from observing partially written JSON.

`events.jsonl` records lifecycle observations for audit and UI history. Because append-only events can be delayed or missing, replaying them is not how Harny reconstructs state.

Attempt-scoped files under `transcripts/` record normalized provider events for inspection. They are deliberately separate from the authoritative snapshot: losing a transcript reduces diagnostic evidence but cannot change what the scheduler does next.

## Recovery rule

Persisted state wins over process memory. If a process stops after usage was persisted but before attempt completion, recovery keeps the usage, closes the attempt as interrupted, and schedules a fresh attempt. It never erases evidence of a possibly billed call.

Completed nested checkpoints are retained. This prevents an interrupted `foreach` from repeating earlier successful steps and their effects.

Global pointers contain just enough information to discover runs across projects. They are disposable indexes, not a distributed state layer.
