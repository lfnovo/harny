# src/harness/engine — engine-specific conventions

This file is loaded on-demand when working under `src/harness/engine/`. The Claude Agent SDK auto-loads only the top-level `CLAUDE.md`; the root file points here so agents working in this subtree read it explicitly before making changes.

Sibling-mirror rule below is the primary discipline: before adding a new dispatcher or probe, read the two most recent siblings as templates.

## Dispatcher convention

Every dispatcher exports two surfaces: (a) a plain `async fn(opts, signal?)` that contains the canonical implementation and serves as the probe surface, and (b) a thin `fromPromise(fn)` actor wrapper used only as the XState adapter. Probes call the async fn directly with an `AbortController` — do not create an actor and call `.stop()` to test abort paths. Subscribing to a `fromPromise` actor's `onError` is unreliable for abort paths: when `signal.abort()` fires, the internal observer routes the rejection through `.error()`, which plain `.subscribe(nextCb)` subscribers never see.

## Sibling-mirror rule

Before adding a new dispatcher or probe, read the two most recent siblings:
- `src/harness/engine/dispatchers/` — pick the two most recently modified `.ts` files as templates for export shape, abort handling, and the SIGKILL + `await proc.exited` pattern.
- `scripts/probes/engine/0N-*.ts` — pick the two most recent probes as templates for scenario structure, `Promise.race` deadline, and PASS/FAIL output format.

Match import style (relative paths, `.ts` extensions, ordering) from the sibling you read.

## Self-contained rule

The engine module (`src/harness/engine/`) does NOT import from `src/harness/git.ts` or other harness internals. It owns its own subprocess and git plumbing. If you need a git operation inside a dispatcher, implement it inline or add a new file under `src/harness/engine/` — do not reach up into the harness layer.

## Workflow composition rule

XState `setup({ actors })` takes actor *logic*, not factories. Use the `*Logic` exports (`commandActorLogic`, `agentActorLogic`, `humanReviewActorLogic`, `commitLogic`, etc.) when composing in `setup`. The base factory exports (`commandActor(opts)`, etc.) are for direct `createActor` / probe use.

## Probe template

Each probe scenario is wrapped in `Promise.race` against a 1500ms hard deadline. Total probe wall-clock must stay under 8s. Use `process.exit(1)` if any scenario fails or times out — validators re-run the probe and read the exit code.
