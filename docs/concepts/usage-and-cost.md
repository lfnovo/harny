# Usage, retries, and cost coverage

Usage is evidence produced by a provider call. Harny attaches it to the runtime attempt immediately, before higher-level validation or retry decisions.

This matters because unsuccessful work can still be billed. A validator that says `fail`, a schema error after model completion, or a human question can all have real usage.

Run and provider totals are projections over attempt history. They are never persisted as independent aggregates.

Cost is treated more conservatively than tokens. Harny records a provider-reported USD value but does not estimate missing cost. The coverage field distinguishes complete, partial, and absent cost reporting, especially for mixed Claude/Codex workflows.

Model breakdown is preserved where a provider reports it. A logical provider ID and model are both useful: the former identifies configuration and resume semantics, while the latter explains actual usage.
