# What is Harny?

Harny is a local workflow runtime for software-development agents. It coordinates Claude, Codex, local commands, Git worktrees, human decisions, and pull-request delivery as one persisted, auditable run.

If you have used a coding agent directly, you already know the inner part of the experience: you describe a change, the model reads the repository, edits files, and runs tools. A harness adds an outer control layer around those model sessions.

## The problem a harness solves

A single agent session can accomplish a lot, but a repeatable development process needs more than one good conversation:

- Who turns a broad request into bounded tasks?
- Does the implementation satisfy independently checked acceptance criteria?
- What happens if validation fails or the process stops halfway through?
- Which exact diff was reviewed before it was committed?
- Who is allowed to commit, push, or create a pull request?
- Where can you inspect attempts, sessions, failures, and usage afterward?

Harny makes those choices part of a declarative workflow instead of leaving them implicit in one model prompt.

## Who controls what?

| Participant | Responsibility |
| --- | --- |
| You | Choose the request, workflow, providers, review points, and whether a result should be delivered. |
| Agents | Plan work, implement changes, produce structured results, and validate acceptance criteria. |
| Harny | Schedule nodes, persist attempts, enforce capabilities, isolate workspaces, manage retries, verify ChangeSets, and perform privileged effects. |

The distinction is important: an agent may propose a commit message or pull-request specification, but Harny's privileged executors are responsible for actually committing or publishing.

## A typical feature run

The bundled `feature-dev` workflow follows this shape:

```text
request
  → planner
  → for each task
      → developer
      → validator
      → retry developer when validation fails
      → commit the validated ChangeSet
  → finite outcome
```

Harny runs one ready node at a time in declaration order. After every important boundary, it persists the scheduler state in the repository's `.harny/` directory. If execution is interrupted, the persisted state—not an in-memory copy—describes what happened.

## The core safety invariant

For feature workflows, the developer's result is captured as a content-addressed ChangeSet. The validator approves that exact content, and the commit executor recalculates it before staging only its recorded paths:

```text
implemented diff = validated diff = committed diff
```

If a validated file changes, or a new file unexpectedly appears before commit, the run fails instead of committing a different result.

## What Harny is not

Harny is not:

- a model or coding agent;
- a replacement for Claude or Codex;
- a hosted control plane or required daemon;
- permission for an agent to merge or deploy;
- a promise that model output is correct.

It is the local orchestration and evidence layer around agents and deterministic tools. Independent validation, review, and normal software-engineering judgment still matter.

## Why YAML?

A workflow describes nodes, dependencies, conditions, retry bounds, timeouts, providers, and outcomes in YAML. Before creating a worktree or invoking a provider, Harny validates the workflow's structure and provider capabilities.

The runtime is deliberately sequential in the current version. This makes execution order, persisted recovery, and privileged effects easier to reason about while leaving room for a future scheduler to use the same dependency graph.

## Next step

Continue to [Install Harny](installation.md). The first tutorial does not call an AI provider, so you can learn the runtime and inspect a complete run without spending tokens.
