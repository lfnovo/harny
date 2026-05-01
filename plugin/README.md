# harny-plugin

Claude Code plugin for using [harny](https://github.com/lfnovo/harny) in any repository.

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

# Install harny-plugin from it
claude plugin install harny-plugin
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
| `/harny-plugin:harny` | Onboarding + router — start here if you've never used harny |
| `/harny-plugin:check-repo` | Walk you through the readiness checklist for adopting harny in a repo |
| `/harny-plugin:learn` | Capture a one-line learning to the local inbox (no analysis) |
| `/harny-plugin:drain` | Triage accumulated learnings into Issues / CLAUDE.md edits / discards |
| `/harny-plugin:review` | Post-mortem of a single harny run (state + plan + transcripts) |
| `/harny-plugin:release` | Orchestrate a release cycle across multiple harny runs |

### Agent

| Invocation | What it does |
|---|---|
| `Task(subagent_type: "harny-orchestrator", ...)` | Manages the harny CLI on your behalf — turns natural-language intent into a CLI invocation, handles env quirks, monitors the run, reports back |

## Conventions

- Skills are stateless. State lives in `<cwd>/.harny/` per the harny CLI conventions.
- The orchestrator agent never auto-invokes `review` or `learn` — it only suggests them. You stay in control of when to triage.
- `check-repo` writes nothing by default — it produces a scorecard you review and act on.

## Versioning

The plugin uses semver, independent of the `@lfnovo/harny` CLI version. CLI breaking changes do not bump the plugin and vice-versa, except where the plugin actually depends on a specific CLI feature.

See `.claude-plugin/plugin.json` for the current version.
