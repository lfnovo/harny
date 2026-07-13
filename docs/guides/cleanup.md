# Clean runs and registry pointers

## Remove one run

```bash
harny clean <slug>
```

Cleanup is idempotent and targets:

- `.harny/<slug>/` state, audit events, and local transcripts;
- `.harny/worktrees/<slug>/` when present;
- local branch `harny/<slug>`;
- matching global run pointers for the current repository.

It does not remove remote branches, pull requests, or arbitrary output from an `outcome: none` inline workflow. Terminal runs are not removed automatically; cleanup is the explicit transcript-retention boundary.

## Active run protection

When the snapshot says `running` and its PID is alive, cleanup refuses. To terminate it:

```bash
harny clean <slug> --force
```

This sends `SIGTERM` and waits. Add `--kill` to permit `SIGKILL` escalation.

## Repair discovery

Reindex one project:

```bash
harny scan /path/to/repository
```

Remove global pointers whose run files no longer exist:

```bash
harny clean --prune
```

Pointers are a rebuildable cross-project index. Deleting or repairing them never changes the authoritative `run.json` files.
