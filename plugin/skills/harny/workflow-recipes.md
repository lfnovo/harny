# Validated workflow recipes

Use these recipes as exact starting points. Do not invent node fields, reference syntax, or provider capabilities from memory.

## Codex planning, guarded implementation, approval, and draft PR

Copy [feature-pr-approval.yaml](feature-pr-approval.yaml) into the project's versioned workflow directory. The invoking agent must resolve the asset beside this file and use its real absolute path; do not give the user an unresolved `<plugin-root>` placeholder.

```bash
mkdir -p .harny/workflows
cp /resolved/path/to/feature-pr-approval.yaml .harny/workflows/feature-pr-approval.yaml
```

The recipe uses built-in `codex` for planning and built-in `claude` for guarded developer and validator nodes. This split is intentional: Codex supports structured output but does not advertise Harny's path-aware `tool_guards`. Confirm that Claude authentication also works before offering this recipe. With only a Codex-compatible endpoint, Harny cannot currently provide the requested guarded implementation contract.

To use an OpenAI-compatible Codex endpoint, merge a logical provider into the existing `providers` array in `~/.harny/providers.json`, preserving `version` and every existing entry. The complete-file example below is suitable only when the file does not exist yet. Then change only the planner's `provider` field from `codex` to that ID:

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

Keep the secret value outside JSON, YAML, chat, and shell history. Have the user's shell or secret manager inject `OPENAI_PROXY_KEY` into the Harny process environment.

Before running, ask the user to customize the recipe's `pull_request.title` and `pull_request.body`; the shipped values are deliberately generic.

Run in async mode so the approval is persisted:

```bash
harny --mode async --workflow feature-pr-approval --name my-feature "implement the feature"
harny show my-feature
```

Approve and resume with a typed answer:

```bash
harny answer my-feature --json '{"approved":true}'
```

Reject without publishing:

```bash
harny answer my-feature --json '{"approved":false}'
```

The approval expires after 24 hours and fails closed because the human node has no fallback. A plain string such as `yes` does not satisfy the typed predicate; use the JSON form above.

Harny validates the workflow and provider capabilities before creating a worktree or calling a provider. Never put endpoint credentials in the repository workflow.
