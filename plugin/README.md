# harny plugin

Claude Code plugin for operating [Harny](https://github.com/lfnovo/harny)'s declarative Claude/Codex workflows from an architect conversation.

Ships skills, an orchestrator agent, and onboarding so you can use harny from a Claude Code conversation without memorizing CLI flags or operational lore.

> **Note:** This plugin is currently developed inside the harny core repo at `plugin/`. It is versioned independently of the `@lfnovo/harny` CLI and may move to its own repo.

## Install

The plugin is distributed via a marketplace manifest at the root of the harny repo. Two ways to load it:

### Permanent install (via marketplace)

```bash
# Add the harny marketplace (local path or GitHub)
claude plugin marketplace add /path/to/harny
# or once published:
# claude plugin marketplace add lfnovo/harny

# Install the harny plugin from it
claude plugin install harny
```

### Session-only (no install, no marketplace)

```bash
claude --plugin-dir /path/to/harny/plugin
```

Useful for testing without modifying global config.

### CLI dependency

The plugin orchestrates the harny CLI; install it separately:

```bash
bun install -g @lfnovo/harny
# or
npm install -g @lfnovo/harny
```

## What you get

### Skills

| Slash command | What it does |
|---|---|
| `/harny:harny` | Onboarding + router — start here if you've never used harny |
| `/harny:check-repo` | Walk you through the readiness checklist for adopting harny in a repo |
| `/harny:learn` | Capture a one-line learning to the local inbox (no analysis) |
| `/harny:drain` | Triage accumulated learnings into Issues / AGENTS.md edits / discards |
| `/harny:review` | Post-mortem of one run using `run.json`, audit events, transcripts, and usage |
| `/harny:release` | Coordinate runs, draft PRs, review fixes, merge approval, tags, and publication |

### Agent

| Invocation | What it does |
|---|---|
| `@orchestrator <intent>` | Selects `feature-dev`, `feature-pr`, an explicit workflow, or `pr fix`; dispatches and monitors without merging or cleaning |

## Conventions

- Skills are stateless. State lives in `<cwd>/.harny/` per the harny CLI conventions.
- The orchestrator agent never auto-invokes `review` or `learn` — it only suggests them. You stay in control of when to triage.
- `check-repo` writes nothing by default — it produces a scorecard you review and act on.
- The plugin never stores provider secrets. Logical provider connections live in `~/.harny/providers.json`; secret values remain in environment variables.

## Versioning

The plugin uses semver independently from the CLI. Plugin `0.3.0` is aligned with Harny CLI `0.5.x` contracts (`run.json` v4 and workflow schema v2).

See `.claude-plugin/plugin.json` for the current version.
