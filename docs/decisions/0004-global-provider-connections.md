# 0004. Keep provider connections global and secrets environment-backed

Status: accepted

## Context and problem

Workflows need logical provider IDs and compatible endpoints, but a repository-controlled connection file could redirect agent traffic or select credential variables. Persisting keys would expose secrets.

## Decision drivers

- Multi-provider and compatible API support.
- Protection from untrusted project configuration.
- Secret rotation without rewriting state.
- Resume safety after endpoint or model changes.

## Considered options

- Provider credentials and endpoints in YAML.
- Project-local provider config.
- User-global definitions with environment-backed secrets.

## Decision

Load provider connections only from `~/.harny/providers.json`. Store type, endpoint, environment variable name, and model; never store the secret value. Fingerprint non-secret resume-relevant configuration into sessions.

## Consequences

- Repositories can select known logical IDs but cannot define connections.
- Missing environment variables fail early.
- Configuration changes reject unsafe resume.
- Secret rotation alone preserves fingerprint compatibility.

## Validation

Strict schema, duplicate, URL, missing-env, stable-secret-rotation, and changed-fingerprint tests enforce the decision.
