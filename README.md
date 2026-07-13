# Harny

Harny is a local-first workflow runtime for auditable AI-assisted software development. Workflows are declarative YAML DAGs, can mix Claude and Codex, persist resumable state locally, and keep privileged effects such as commits and pull-request publication outside the agents.

## Install

Requires Bun 1.3+ and Git.

```bash
bun add -g @lfnovo/harny
# or
bunx @lfnovo/harny "implement the requested feature"
```

Claude workflows use the Claude Agent SDK authentication. Codex nodes use the pinned official Codex SDK and the user's existing Codex authentication/config; a separately installed Codex executable is not required. GitHub PR delivery uses the installed `gh` CLI. Tokens never belong in workflow YAML or Harny's provider config.

## Quick start

```bash
# Planner → sequential tasks → developer/validator retry → validated commits
harny "add JSON export to the CLI"

# Also push and create/update a draft GitHub PR
harny --workflow feature-pr "add JSON export to the CLI"

# Load an explicit workflow file
harny --workflow ./.harny/workflows/custom.yaml "run the custom workflow"

# Address review feedback on the current repository's existing PR
harny pr fix 123
```

Each normal run creates an isolated `harny/<slug>` branch and Git worktree. `--isolation inline` is available when isolation is not wanted.

New to agent harnesses? Start with the [Harny documentation](docs/README.md). It provides a progressive user path and a separate development path for contributors.

## Runtime model

Workflow loading is:

```text
YAML → schema validation → static validation → normalized DAG → scheduler
```

Named workflow precedence is:

```text
<repo>/.harny/workflows > ~/.harny/workflows > bundled workflows
```

Markdown commands use the equivalent `commands/` precedence. Validation occurs before worktree creation or provider cost and checks duplicate IDs, missing dependencies, cycles, output references, retry bounds, human timeouts, provider capabilities, and reachable outcomes.

The v1 scheduler is sequential and deterministic: one ready node runs at a time in declaration order. Supported node types are:

- `agent` — structured provider invocation with optional provider/model override and guards.
- `command` — argv-based subprocess; inline shell scripts and plugins are not workflow escape hatches.
- `foreach` — bounded, sequential steps per item, with persisted step checkpoints.
- `human` — interactive input or persistent async parking with mandatory timeout.
- `commit` — privileged commit of exactly the validated ChangeSet.
- `pull_request` — privileged, idempotent GitHub draft-PR delivery.
- `cancel` — finite terminal cancellation.

Bundled workflows:

- `feature-dev` — plan, implement, independently validate, commit each task, then validate the accumulated branch.
- `feature-pr` — `feature-dev` plus push and draft PR create/update.
- `review-fix` — internal definition used by `harny pr fix <number>` to address feedback on the current remote head.

## Providers and safety

`AgentProvider` normalizes structured output, cwd, sessions, transcripts, usage, cancellation, transient errors, and capabilities. Claude is the default. A node can select Codex:

```yaml
- id: planner
  type: agent
  command: planner
  provider: codex
  requires: [structured_output]
```

Unsupported capabilities fail before execution. In particular, the Codex SDK adapter advertises structured output, session resume, cwd, cancellation, and a read-only sandbox, but does not claim Harny's path-aware per-tool guards.

Logical provider connections can be declared globally in `~/.harny/providers.json`. Project-local provider files are intentionally not loaded, so an untrusted repository cannot redirect agent traffic or choose credential variables:

```json
{
  "version": 1,
  "providers": [
    {
      "id": "claude_proxy",
      "type": "claude",
      "base_url": "https://claude-compatible.example/v1",
      "api_key_env": "CLAUDE_PROXY_API_KEY",
      "model": "claude-compatible-model"
    },
    {
      "id": "codex_proxy",
      "type": "codex",
      "base_url": "https://openai-compatible.example/v1",
      "api_key_env": "CODEX_PROXY_API_KEY",
      "model": "gpt-compatible-model"
    }
  ]
}
```

Set the named environment variables outside the file, then use the logical ID as a workflow's `provider`. `base_url`, key-variable name, provider type, and default model are fingerprinted into persisted sessions; changing the connection prevents an unsafe resume. Secret values are neither persisted nor fingerprinted. The built-in `claude` and `codex` IDs remain available and can also be overridden in this global file.

Developer output is captured as a content-addressed ChangeSet. Validation checks that exact ChangeSet before and after the validator. The commit executor recalculates it, stages only registered paths, and fails if contents changed or an unexpected file appeared:

```text
implemented diff = validated diff = committed diff
```

Before provider validation, a deterministic ChangeSet policy rejects generated dependency trees, credential-like files, and unexpectedly large diffs. `workspace.allow_paths` provides an explicit, audited prefix exception for repositories that intentionally version a protected path. Validators receive the authoritative path manifest, use an attempt-scoped scratch directory, re-run established project gates, and a final validator checks the accumulated committed branch before success or PR delivery.

Agents cannot publish PRs. The GitHub executor:

- accepts only trusted `github.com` remotes;
- uses ordinary push, never force-push;
- verifies the remote head equals the expected commit;
- creates draft PRs by default;
- updates an existing PR idempotently;
- persists repository, number, URL, base, head, and head SHA;
- removes the worktree only after complete confirmation.

`harny pr fix` leases the repository/PR pair, starts from the observed remote head, and refuses to overwrite the PR if its head changes during the run.

## State, recovery, and human review

New runs use:

```text
<cwd>/.harny/<slug>/run.json      # atomic authoritative v4 snapshot
<cwd>/.harny/<slug>/events.jsonl  # append-only audit events
<cwd>/.harny/<slug>/transcripts/  # normalized JSONL, one file per agent attempt
```

The v4 snapshot contains immutable run inputs, run/workspace metadata, the scheduler's exact node instances and attempts, ChangeSets, parent-run linkage, and pending human input. Node outputs live only on the node that produced them; the planner output is the plan, so there is no mirrored artifact or second lifecycle model.

Only v4 runs and workflow schema v2 are supported. Older pointers and runs are ignored; use `harny clean <slug>` before reusing an old slug. Global pointers under `~/.harny/runs/` are a rebuildable index, never a source of truth.

Async human nodes persist their question, session, workspace reservation, and expiry:

```bash
harny --mode async --workflow ./approval-flow.yaml "prepare the change"
harny show <run-id>
harny answer <run-id> "approve"
harny answer <run-id> --json '{"approved":true}'
```

There is no daemon. `show`, `answer`, discovery, and conflicting operations materialize logical expiry. A configured fallback resumes; otherwise the run fails and releases its reservation.

## Inspection and cleanup

```bash
harny ls [--status paused] [--cwd /repo] [--workflow feature-dev]
harny show <run-id-or-slug>
harny show <run-id> --tail
harny ui [--port 4123] [--no-open]
harny scan [<cwd>]
harny clean <slug>
harny clean <slug> --force [--kill]
harny clean --prune
```

`harny show` and the viewer report provider-supplied usage per attempt, node, provider, and run. The viewer also streams each agent attempt's normalized messages, reasoning, tool calls, file changes, plans, errors, and usage from local JSONL sidecars. Tool input/output and reasoning are collapsed by default but retained in full. Claude includes token/cache counts, reported USD cost, and per-model detail. Codex includes token/cache/reasoning counts; Harny does not estimate a cost the provider did not report. Mixed runs label cost coverage as partial. `harny ls` stays compact and does not include usage.

Dead PIDs are materialized as terminal failures instead of leaving permanently running records. Paused worktrees remain reserved; successful completion removes them, while failures preserve them for diagnosis. `harny clean <slug>` removes the entire run directory, including its transcripts; cleanup is never automatic for terminal run evidence.

## Workflow example

```yaml
version: 2
name: verify
defaults:
  provider: claude
  timeout: 600000
workspace:
  isolation: inline
outcome:
  type: none
nodes:
  - id: tests
    type: command
    command: [bun, test]
    retry:
      max_attempts: 2
  - id: approval
    type: human
    question: Ship this result?
    timeout: 86400000
    depends_on: [tests]
```

Custom subprocesses must be argv arrays. Workflow v2 supports immutable `${{ inputs.* }}` references and intentionally excludes inline scripts, parallel scheduling, deploy/merge effects, GitLab/Gitea, webhooks, polling, and cloud workers.

## Development

```bash
bun install
bun run typecheck
bun test
bun run probes
```

The declarative scheduler and `run.json` v4 are the only execution runtime and writable state.

Core code lives under `src/harness/workflow/`, `src/harness/providers/`, `src/harness/forge/`, and `src/harness/state/`. The viewer is under `src/viewer/`.

## License

MIT
