# Provider reference

## Configuration file

Path: `~/.harny/providers.json`. Current version: `1`.

```json
{
  "version": 1,
  "providers": [
    {
      "id": "proxy",
      "type": "codex",
      "base_url": "https://example.test/v1",
      "api_key_env": "PROXY_API_KEY",
      "model": "model-name"
    }
  ]
}
```

| Field | Contract |
| --- | --- |
| `id` | `[a-z][a-z0-9_-]*`; unique in file. Built-in IDs may be overridden. |
| `type` | `claude` or `codex`. |
| `base_url` | Optional HTTP(S) URL. |
| `api_key_env` | Optional environment variable name; value must exist at startup. |
| `model` | Optional nonempty default model. Node-level model wins. |

Unknown fields are rejected. Secret values are not valid fields.

## Capabilities

| Capability | Claude | Codex |
| --- | --- | --- |
| Structured output | yes | yes |
| Session resume | yes | yes |
| Harny tool guards | yes | no |
| Interactive questions | yes | no |

Codex does select read-only or workspace-write SDK sandbox mode from request guards, but does not claim Harny's path-aware hooks.

## Normalized session

```json
{
  "id": "provider-session-id",
  "provider": "logical-id",
  "connectionFingerprint": "sha256"
}
```

The fingerprint covers non-secret connection configuration. Resume rejects a different provider or fingerprint.

## Normalized usage

Required: `provider`, nullable `model`, `inputTokens`, `outputTokens`. Optional: cache read/creation, reasoning output, cost USD, and per-model metrics.

Provider errors can carry partial session and usage metadata so a failed billed attempt remains auditable. During execution, both adapters stream normalized events into the current attempt transcript; the provider contract never returns an accumulated transcript blob.
