# Understand the feature development loop

The bundled `feature-dev` workflow is Harny's primary software-development path. Run it first as shown in [your first feature workflow](../getting-started/first-feature-run.md), then use this page to understand its composition.

## Planner

The planner receives the user request and returns a summary plus bounded tasks with IDs, descriptions, and acceptance criteria. It cannot publish or commit; the prompt tells it which effects the workflow owns.

## Sequential task loop

`foreach` reads `nodes.planner.outputs.tasks`, limits the list to 100, and processes one task at a time. Every internal step has a persisted instance such as `0.developer` or `1.commit`.

## Developer

The developer edits the isolated workspace and returns a structured verdict with a proposed commit message. Guards discourage Git-history and forge mutations. Harny captures every changed or untracked non-`.harny` path into a content-addressed ChangeSet.

## Validator and retry

Before provider validation, Harny applies its protected-path and size policy. Before and after validation, it recalculates the ChangeSet. The validator receives the authoritative path manifest, is read-only on file-edit tools, uses an attempt-scoped temporary directory, re-runs established project gates, and returns `pass`, `fail`, or `blocked` with evidence.

- `pass`: mark the exact ChangeSet as validated.
- `fail`: return to developer, up to three validator attempts.
- `blocked`: fail the run.

The validator's read-only hook is defense in depth, not a sandbox against adversarial shell commands. ChangeSet recalculation is the final integrity check.

## Commit

The privileged commit executor verifies the ChangeSet again, stages only its registered paths, checks the staged path list, and commits. Empty ChangeSets complete with a null commit SHA rather than manufacturing a commit.

After all task commits, `feature-dev` runs a final validator against the accumulated branch. A clean working tree is expected at this stage. Success is reported only when the complete branch still passes its project-wide gates.

## Explore the evidence

```bash
harny show <slug>
git show harny/<slug>
```

In `run.json`, compare the developer attempt, validator attempt, persisted ChangeSet, and commit output. This is the evidence chain behind:

```text
implemented diff = validated diff = committed diff
```
