# Add dependencies, conditions, and retries

Harny schedules one ready node at a time. A node is ready when its dependencies are completed or skipped. When several are ready, declaration order wins.

## Dependencies

```yaml
nodes:
  - id: test
    type: command
    command: [bun, test]

  - id: typecheck
    type: command
    command: [bun, run, typecheck]

  - id: finish
    type: command
    command: [git, status, --short]
    depends_on: [test, typecheck]
```

`test` and `typecheck` are both initially ready, but execute sequentially in declaration order. `finish` waits for both.

## Structured conditions

Conditions do not evaluate arbitrary code:

```yaml
- id: inspect
  type: command
  command: [git, status, --short]

- id: report
  type: command
  command: [git, status, --short]
  depends_on: [inspect]
  when:
    equals: ["${{ nodes.inspect.outputs.exit_code }}", 0]
```

Predicates support `equals`, `not`, `all`, and `any`. A false condition marks the node `skipped`, allowing dependents to continue.

## Retry

```yaml
retry:
  max_attempts: 3
  backoff_ms: 1000
```

Top-level retry repeats the same failed node. `max_attempts` is mandatory and bounded. Every attempt retains its own status, error, session, and usage.

Inside `foreach`, a retry can return to an earlier step:

```yaml
retry:
  max_attempts: 3
  return_to: developer
```

This is how validator failure re-enters development. `return_to` is rejected on top-level nodes and must name an earlier step in the same block.
