# Debug and recover a run

## Start with the projection

```bash
harny show <run-id-or-slug>
harny show <run-id> --tail --since 30m
```

Then inspect `.harny/<slug>/run.json`. Find the failed node or `foreach` step, its final attempt, error, session, and usage. Open that attempt in `harny ui` to inspect normalized messages, reasoning, tool calls, file changes, and provider errors. Raw JSONL remains under `.harny/<slug>/transcripts/` when API-level inspection is useful.

## Common failure classes

- **Workflow validation:** fix YAML before any effects occurred.
- **Capability mismatch:** change provider or remove a requirement only if the workflow is genuinely safe without it.
- **Dirty inline workspace:** commit, stash, or clean unrelated changes before retrying.
- **Provider error:** inspect the attempt metadata and provider authentication; failed calls can still report usage.
- **Validation failure:** earlier developer/validator attempts explain the bounded loop.
- **ChangeSet changed:** remove external edits and start a fresh run; do not bypass the invariant.
- **Dead PID:** a new conflicting run materializes the old active record as failed when its process no longer exists.
- **Human expiry:** use fallback when the workflow defines one; otherwise start a new run.

## Interrupted scheduler work

When persisted state contains a running node but execution restarts, Harny closes the interrupted attempt as failed, retains any reported usage, and requeues the node. Completed `foreach` checkpoints are not repeated.

## Reusing a slug

Terminal runs are immutable evidence. Harny will not silently overwrite them:

```bash
harny clean <slug>
harny --name <slug> "try again"
```

Preserve any branch or diagnostic work you need before cleaning.
