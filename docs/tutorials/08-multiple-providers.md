# Use multiple providers

Every agent node resolves a logical provider ID. The workflow default applies unless the node overrides it.

```yaml
defaults:
  provider: claude

nodes:
  - id: research
    type: agent
    command: summarize
    provider: codex
    requires: [structured_output]

  - id: review
    type: agent
    command: review
    provider: claude
    depends_on: [research]
    requires: [structured_output, tool_guards]
    guards: [read_only]
```

Static validation compares `requires` with the selected provider's declared capabilities before workspace creation or an API call.

The current Codex adapter supports structured output, session resume, cwd, cancellation, and SDK sandbox selection. It does not advertise Harny's path-aware `tool_guards`. Consequently, a Codex node cannot simply replace the guarded developer or validator in bundled `feature-dev`; use Codex on nodes whose requirements match its contract.

For additional endpoints, create logical IDs in `~/.harny/providers.json`. Never put endpoint credentials in workflow YAML. See the [provider guide](../guides/providers.md) and [provider reference](../reference/providers.md).

Sessions persist both logical ID and connection fingerprint. Changing type, endpoint, key-variable name, or default model makes an old session ineligible for resume. Rotating the secret value alone does not change the fingerprint.
