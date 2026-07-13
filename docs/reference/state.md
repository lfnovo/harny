# Persisted state reference

Current run schema: v4.

## `run.json`

Top-level sections:

| Section | Contents |
| --- | --- |
| `schema_version` | Literal `4`. |
| `run` | ID, slug, workflow, timestamps, reason, PID, and optional parent run. |
| `origin` | Prompt, workflow source, original cwd, host, and user. |
| `workspace` | Isolation, primary/runtime cwd, branch, worktree, reservation. |
| `inputs` | Immutable workflow inputs. |
| `execution` | Scheduler workflow, status, nodes, and pending human input. |
| `changesets` | Content-addressed changes with validation and commit linkage. |

## Node instance

Fields: `id`, status, attempts, optional attempt history, output, error, and nested steps.

Statuses: `pending`, `running`, `completed`, `skipped`, `failed`, `paused`, `cancelled`.

## Attempt

Fields: positive number, status, start/end timestamps, optional error, session, and usage. Attempt usage is immutable evidence; totals are derived elsewhere.

## Pending human input

Fields: node ID, question, options, asked/expiry timestamps, optional fallback, resume flag, and session.

## ChangeSet

Fields: ID, base SHA, sorted path/content-hash entries, validating session/provider identity, and committed SHA. A null content hash means deletion; null committed SHA represents not-yet-committed or empty commit result depending on lifecycle context.

## `events.jsonl`

Each line contains `at`, `run_id`, `type`, and optional node/data fields. Events support audit and presentation but do not replace the snapshot.

## `transcripts/`

Agent attempts write normalized append-only JSONL sidecars. A top-level node uses `transcripts/<node>/attempt-N.jsonl`; a `foreach` step uses `transcripts/<parent>/<index>/<step>/attempt-N.jsonl`. Each record has a version, monotonic sequence, timestamp, provider ID, and typed event. Transcript files are evidence for inspection and never drive scheduling or recovery.

The event contract covers requests, lifecycle, messages, reasoning, tools, file changes, plans, usage, provider status, and errors. Payloads are stored without truncation. Anyone who can read the repository can read them, so prompts and tool results should be treated as potentially sensitive local data.

## Compatibility

Only run v4 and workflow v2 are accepted. Historical v2/v3 resume and readers are not part of the current runtime.
