# Add a node type

Adding a node crosses schema, validation, execution, persistence, recovery, and documentation boundaries.

## Checklist

1. Add the definition to `WorkflowNodeSchema`; decide whether it is valid inside `foreach`.
2. Add static rules in `validateWorkflow` before any side effect can occur.
3. Implement a narrow `NodeExecutor` with `AbortSignal` support.
4. Register it in `runDeclarativeWorkflow` or make it a scheduler built-in only when it is pure control flow.
5. Define the persisted output contract and recovery semantics.
6. Decide whether the effect is ordinary, privileged, idempotent, or forbidden to agents.
7. Project it through `RunView`, CLI, and viewer only when generic node rendering is insufficient.
8. Add schema, scheduler, interruption, timeout, failure, and end-to-end tests.
9. Update node reference and at least one executable example.

## Privileged effects

A node that mutates Git history, forge state, deployment state, credentials, or another external authority needs an explicit port and idempotency strategy. Agents may produce a specification; they should not perform the effect through generic tools.

## Finite outcomes

Every new control-flow node must preserve the property that a run completes, fails, cancels, or persists a resumable pause. Avoid open-ended background ownership.
