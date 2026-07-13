# Providers, capabilities, and sessions

`AgentProvider` is the boundary between workflows and vendor SDK behavior. It normalizes requests, structured output, sessions, transcripts, usage, cancellation, errors, and capabilities.

Capabilities let a workflow state what it relies on:

- structured output;
- session resume;
- Harny tool guards;
- interactive questions.

Validation fails before execution when a selected provider cannot satisfy a requirement. This is safer than silently weakening a node's policy.

## Logical connections

A provider ID such as `claude`, `codex`, or `openai_proxy` means a logical connection, not only a vendor. Its type, endpoint, key-variable name, and default model form a connection fingerprint.

Persisted sessions store provider ID and fingerprint. Resume requires both to match. Secret values do not enter the fingerprint, allowing credential rotation without rewriting historical state.

Provider adapters stream vendor events into a common contract while the request is running. Harny persists those events locally per node attempt, including messages, reasoning exposed by the SDK, full tool payloads, file changes, plans, errors, and usage. The runtime never reads transcripts to make scheduling decisions.
