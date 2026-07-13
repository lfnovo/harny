# Inspect usage and cost

Harny records usage on the exact runtime attempt that produced it, including failed retries and calls that pause for human input.

After an agent workflow:

```bash
harny show <slug>
```

The run summary shows totals and a provider breakdown. Nodes with retries expose attempt detail. The viewer provides the same derived projection.

## Metrics

- Input and output tokens are common to Claude and Codex.
- Cache-read and cache-creation input tokens appear when reported.
- Reasoning output tokens currently come from Codex.
- Claude can report exact USD cost and per-model usage.
- Codex does not expose cost through the current SDK usage contract.

## Cost coverage

- `complete`: every usage-bearing attempt reported cost.
- `partial`: at least one did and at least one did not.
- `none`: no attempt reported cost.

Harny sums reported cost only. It does not multiply tokens by a price table, because endpoint pricing, cached-token rules, model aliases, and provider agreements can differ.

Aggregates are not written back into `run.json`. They are derived from attempt histories whenever `show` or the viewer builds a run view. This prevents totals from drifting away from their evidence.
