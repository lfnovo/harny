# Add a provider

## Implement the boundary

Add an adapter implementing `AgentProvider` in `src/harness/providers/`:

- stable logical `id` and `connectionFingerprint`;
- honest capabilities;
- structured request/output conversion;
- cwd and cancellation propagation;
- normalized session and resume checks;
- normalized streamed events and usage;
- typed partial metadata on failures or pauses.

Vendor SDK types must not escape into workflow, runtime, state, CLI, or viewer modules.

## Configuration

If the provider needs user configuration, extend the strict global schema deliberately. Never accept secret values in JSON or project-local endpoint configuration without revisiting the security decision.

Connection fingerprints include resume-relevant non-secret configuration. Document which changes invalidate a session.

## Contract tests

Cover at least:

- valid structured output and a second schema validation;
- cwd/model/options propagation;
- session creation and resume;
- foreign and changed-fingerprint rejection;
- cancellation;
- provider/stream/schema errors with partial metadata;
- usage mapping including zero values and unavailable cost;
- lifecycle, message, reasoning, tool, and provider-specific event normalization;
- SDK behavior under Bun, using a controlled executable or transport when possible.

Add workflow validation tests for every declared capability. A capability is a safety contract, not a marketing feature flag.
