# Node type reference

## `command`

```yaml
- id: test
  type: command
  command: [bun, test]
```

Runs a direct argv array in the workflow workspace. Captures `stdout`, `stderr`, and `exit_code`. A nonzero exit fails the attempt. Inline shell invocations such as `[sh, -c, ...]` are rejected.

## `agent`

```yaml
- id: summarize
  type: agent
  command: summarize
  provider: claude
  model: optional-model
  tools: [Read, Glob]
  guards: [read_only]
  requires: [structured_output, tool_guards]
  output_schema:
    type: object
    properties:
      summary: { type: string }
    required: [summary]
```

`command` names a Markdown command or one of the special bundled roles (`planner`, `developer`, `validator`, `review_fixer`). When no Markdown command resolves, a generic agent uses the string itself as prompt text. Generic agent schemas use JSON Schema and are converted to strict provider schemas; declare every property and include every property in `required` for portable structured output.

Valid requirements: `structured_output`, `resume`, `tool_guards`, `interactive_questions`.

Valid guards: `read_only`, `no_git_history`, `no_forge_effects`.

## `foreach`

```yaml
- id: tasks
  type: foreach
  items: "${{ nodes.planner.outputs.tasks }}"
  as: task
  max_items: 100
  steps: []
```

`items` is a literal list or a reference resolving to a list. Steps execute sequentially per item and can be any node type except another `foreach`. Step dependencies must name an earlier step. `retry.return_to` is valid only here and must point backward.

## `human`

```yaml
- id: approval
  type: human
  question: Continue?
  timeout: 86400000
  fallback: continue
```

Requires a direct or inherited timeout. In async operation it persists a pending question and parks the run.

## `commit`

Top level:

```yaml
- id: commit
  type: commit
  message: "feat: change"
  changeset: "${{ nodes.developer.outputs.changeSet }}"
  depends_on: [developer]
```

Inside `foreach`, `changeset` names an earlier step such as `developer`. The privileged executor accepts only a verified ChangeSet and can return `sha: null` for an empty diff.

## `pull_request`

```yaml
- id: deliver
  type: pull_request
  title: Feature
  body: Description
  base: main
  head: "${{ inputs.branch }}"
  draft: true
  existing: allow
```

`existing` is `allow`, `require`, or `forbid`. Only GitHub is implemented. Publication includes push and remote-head verification.

## `cancel`

```yaml
- id: stop
  type: cancel
  reason: Policy rejected the run
```

Produces a finite cancelled workflow outcome; it is not an OS-signal mechanism.
