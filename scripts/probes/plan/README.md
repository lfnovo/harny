# Plan probes

Probes for `src/harness/state/plan.ts` — Zod validation and `savePlan` /
`loadPlan` round-trip.

Run when editing `plan.ts` or changing the `Plan` / `PlanTask` types:

```
bun scripts/probes/plan/01-persistence.ts
```

Exit 0 on all-pass; exit 1 on any failure.
