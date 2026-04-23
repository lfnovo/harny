# src/harness/observability — Phoenix instrumentation conventions

Opt-in observability via Arize OpenInference. `setupPhoenix({ workflowId, runId, taskSlug, cwd })` is a no-op when `HARNY_PHOENIX_URL` is unset; otherwise registers `@arizeai/phoenix-otel` once per process.

## Per-run shape

- One Phoenix trace per harness run, named after the `--task` slug.
- Root span kind = `AGENT`.
- Phase children are renamed from the SDK's `ClaudeAgent.query` to `harny.<phase>` by the `RenameClaudeAgentSpanProcessor`.
- Project = `basename(cwd)`.
- Resource attributes on every span: `harny.workflow`, `harny.run_id`, `harny.task_slug`, `harny.cwd`.

## Exported wrappers

- `withRunSpan(setup, taskSlug, attrs, body)` — top-level AGENT span. Calls `tracerProvider.forceFlush()` in `finally` before returning.
- `withPhaseContext(setup, phaseName, body)` — wraps each `query()` so the rename processor can collapse spans.

## Invariants

- **Always `forceFlush()` the tracer provider before process exit.** Without it, the `BatchSpanProcessor` commonly drops the root span — the run-level span is the first thing to go. `withRunSpan` does this in its `finally`; do not remove.
- **ESM-namespace-freeze workaround.** Shallow-copy the SDK namespace with `{ ...ClaudeAgentSDKNS }` before passing to `manuallyInstrument`. Without the copy, both Bun and Node throw on namespace mutation. Validated in `scripts/probes/phoenix/02-openinference.ts`.
- **Register once per process.** The `setupPhoenix` guard prevents double registration; don't work around it.

## Viewer integration

Viewer server renders "Open trace in Phoenix" deep-links in the run header. Phoenix's UI doesn't expose CORS, so the viewer resolves project name → GraphQL global ID **server-side** (cached 30s) when building URLs. See `src/viewer/server.ts` for the resolver.

State read: `state.phoenix.{project, trace_id}` from `state.json`.

## Gotchas

- `state.phoenix` is null when Phoenix is off. Viewer code must handle both cases.
- Span renaming only works if every `query()` call is wrapped in `withPhaseContext` — if a phase bypasses `sessionRecorder.runPhase`, its span won't be renamed.

## Typical local setup

```sh
docker run -d -p 6006:6006 arizephoenix/phoenix:latest
export HARNY_PHOENIX_URL=http://127.0.0.1:6006
```
