# 0003. Restrict commits and pull-request publication to privileged executors

Status: accepted

## Context and problem

Agents need freedom to edit and reason, but direct commit, push, or PR mutation makes it difficult to prove what was validated and to recover idempotently.

## Decision drivers

- Exact equality between implemented, validated, and committed content.
- Narrow external side effects.
- Idempotent PR delivery and remote divergence protection.
- Testability without live agents.

## Considered options

- Let agents use Git and `gh` directly.
- Rely only on prompt instructions or tool guards.
- Have agents produce specifications consumed by privileged executors.

## Decision

Developer agents produce a ChangeSet and proposed metadata. Validators approve the exact ChangeSet. Dedicated executors own commit, push, and PR create/update. Force-push, merge, and deploy are excluded.

## Consequences

- Agent flexibility is separated from authority.
- Tool guards remain defense in depth rather than the sole boundary.
- New privileged effects require explicit ports, policy, and tests.
- Unexpected workspace or remote changes fail rather than being overwritten.

## Validation

ChangeSet tampering/new-file tests and forge create/update/divergence tests must pass.
