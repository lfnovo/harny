# Workflow schema reference

Current schema version: `2`.

```yaml
version: 2
name: example
defaults:
  provider: claude
  timeout: 600000
workspace:
  isolation: inline
outcome:
  type: none
nodes:
  - id: inspect
    type: command
    command: [git, status, --short]
```

## Top-level fields

| Field | Contract |
| --- | --- |
| `version` | Must be `2`. |
| `name` | Lowercase ID matching `[a-z][a-z0-9_-]*`. |
| `defaults.provider` | Logical provider ID used by agent nodes without an override. |
| `defaults.timeout` | Optional positive milliseconds inherited by nodes; required indirectly for human nodes lacking their own timeout. |
| `workspace.isolation` | `worktree` or `inline`. CLI can override. |
| `workspace.allow_paths` | Optional protected-path prefixes intentionally allowed in ChangeSets; default `[]`. |
| `outcome.type` | `none`, `branch`, or `pull_request`. |
| `nodes` | At least one typed node. IDs must be unique. |

`branch` requires a reachable commit node; `pull_request` requires a reachable PR node.

## Common node fields

| Field | Contract |
| --- | --- |
| `id` | Lowercase ID matching the workflow name pattern. |
| `depends_on` | Earlier or later top-level IDs; all must exist and graph must be acyclic. Default empty. |
| `when` | Structured predicate. |
| `timeout` | Positive milliseconds. |
| `retry.max_attempts` | Integer 1–100. |
| `retry.backoff_ms` | Optional nonnegative delay. |
| `inputs` | Object, default `{}`; available to generic command prompt construction and references. |
| `output_schema` | Strict object JSON Schema for generic-agent output. Declare `properties` and list every property in `required`. |

## Predicates

```yaml
when:
  all:
    - equals: ["${{ nodes.check.outputs.exit_code }}", 0]
    - not:
        equals: ["${{ inputs.branch }}", ""]
```

Supported operators are `equals`, `not`, `all`, and `any`. There is no expression evaluator.

Top-level node predicates resolve workflow references before evaluation. In workflow v2, a `foreach` step predicate is evaluated as declared before item-alias interpolation; use literal step predicates or move reference-based conditions to a top-level node.

## References

```text
${{ inputs }}
${{ inputs.branch }}
${{ nodes.<id>.outputs }}
${{ nodes.<id>.outputs.<path> }}
```

A node may reference only itself or a transitive dependency. Missing values fail resolution. The CLI injects `inputs.branch` and `inputs.user_prompt`; internal entrypoints such as review-fix can add immutable inputs programmatically.

Inside `foreach`, `${{ <alias> }}` refers to the current item. Nested `foreach` is not part of v2.

## Lookup precedence

Named workflows:

```text
<repo>/.harny/workflows
~/.harny/workflows
bundled workflows
```

Explicit relative or absolute YAML paths bypass named lookup.
