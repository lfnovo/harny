---
name: release
description: Operate a release cycle across Harny 0.5 runs and draft PRs. Use when coordinating multiple scoped changes, choosing feature-dev versus feature-pr, reviewing run evidence and usage, fixing PR feedback, running release gates, merging with explicit approval, or tagging a version.
allowed-tools: Bash, Read, Write, Edit, Agent
---

# Release manager

Coordinate bounded Harny runs from intent to reviewed delivery. Keep architectural decisions with the user and privileged release effects explicit.

## Core policy

1. Shape prompts as outcome, observable acceptance criteria and constraints. Leave implementation design to the planner.
2. Keep each run to one coherent change.
3. Preserve run evidence until review and triage are complete.
4. Inspect the actual diff, terminal state, attempts and validator evidence before delivery.
5. Never treat provider self-report as proof when deterministic gates are available.
6. Never merge, tag, publish or answer a parked run without explicit user approval.

## Select the delivery path

Prefer `feature-pr` when the intended deliverable is a GitHub PR:

```bash
harny --workflow feature-pr --name <slug> "<outcome + AC + constraints>"
```

It validates commits, pushes without force, verifies the remote head and creates or updates a draft PR idempotently.

Use default `feature-dev` when the user wants only a local branch:

```bash
harny --name <slug> "<outcome + AC + constraints>"
```

Use an explicit YAML workflow only when the repository maintains that workflow contract. Use `harny pr fix <number>` for feedback on an existing PR; it pins the current remote head and refuses concurrent or divergent updates.

## Preflight

Before the first run:

- Read applicable `AGENTS.md` instructions.
- Confirm the base branch is current and the working tree situation is understood.
- Run the repository's established install and validator commands on the base branch.
- For PR delivery, run `gh auth status` and inspect `git remote get-url origin`.
- Confirm requested logical provider IDs exist in `~/.harny/providers.json`; never print secret values.
- Identify existing active branches/PRs that may touch the same paths.

If the repository is new to Harny, use `/harny:check-repo` first.

## Plan the run sequence

Maintain a small queue:

| Run | Outcome | Depends on | Delivery | Status |
| --- | --- | --- | --- | --- |
| `<slug>` | one coherent result | prior run or none | branch/PR | pending |

Harny's scheduler is sequential within one run. Independent runs can execute concurrently only when their repositories, branches and likely paths are disjoint. Default to sequential when uncertain.

Do not create a detailed multi-run implementation plan upfront. Choose the next run, learn from it, then refine the next.

## Per-run loop

### 1. Align

Agree with the user on outcome, acceptance, constraints, workflow and slug. Do not smuggle file paths or code shapes into the prompt unless they are genuine constraints.

### 2. Dispatch and monitor

Delegate mechanics to `@orchestrator` or invoke Harny directly. Monitor with:

```bash
harny show <run> --tail --since 5m
harny ui
```

Use `run.json` as authoritative state, `events.jsonl` as audit history and attempt transcripts for provider behavior. A parked async run is persistent; answer only with user input through `harny answer`.

### 3. Review terminal evidence

Require:

- terminal status `done` for delivery;
- expected workflow and branch/PR artifact;
- all node attempts accounted for;
- final validator pass;
- ChangeSet equality preserved;
- provider usage/cost coverage understood;
- no unexplained retry, tool failure or transcript anomaly.

Invoke `/harny:review <run>` for failures, retries, slow runs or novel provider/workflow behavior.

### 4. Review code and delivery

Inspect the complete diff and commit graph. Re-run deterministic gates proportionate to risk. For a PR, verify checks and review comments against the current head SHA, not an earlier revision.

Triage findings:

- `NOW-blocks`: correctness, security, data loss, release or contract risk; fix before delivery.
- `NOW-quick`: small hardening directly related to the release; fix when it reduces immediate risk.
- `BACKLOG`: useful but independent; open an issue with evidence.

Use `harny pr fix <number>` for actionable PR feedback. Repeat review on the new head.

### 5. Deliver with approval

For a local branch, ask before merging. For `feature-pr`, ask before marking ready or merging. Never force-push, merge or deploy implicitly.

After merge, refresh the base branch before the next dependent run so later work does not branch from stale history.

## Release/version checklist

When the user requests a versioned release:

1. Read the repository's release documentation and workflow triggers.
2. Update the package/application version and move changelog entries out of `Unreleased` when that repository requires it.
3. Run all documented release gates and package inspection.
4. Put the release bump through review and CI.
5. Merge only after approval and green checks.
6. Create the tag on the exact integrated commit; match repository tag conventions.
7. Push the tag only with approval.
8. Monitor tag-triggered publication through completion.
9. Verify the external artifact/release version and tag target.

Do not assume a green merge automatically means publication succeeded.

## Validator economics

- Prefer deterministic unit/integration tests and bounded probes.
- Do not let a validator launch another Harny run.
- Keep live provider dogfood outside ordinary validators unless the change crosses that provider boundary and the user accepts cost/external effects.
- Treat mocks as contract evidence, not a substitute for a necessary boundary smoke test.

## Recovery

- `waiting_human`: surface the persisted question; use `harny answer` with user-provided input.
- failed validator: inspect evidence; start a new scoped run or use PR fix rather than mutating validated commits manually.
- changed PR head: stop; never overwrite it.
- dead PID: let discovery materialize the failure, inspect the run, then decide whether to clean or start another slug.
- obsolete run schema: Harny 0.5 does not resume it; clean only after preserving any needed evidence.

## Re-orient after context loss

1. Read `AGENTS.md` and this skill.
2. Inspect `git status`, recent commits and open PRs.
3. Run `harny ls` and `harny show` for active/recent runs.
4. Read relevant `review.md` files.
5. Reconfirm the next decision with the user.

## Companion skills

- `/harny:review`: analyze one run.
- `/harny:learn` and `/harny:drain`: capture and triage operational learning.
- `/harny:check-repo`: adoption readiness.
- `/harny:harny`: product/runtime orientation.
