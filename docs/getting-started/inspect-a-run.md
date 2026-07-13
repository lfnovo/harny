# Inspect a run

Harny keeps enough local evidence to answer what ran, where it ran, which attempts failed, which provider sessions were used, what usage was reported, and which ChangeSet was committed.

## Choose the right view

```bash
harny ls
harny show <run-id-or-slug>
harny show <run-id> --tail
harny ui
```

- `ls` is a compact cross-project index. It intentionally omits usage.
- `show` projects one authoritative snapshot into readable CLI output.
- `show --tail` prints audit events as JSON lines; add `--since 10m` to filter.
- `ui` starts a read-only viewer on `127.0.0.1`.

In the viewer, expand an agent attempt to load its transcript. Active attempts refresh every three seconds. Reasoning and full tool payloads are collapsed initially so the execution timeline stays readable.

## Files on disk

For slug `example`:

```text
.harny/example/run.json
.harny/example/events.jsonl
.harny/example/transcripts/<node>/attempt-1.jsonl
```

`run.json` v4 is authoritative. Its `execution.nodes` contain node instances, attempts, sessions, outputs, errors, and provider usage. `events.jsonl` is append-only audit history. `transcripts/` contains normalized provider evidence per attempt. Neither JSONL stream drives scheduling.

Global files under `~/.harny/runs/` are small discovery pointers. They can be rebuilt with `harny scan` and pruned with `harny clean --prune`; they are not copies of run state.

## Read status correctly

- `running`: a process owns the active run.
- `paused`: persisted human input is pending; the CLI renders this as `waiting_human` where appropriate.
- `done`: all reachable work completed.
- `failed`: a node, recovery check, expiry, or lifecycle invariant failed.
- `cancelled`: a `cancel` node produced a finite cancellation outcome.

Each attempt has its own status. A completed node may therefore retain earlier failed attempts and their reported usage.

## Usage is reported, not guessed

Claude can report input/output tokens, cache activity, model breakdown, and USD cost. Codex reports input/output, cached input, and reasoning tokens but no cost through the current SDK contract. Mixed runs therefore show partial cost coverage rather than an invented estimate.

Continue through the [tutorial path](../tutorials/README.md) to customize workflows.
