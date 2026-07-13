# Create and override workflows

## Project workflow

Place a versioned YAML file at:

```text
<repo>/.harny/workflows/verify.yaml
```

Run it by name:

```bash
harny --workflow verify --name verify-run "verify the repository"
```

Or pass an explicit path:

```bash
harny --workflow ./path/to/workflow.yaml --name verify-run "verify the repository"
```

Named lookup precedence is project, then `~/.harny/workflows`, then bundled. A project file named `feature-dev.yaml` therefore overrides the bundled workflow for that repository.

## Commands and prompts

- Generic agent commands: `.harny/commands/<name>.md`.
- Feature actor prompts: `.harny/prompts/<workflow>/<variant>/<actor>.md`.

Commit configuration before an inline run. Keep generated run directories ignored while explicitly unignoring configuration subtrees.

## Validation timing

Harny parses YAML, validates the schema, performs static graph checks, resolves providers, and validates capabilities before Git worktree creation or provider cost. Errors can cover IDs, dependencies, cycles, references, retries, human timeouts, commands, capabilities, and outcomes.

## Safe escape hatch

`command` nodes accept direct argv arrays. Shell strings, inline `sh -c` scripts, and plugins are not supported workflow escape hatches. If logic deserves a script, version a real executable in the repository and invoke it directly.
