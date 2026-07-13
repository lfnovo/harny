# Workflows and the deterministic runtime

A workflow is a declarative graph of typed nodes. It describes dependencies, inputs, policies, and a finite outcome; executors implement the actual effects.

Harny's scheduler is sequential and deterministic. It selects the first declared pending node whose dependencies are completed or skipped. `depends_on` still preserves a graph shape that can support other scheduling policies later.

This is intentionally different from encoding control flow inside agent prompts. Retries, timeouts, pauses, and delivery become visible runtime state rather than conversational convention.

## Definition versus instance

The YAML node is a definition. At runtime it has a persisted `NodeInstance` with status, attempt count, history, output, error, and possibly nested `foreach` steps.

The instance is authoritative. Executors receive a snapshot view, but cannot maintain a competing lifecycle model.

## Readiness and completion

A node can complete, skip, fail, pause, or cancel. A run finishes `done` when no unfinished reachable node remains; it fails when pending work cannot progress or an executor exhausts its policy.

The outcome describes the workflow's promised deliverable:

- `none`: no branch or external delivery required.
- `branch`: a reachable commit executor is required.
- `pull_request`: a reachable PR executor is required.
