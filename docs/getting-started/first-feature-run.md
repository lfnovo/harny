# Run your first feature workflow

This is the first tutorial that invokes an AI provider and can modify code. Complete the [command-only workflow](../tutorials/01-command-workflow.md) first so the runtime mechanics are already familiar.

Estimated time: 10–30 minutes. Provider cost: yes. Default provider: Claude.

## Prepare a small, clean request

Use a Git repository with an initial commit and a clean working tree. Pick a bounded change with an observable result, for example:

```bash
harny --name add-health-command \
  "Add a health command that prints JSON with status ok. Include tests and update the CLI help."
```

With no `--workflow`, Harny selects the bundled `feature-dev` workflow. It creates `harny/add-health-command` in an isolated worktree, then runs:

```text
planner → foreach task → developer → validator → commit
```

The validator may return `fail`. In that case the workflow returns to the developer, bounded by the retry policy. A blocked developer, blocked validator, exhausted retry, altered ChangeSet, or provider error ends the run as failed.

## Observe without interfering

In another terminal:

```bash
harny ls
harny show add-health-command
```

For a browser view:

```bash
harny ui
```

Do not edit the run worktree while an agent or validator is active. An unexpected path or content change invalidates the ChangeSet.

## Review the result

After success, inspect the branch before merging:

```bash
git log --oneline main..harny/add-health-command
git diff main...harny/add-health-command
```

Harny removes a successful isolated worktree, but preserves the branch and persisted evidence. Failed worktrees remain available for diagnosis.

## Clean up

When the branch and evidence are no longer needed:

```bash
harny clean add-health-command
```

This removes the run state, worktree if present, local run branch, and matching global pointer. It does not merge code or delete remote branches.

Continue to [Inspect a run](inspect-a-run.md) for the state and usage model.
