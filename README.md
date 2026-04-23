# harny

[![npm](https://img.shields.io/npm/v/@lfnovo/harny?label=npm%3A%20%40lfnovo%2Fharny)](https://www.npmjs.com/package/@lfnovo/harny)
[![license](https://img.shields.io/npm/l/@lfnovo/harny)](./CHANGELOG.md)

**The agentic-workflow execution platform — auto-evolving, explainable (auditable), with structured observation and automated improvement-proposal — built for teams that want to extract more value from their AI investments, especially with Claude Code.**

The thesis: as AI does more of the implementation work, the human role splits into two — **make decisions** or **evolve the workflow the AI uses**. Iterating the dev pipeline itself becomes the dominant work of practically every dev. Harny is built to be the place where that work happens.

The mechanism: a planner → developer → validator discipline that catches bad output, structured observation of every run (state.json, transcripts, history, ML features), and a meta-loop that uses those observations to propose harder prompts, missing tooling, missing docs.

## Quickstart

```sh
# Run feature-dev workflow against the current directory.
bunx @lfnovo/harny "build me a calculator CLI in calc.py"

# All runs in this directory + any registered cross-project assistants.
bunx @lfnovo/harny ls

# Visual viewer with run timeline, plan, sibling-branch warnings, Phoenix deep-links.
bunx @lfnovo/harny ui
```

`harny` requires [Bun](https://bun.sh) >= 1.3. The first `bunx` invocation installs the package; subsequent ones run instantly. For frequent use:

```sh
bun add -g @lfnovo/harny
harny "<prompt>"
```

## How it works

A run goes through three phases by default (`feature-dev` workflow):

1. **Planner** reads the prompt, explores the codebase, emits a structured plan (`plan.json`).
2. **Developer** picks up the next pending task, makes code changes in a git worktree.
3. **Validator** runs read-only against the uncommitted tree, returns pass/fail with evidence.

On `pass`, harny composes the commit message and commits. On `fail`, the developer's session resumes with the validator's feedback. After N failed retries, the tree is reset and a fresh developer session starts. Every step is captured in `<cwd>/.harny/<slug>/state.json` — single source of truth, atomic writes, inspectable any time.

Other built-in workflows:

```sh
bunx @lfnovo/harny --workflow docs --input intent.json "document the CLI"
bunx @lfnovo/harny --workflow issue-triage --input issue.json "triage this issue"
bunx @lfnovo/harny --workflow feature-dev-engine "build me X"   # XState-based engine workflow (v0.2.0 preview)
```

## CLI

```
harny [--workflow <id>] [--task <slug>] [--assistant <name>]
      [--isolation worktree|inline] [--mode interactive|silent|async]
      [--input <path>] [-v|--verbose|--quiet]
      "<prompt>"

harny ls [--status X] [--cwd X] [--workflow X]
harny show <runId> [--tail] [--since=<duration>]   # tail = stream live phase activity
harny answer <runId> [<text> | --json '{...}']
harny clean <slug>
harny ui [--port=N] [--no-open]
```

- `--workflow` defaults to `feature-dev`.
- `--assistant` is optional; without it the run targets the current working directory.
- `--task <slug>` controls the branch name (`harny/<slug>`) and the per-run state directory. When omitted, a timestamped slug is generated.
- `--mode silent` is auto-selected when stdin is not a TTY (CI, background runs).
- `harny show <id> --tail` streams the active phase's tool activity in real time. `--since=30s|5m|1h` backfills the recent past before subscribing to new events.

## Observability (opt-in)

Set `HARNY_PHOENIX_URL` to mirror SDK transcripts and tool calls into a local [Phoenix](https://github.com/Arize-ai/phoenix) instance via Arize OpenInference. Each harny run becomes one Phoenix trace named after the task slug, with phase-named child spans and tool sub-spans.

```sh
docker run -d -p 6006:6006 arizephoenix/phoenix:latest
export HARNY_PHOENIX_URL=http://127.0.0.1:6006
bunx @lfnovo/harny "build me a calculator"
```

The viewer surfaces a deep-link to the run's Phoenix trace when this is enabled.

## Cross-project registry (optional)

`~/.harny/assistants.json` registers named working directories. With it, you can:

- Run `harny --assistant my-app "..."` from any directory and have it execute against the registered cwd.
- See runs from all registered projects in `harny ls` and `harny ui`.

```jsonc
{
  "assistants": [
    { "name": "my-app", "cwd": "/Users/me/projects/my-app" },
    { "name": "harny",  "cwd": "/Users/me/dev/harny" }
  ]
}
```

See `assistants.example.json`.

## Per-project config

A repo can ship `harny.json` to override per-phase prompts, tools, model, max turns, MCP servers, isolation mode, default run mode, iteration caps, and platform toggles:

```jsonc
{
  "phases": {
    "planner":   { "model": "sonnet", "maxTurns": 50 },
    "developer": { "model": "sonnet", "maxTurns": 200 },
    "validator": { "model": "sonnet" }
  },
  "isolation": "worktree",
  "defaultMode": "silent",
  "maxIterationsPerTask": 3,
  "maxRetriesBeforeReset": 1,
  "maxIterationsGlobal": 30,
  "coldWorktreeInstall": true,    // auto bun install in fresh worktrees (default true)
  "siblingBranchGuard": true      // post-developer check for unmerged sibling branches touching the same files (default true)
}
```

See `harny.example.json`.

## Custom workflows (preview — v0.2.0 engine layer)

Beyond the built-in `feature-dev`, `docs`, `issue-triage`, and `feature-dev-engine` workflows, you can ship your own as a TypeScript file under `<cwd>/.harny/workflows/<id>.ts` (loader landing in v0.2.0 Phase 2). Engine workflows are XState v5 machines with three primitives:

- `agentActor` — wraps a Claude SDK phase call.
- `commandActor` — wraps `Bun.spawn`.
- `humanReviewActor` — pauses for human approval / refinement.

See [`engine-design.md`](./engine-design.md) for the full architecture and [`src/harness/engine/workflows/echoCommit.ts`](./src/harness/engine/workflows/echoCommit.ts) for a 60-line working example.

## What you get out of the box

- **Discipline** — planner / developer / validator separation catches bad output before it merges.
- **Auditability** — every phase emits structured output (Zod-validated); every run produces `state.json` + transcripts + history.
- **Sibling-branch guard** — automatic detection when your dev touches files another harness branch already owns (prevents silent merge regressions).
- **Cold-install** — fresh worktrees auto-`bun install` so phases never hit missing-module errors.
- **Live tail** — `harny show <id> --tail` for streaming view of running phases.
- **Cross-project view** — one `harny ui` shows runs across all your registered projects.
- **Phoenix integration** — opt-in OpenInference traces, one per run.

## Development

This repo is the source of `harny` itself. To work on it:

```sh
git clone https://github.com/lfnovo/harny
cd harny
bun install
bun run typecheck
bun run harny -- "test prompt"        # local invocation
bun bin/harny.ts ui                   # viewer against local runs
```

Internals live under `src/harness/` (workflows, orchestrator, state, observability), `src/harness/engine/` (XState v0.2.0 layer), and `src/viewer/`. See [`CLAUDE.md`](./CLAUDE.md) for an exhaustive map and the invariants the codebase upholds.

## Releasing

Publishes are tag-driven via `.github/workflows/publish.yml`:

```sh
# 1. bump version in package.json (e.g. 0.1.0 -> 0.1.1)
# 2. update CHANGELOG.md (move [Unreleased] entries under a new [0.1.1] section)
git commit -am "chore(release): v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

The action validates that `package.json:version` matches the tag, runs `bun run typecheck`, and publishes via `npm publish --access public` using the `NPM_TOKEN` repo secret.

## v0.2.0 development

harny v0.2.0 is being built BY harny v0.1.1 itself, in a self-hosting loop documented in [`RELEASE.md`](./RELEASE.md). The XState engine layer (`src/harness/engine/`) lands one prompt at a time; the legacy `feature-dev` workflow (`src/harness/workflows/featureDev/`) remains the production runtime until parity is confirmed.

🏆 **2026-04-23 milestone:** `feature-dev-engine` ran end-to-end against real Claude SDK in a tmp git repo (planner → dev → validator → commit). Engine substitutes legacy in production for the `feature-dev` shape.

Remaining for full v0.2.0: `auto.ts` boundary workflow + router (§4 + §5 of engine-design), state.json v2 schema, real humanReview parking, L1 prompt overlays + variants, deletion of legacy workflows, version bump.

See [`engine-design.md`](./engine-design.md) for architecture (with `§0 Build status snapshot`), [`RELEASE.md`](./RELEASE.md) for self-hosting methodology, [`LEARNINGS.md`](./LEARNINGS.md) for architect-emitted observations across runs, and [`.claude/skills/`](./.claude/skills/) for the operational skills (`release-management`, `review-run`).

## License

MIT
