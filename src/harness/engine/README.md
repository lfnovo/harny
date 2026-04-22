# src/harness/engine/

XState v5 engine layer for harny v0.2.0. Implements the harny SDK described in engine-design.md §8.

## Files

| File | Role |
|---|---|
| `types.ts` | Core type definitions: `WorkflowDefinition`, `ActorContext`, `FeatureSet`, `HumanReviewOption`, `HumanReviewOutput`, `AgentActorOptions`, `CommandActorOptions`, `HumanReviewActorOptions`. |
| `defineWorkflow.ts` | `defineWorkflow()` — wraps `setup()+createMachine()` with harny metadata; enforces strict TypeScript types on action/actor references at compile time. |
| `harnyActions.ts` | `harnyActions` object spread into `setup({ actions })`. Effect actions (`commit`, `resetTree`, `cleanUntracked`) throw placeholder errors overridden at runtime via `machine.provide()`. Pure-state actions (`advanceTask`, `bumpAttempts`, `stashValidator`, `stashDevSession`) are real XState assigns. |
| `dispatchers/agent.ts` | `agentActor()` — factory that wraps `runPhase` (Anthropic SDK) as an XState `fromPromise` actor; threads `resumeSessionId` on snapshot restore. |
| `dispatchers/command.ts` | `commandActor()` — factory that wraps `Bun.spawn` as an XState `fromPromise` actor; supports `advisory` and `idempotent` flags. |
| `dispatchers/humanReview.ts` | `humanReviewActor()` — factory that wraps the parking mechanism as an XState `fromPromise` actor; handles interactive, silent, and async run modes. |
