# Process a list with `foreach`

`foreach` expands a bounded list into sequential, persisted step instances.

```yaml
version: 2
name: prepare-directories
defaults:
  provider: claude
workspace:
  isolation: inline
outcome:
  type: none
nodes:
  - id: directories
    type: foreach
    items: [api, web, worker]
    as: component
    max_items: 3
    steps:
      - id: create
        type: command
        command: [mkdir, -p, "output/${{ component }}"]

      - id: inspect
        type: command
        command: [git, status, --short]
        depends_on: [create]
```

The runtime processes every step for `api`, then `web`, then `worker`. It does not execute items in parallel.

The alias token can replace a complete value or appear inside a string. A dynamic list can come from a dependency:

```yaml
items: "${{ nodes.planner.outputs.tasks }}"
```

`max_items` is always required. If the resolved list is larger, the block fails before executing a step. Completed checkpoints remain persisted so recovery does not repeat them.

In `run.json`, step IDs combine item index and step ID:

```text
0.create
0.inspect
1.create
1.inspect
```

This stable identity is what makes per-item retry and interruption recovery auditable.
