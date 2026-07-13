---
name: harny
description: Onboard and route users through Harny's declarative Claude/Codex workflows, local run state, provider configuration, human review, PR delivery, inspection, and cleanup. Use when someone is new to Harny, asks how it works, or needs help choosing the right Harny skill or workflow.
allowed-tools: Bash, Read
---

# Harny

Explain Harny as a local-first workflow runtime, then route the user to the narrowest skill or command that solves the job.

## Mental model

Harny loads a declarative YAML DAG, validates it before provider or workspace effects, and executes one ready node at a time. A run can mix Claude and Codex. The default `feature-dev` workflow plans work, executes tasks sequentially, validates each exact ChangeSet, commits through a privileged executor, and performs a final accumulated validation.

The key invariant is:

```text
implemented diff = validated diff = committed diff
```

Agents do not publish pull requests or commit directly. Harny owns those privileged effects.

## Route requests

| Intent | Route |
| --- | --- |
| Assess whether a repository is ready | `/harny:check-repo` |
| Capture a learning without analysis | `/harny:learn <text>` |
| Triage captured learnings | `/harny:drain` |
| Analyze a completed or failed run | `/harny:review <run>` |
| Coordinate several runs toward a release | `/harny:release` |
| Delegate CLI dispatch and monitoring | `@orchestrator <intent>` |

Do not invoke another skill automatically unless the user asks.

## Install and verify

```bash
bun install -g @lfnovo/harny
# or: npm install -g @lfnovo/harny
harny --version
gh auth status # only needed for PR delivery
```

Harny requires Bun 1.3+, Git, and at least one commit in the target repository.

## Choose a workflow

- `feature-dev`: create a validated local branch. This is the default.
- `feature-pr`: create or update a draft GitHub PR after validated commits.
- `harny pr fix <number>`: address feedback on an existing PR from its pinned remote head.
- Project/global YAML: select with `--workflow <name-or-path>`.

Examples:

```bash
harny --name json-export "add JSON export to the CLI"
harny --workflow feature-pr --name json-export "add JSON export to the CLI"
harny --workflow ./.harny/workflows/verify.yaml --name verify "run verification"
harny pr fix 123
```

Named workflow variants use `--workflow id:variant`. There is no separate `--variant` flag.

## State and inspection

Run evidence lives under `<repo>/.harny/<slug>/`:

- `run.json`: authoritative v4 snapshot with inputs, workspace, scheduler nodes, attempts, ChangeSets and pending human input.
- `events.jsonl`: append-only audit events.
- `transcripts/`: normalized provider events per node attempt.

Inspect without parsing schemas manually when possible:

```bash
harny ls
harny show <run-id-or-slug>
harny show <run-id> --tail --since 5m
harny ui
```

The viewer and `show` expose attempts, normalized transcripts and provider-reported usage. Harny never invents unreported cost.

## Providers

Built-in logical IDs are `claude` and `codex`. Configure additional connections only in `~/.harny/providers.json`; never place secrets in that file or in workflow YAML. `base_url`, provider type, key environment-variable name and model participate in the persisted connection fingerprint.

Claude supports structured output, resume, Harny tool guards and interactive questions. Codex supports structured output and resume, but does not claim Harny's path-aware tool guards or interactive questions. Unsupported workflow capabilities fail before execution.

Harny prevents project application `.env*` files from silently selecting Anthropic credentials, then loads optional `~/.harny/.env` and `./harny.env`. Do not recommend clearing `ANTHROPIC_API_KEY` manually. Use `HARNY_INHERIT_ENV=1` only when the user explicitly wants legacy environment inheritance.

## Human review

Use `--mode async` for persistent parking. There is no daemon.

```bash
harny --mode async --workflow ./approval.yaml --name approval "prepare the change"
harny show approval
harny answer approval "approve"
harny answer approval --json '{"approved":true}'
```

Paused worktrees remain reserved. Discovery and answer commands materialize logical expiry; a configured fallback resumes, otherwise the run fails.

## Repository customization

Precedence is project > user-global > bundled:

```text
<repo>/.harny/workflows  > ~/.harny/workflows  > bundled workflows
<repo>/.harny/commands   > ~/.harny/commands   > bundled commands
```

Prompt overrides live at `.harny/prompts/<workflow>/<variant>/<actor>.md`. Because generated `.harny/*` is normally ignored, explicitly retain versioned workflows, commands or prompts in `.harny/.gitignore`.

Do not synthesize advanced workflow YAML from memory. For a mixed-provider draft PR with persistent approval, read [workflow-recipes.md](workflow-recipes.md) and start from its validated [feature-pr-approval.yaml](feature-pr-approval.yaml). If no supplied recipe matches, consult the installed workflow schema and validate a project workflow before recommending that it be run.

## Cleanup

Terminal run evidence is not removed automatically.

```bash
harny clean <slug>
harny clean <slug> --force       # permit SIGTERM for a live run
harny clean <slug> --force --kill
harny clean --prune
harny scan /path/to/repository
```

Cleaning removes the local run directory, transcripts, worktree, local `harny/<slug>` branch and matching pointers. It does not remove remote branches or PRs. Review valuable evidence before cleaning.

## First adoption

1. Run `/harny:check-repo`.
2. Confirm clean install and deterministic validator commands on the base branch.
3. Add concise `AGENTS.md` guidance; keep `CLAUDE.md` as `@AGENTS.md` when Claude compatibility is wanted.
4. Start with one small, observable task.
5. Review the diff and run evidence before merging.
6. Use `/harny:review` for retries, failures, slow runs or novel behavior.

## Boundaries

- Do not dispatch from this routing skill; use the orchestrator agent.
- Do not merge, clean, or answer human questions without explicit user intent.
- Do not claim old `state.json`/`plan.json` compatibility. Harny 0.5 accepts run schema v4 and workflow schema v2 only.
