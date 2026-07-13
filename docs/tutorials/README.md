# Tutorials

The tutorials form one progressive learning path. Each tutorial starts from a working result, introduces one important capability, and leaves the reader with something they can run and inspect.

## Learning path

1. [A command-only workflow](01-command-workflow.md) — YAML, nodes, dependencies, and persisted state without an agent call.
2. [The first agent node](02-first-agent-workflow.md) — structured output and provider selection.
3. [The feature development loop](03-feature-development-loop.md) — planner, sequential tasks, developer, validator, and commit.
4. [Custom prompts](04-custom-prompts.md) — project Markdown commands and precedence.
5. [Dependencies, conditions, and retries](05-control-flow.md) — deterministic control flow.
6. [Sequential `foreach`](06-sequential-foreach.md) — bounded work over planner-produced tasks.
7. [Human review](07-human-review.md) — interactive input, async parking, answer, and expiry.
8. [Multiple providers](08-multiple-providers.md) — Claude, Codex, logical provider IDs, and compatible endpoints.
9. [Usage and cost](09-usage-and-cost.md) — attempt-level metrics, cache, reasoning, and cost coverage.
10. [Draft pull-request delivery](10-draft-pull-request.md) — `feature-pr`, idempotency, and `harny pr fix`.

## Tutorial contract

Each tutorial must include:

- a concrete outcome and an estimated duration;
- prerequisites and an explicit cost warning;
- copyable commands and complete files;
- checkpoints the reader can verify locally;
- a short explanation only after the reader observes the behavior;
- cleanup instructions and a suggestion for independent experimentation.
