# Add your first agent node

This tutorial replaces deterministic work with a read-only Claude call that summarizes a repository. It introduces Markdown commands, structured output, tools, guards, and provider usage.

Estimated time: 10 minutes. Provider cost: yes.

## Create the command

Add `.harny/commands/summarize.md`:

```markdown
Inspect the repository and return a concise summary of its purpose, primary entrypoint, and test command. Do not modify files.
```

Ensure `.harny/.gitignore` allows both configuration subtrees:

```gitignore
*
!.gitignore
!workflows/
!workflows/**
!commands/
!commands/**
```

## Create the workflow

Add `.harny/workflows/summarize.yaml`:

```yaml
version: 2
name: summarize
defaults:
  provider: claude
  timeout: 300000
workspace:
  isolation: inline
outcome:
  type: none
nodes:
  - id: summary
    type: agent
    command: summarize
    tools: [Read, Glob, Grep]
    guards: [read_only]
    requires: [structured_output, tool_guards]
    output_schema:
      type: object
      properties:
        summary: { type: string }
        entrypoint: { type: string }
        test_command: { type: string }
      required: [summary, entrypoint, test_command]
```

Commit both files before an inline run.

## Run and inspect

```bash
harny --workflow summarize --name summarize-repo "summarize this repository"
harny show summarize-repo
```

Named workflow lookup finds the project file before global and bundled definitions. The agent command resolves with similar project/global/bundled precedence.

Open `.harny/summarize-repo/run.json` and inspect `execution.nodes.summary`:

- `output` contains the structured object;
- `attemptHistory[0].session` identifies the logical provider connection;
- `attemptHistory[0].usage` contains provider-reported metrics.

The workflow declares `tool_guards` because `read_only` depends on a provider capable of enforcing Harny's hooks. Static validation rejects an incompatible provider before invoking it.
