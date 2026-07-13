# Customize feature prompts

Harny keeps long agent instructions in Markdown. You can override one actor without copying a workflow or changing runtime code.

## Override one actor

Create a project validator prompt:

```text
.harny/prompts/feature-dev/default/validator.md
```

Start by copying the bundled validator prompt from `src/harness/workflow/prompts/default/validator.md`, then make a focused change. Commit the override before running Harny.

## Select a variant

Place variant prompts under:

```text
.harny/prompts/feature-dev/security/validator.md
```

Run the variant:

```bash
harny --workflow feature-dev:security --name security-check "implement the requested change"
```

Prompt resolution order is:

```text
project workflow + selected variant
project workflow + default variant
bundled selected variant
bundled default variant
```

An actor missing from the selected variant falls back independently. You can override only `validator.md` while retaining bundled planner and developer prompts.

## Keep overrides maintainable

- Explain the repository-specific rule, not generic model behavior.
- Preserve the structured-output and role boundaries expected by the workflow.
- Avoid asking agents to commit, push, publish, merge, or deploy.
- Review overrides when upgrading Harny because bundled prompts can evolve with runtime contracts.

Generic agent commands use `.harny/commands/<name>.md` and follow project, global, then bundled precedence. Feature actor prompts and generic commands are related but distinct mechanisms.
