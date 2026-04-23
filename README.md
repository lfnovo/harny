# harny

[![npm](https://img.shields.io/npm/v/@lfnovo/harny?label=npm%3A%20%40lfnovo%2Fharny)](https://www.npmjs.com/package/@lfnovo/harny)
[![license](https://img.shields.io/npm/l/@lfnovo/harny)](./CHANGELOG.md)

A TypeScript task launcher built on the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript). Implements Anthropic's "harness engineering" pattern: a planner -> developer -> validator loop orchestrated externally, with file-based handoff through `plan.json`. Workflows are configurable, observability is opt-in (Phoenix), and runs are inspectable via a built-in viewer.

## Quickstart

```sh
# Run feature-dev workflow against the current directory.
bunx @lfnovo/harny "build me a calculator CLI in calc.py"

# Show all runs in this directory + any registered assistants.
bunx @lfnovo/harny ls

# Open the visual viewer.
bunx @lfnovo/harny ui
```

`harny` requires [Bun](https://bun.sh) >= 1.3 on the machine that runs it. The first `bunx` invocation installs the package; subsequent ones run instantly. For frequent use, install globally and the binary becomes just `harny`:

```sh
bun add -g @lfnovo/harny
harny "<prompt>"
```

## What it does

A run goes through three phases by default (`feature-dev` workflow):

1. **Planner** reads the prompt, explores the codebase, emits a structured plan (`plan.json`).
2. **Developer** picks up the next pending task, makes code changes in a git worktree.
3. **Validator** runs read-only against the uncommitted tree, returns pass/fail with evidence.

On `pass`, harny commits with a composed message. On `fail`, the developer's session resumes with the validator's feedback. After N failed retries, the tree is reset and a fresh developer session starts.

You can also run the `docs` workflow (writer -> reviewer) or `issue-triage` (one-shot decision on a GitHub issue):

```sh
bunx @lfnovo/harny --workflow docs --input intent.json "document the CLI"
bunx @lfnovo/harny --workflow issue-triage --input issue.json "triage this issue"
```

## CLI

```
harny [--workflow <id>] [--task <slug>] [--assistant <name>]
      [--isolation worktree|inline] [--mode interactive|silent|async]
      [--input <path>] [-v|--verbose|--quiet]
      "<prompt>"

harny ls [--status X] [--cwd X] [--workflow X]
harny show <runId>            (run_id prefix >=8 chars accepted)
harny answer <runId> [<text> | --json '{...}']
harny clean <slug>
harny ui [--port=N] [--no-open]
```

- `--workflow` defaults to `feature-dev`.
- `--assistant` is optional. Without it, the run targets the current working directory and the assistant name is derived from `basename(cwd)`. With it, the run targets a cwd registered in `~/.harny/assistants.json`.
- `--task <slug>` controls the branch name (`harny/<slug>`) and the per-run state directory (`<cwd>/.harny/<slug>/`). When omitted, a timestamped slug is generated.

## Optional: Phoenix observability

Set `HARNY_PHOENIX_URL` to mirror SDK transcripts and tool calls into a local [Phoenix](https://github.com/Arize-ai/phoenix) instance via Arize OpenInference. Each harny run becomes one Phoenix trace named after the task slug, with phase-named child spans and tool sub-spans.

```sh
docker run -d -p 6006:6006 arizephoenix/phoenix:latest
export HARNY_PHOENIX_URL=http://127.0.0.1:6006
bunx @lfnovo/harny "build me a calculator"
```

The viewer surfaces a deep-link to the run's Phoenix trace when this is enabled.

## Optional: cross-project registry

`~/.harny/assistants.json` registers named working directories. With it, you can:

- Run `harny --assistant my-app "..."` from any directory and have it execute against the registered cwd.
- See runs from all registered projects in `harny ls` and `harny ui`, not just the current cwd.

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

A repo can ship a `harny.json` to override per-phase prompts, tools, model, max turns, MCP servers, isolation mode, default run mode, and iteration caps. See `harny.example.json`.

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

Internals live under `src/harness/` (workflows, orchestrator, state, observability) and `src/viewer/`. See `CLAUDE.md` for an exhaustive map and the invariants the codebase upholds.

## Releasing

Publishes are tag-driven via `.github/workflows/publish.yml`:

```sh
# 1. bump version in package.json (e.g. 0.1.0 -> 0.1.1)
# 2. update CHANGELOG.md (move [Unreleased] entries under a new [0.1.1] section)
git commit -am "chore(release): v0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

The action validates that `package.json:version` matches the tag, runs `bun run typecheck`, and publishes via `npm publish --access public` using the `NPM_TOKEN` repo secret (a granular npm token with `Bypass 2FA` enabled, scoped to `@lfnovo/harny`).

## v0.2.0 development (Phase 1)

harny v0.2.0 is being built BY harny v0.1.1 itself, in a self-hosting loop documented in RELEASE.md and engine-design.md. Phase 1 lands the XState engine layer (`src/harness/engine/`) one prompt at a time. The legacy feature-dev workflow (`src/harness/workflows/featureDev/`) remains the production runtime.

See [engine-design.md](./engine-design.md) for architecture, [RELEASE.md](./RELEASE.md) for methodology, [LEARNINGS.md](./LEARNINGS.md) for architect-emitted observations across runs.

## License

MIT
