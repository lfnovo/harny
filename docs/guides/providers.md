# Configure providers

Harny always exposes the built-in logical IDs `claude` and `codex`. A workflow selects one through `defaults.provider` or a node-level `provider` override.

## Built-in Claude

Claude uses the Claude Agent SDK. Existing SDK authentication and supported Anthropic environment variables apply. For Harny-specific credential files, `~/.harny/.env` provides global values and `./harny.env` can override them for one project.

Project application `.env` files are not a safe place for Harny's Anthropic credentials. When they mention Anthropic credential keys, Harny scrubs Bun's automatically inherited values before loading its own environment. Set `HARNY_INHERIT_ENV=1` only when deliberate inheritance is required.

## Built-in Codex

Codex uses the pinned official SDK and existing Codex authentication/configuration. Harny does not require a separately installed executable. The SDK package includes its runtime binary.

## Compatible endpoint

Create `~/.harny/providers.json`:

```json
{
  "version": 1,
  "providers": [
    {
      "id": "openai_proxy",
      "type": "codex",
      "base_url": "https://proxy.example/v1",
      "api_key_env": "OPENAI_PROXY_KEY",
      "model": "compatible-model"
    }
  ]
}
```

Export the secret outside the file:

```bash
export OPENAI_PROXY_KEY="..."
```

Then select `openai_proxy` in YAML. Anthropic-compatible connections use `type: claude` with the same fields.

Only the global file is loaded. A repository cannot redirect provider traffic or choose credential variable names by committing its own provider config.

## Diagnose configuration

- Invalid JSON, unknown fields, duplicate IDs, non-HTTP URLs, and malformed environment names fail before execution.
- A configured `api_key_env` must exist even when the selected workflow contains no agent node.
- Workflow capability errors identify the node, missing capability, and logical provider.
- A connection change prevents session resume; start a new run or restore the original connection definition.

See the exact [provider reference](../reference/providers.md).
