# harny

Local-first TypeScript runtime for declarative, auditable AI development workflows. It supports Claude and Codex providers, persisted DAG execution, resumable human review, ChangeSet-safe commits, and optional draft PR delivery.

## What you're editing (orientation)

- **Code** lives under `bin/`, `src/runner.ts`, `src/harness/`, `src/viewer/`.
- **Workflow runtime** lives in `src/harness/workflow/`; provider adapters live in `src/harness/providers/`.
- **Normalized agent transcripts** live under `src/harness/transcripts/`; provider adapters stream events into attempt-scoped JSONL sidecars.
- **Operational skills** (architect + operator flows) live in `plugin/skills/`.

## Critical invariants (don't break these)

- **`run.json` v4 is authoritative.** Its `execution` field is the scheduler state; outputs live only on their producing nodes.
- **Harness is the sole committer.** The developer produces a ChangeSet and the validator approves that exact ID/hash before the privileged commit executor stages its recorded paths.
- **Validator is read-only on code** (no Edit/Write). Runs against the uncommitted working tree.
- **Implemented diff = validated diff = committed diff.** Any changed content or newly appearing path after validation fails the run.
- **Dev `blocked` is fatal.** Plan marked `failed`, loop aborts.
- **Provider capabilities are checked before workspace or provider effects.** Workflows cannot request unsupported structured output, resume, guards, or questions.
- **`.harny/.gitignore` is tracked, not runtime-written.** Ships as `*` + `!.gitignore`.
- **There is no historical compatibility layer.** Only run schema v4 and workflow schema v2 are accepted.

## Workflow essentials

- **Runtime: Bun ≥ 1.3.** TypeScript runs natively — no `tsx`, no build step.
- **`bun run typecheck` after every change.**
- **Local dev:** `bun run harny -- "<prompt>"` or `bun bin/harny.ts "<prompt>"`. E2E smoke: `/tmp/harny-e2e-*` dir + `git init` + `bun /path/to/harny/bin/harny.ts "<prompt>"`.
- **State inspection:** `harny ls [--status X]`, `harny show <runId> [--tail]`, `harny answer <runId>`, `harny ui`.
- **Conventional commits.** Never mention Claude Code in commit messages or PR descriptions. No emojis in code, output, or docs. Never implement what wasn't requested — ask before adding improvements.

## Key paths

- `bin/harny.ts` — published bin entrypoint.
- `src/runner.ts` — CLI entry, arg parsing, subcommands (`clean|ls|show|answer|ui`).
- `src/harness/orchestrator.ts` — run lifecycle, Git/worktree setup, and declarative runtime dispatch.
- `src/harness/sessionRecorder.ts` — `runPhase<T>()`, SDK seam.
- `src/harness/state/` — atomic `run.json`, audit events, discovery, views, attempts, and ChangeSets.
- `src/harness/workflow/` — YAML loader, static validation, persisted scheduler, executors, and bundled workflows.
- `src/harness/providers/` — provider-neutral contract plus Claude and Codex adapters.
- `src/harness/forge/` — privileged, idempotent GitHub draft-PR delivery.
- `src/harness/transcripts/` — normalized event contract and attempt-scoped JSONL store.
- `src/viewer/` — read-only HTTP + SPA, booted via `harny ui`.
- `src/harness/workflows/composeCommit.ts` — commit-message composer.
- `src/harness/guardHooks.ts` — `PhaseGuards` (`readOnly` blocks `Write|Edit|MultiEdit|NotebookEdit`; Bash not blocked — validator needs it).
- `src/harness/coldInstall.ts` — cold-worktree `bun install`.

## Config

- **`~/.harny/assistants.json`** (user-global, optional) — named cwds for `--assistant <name>` resolution and cross-project `ls`/`ui`.
- **`HARNY_UI_PORT`** — overrides viewer port (default 4123).

No per-project config file — `harny.json` was removed end-to-end (commit `8c33798`). Workflow defaults live in each workflow's `phaseDefaults`; CLI flags (`--mode`, `--isolation`) are the only per-run overrides.

## Run modes

`RunMode = "interactive" | "silent" | "async"`. Precedence: `--mode` CLI > `Workflow.defaultMode` > auto (TTY → interactive, else silent).

- **interactive:** TTY readline for `ctx.askUser` and SDK `AskUserQuestion`.
- **silent:** `AskUserQuestion` stripped from `allowedTools`; `ctx.askUser` throws `SilentModeError`.
- **async:** `AskUserQuestion` parks to `state.pending_question`; run exits `waiting_human`. Resume: `harny answer <runId> [--json '{...}']` or no-arg interactive walk.

## Gotchas

- **macOS has no `timeout(1)`.** Use in-script `Promise.race` hard deadlines for code. For shell smoke tests, use `cmd & PID=$! ; sleep N ; kill $PID` — do not reach for `timeout N cmd`.
- **Don't use `as const` on arrays passed to SDK `query()` options.** SDK option types are mutable (`SettingSource[]`, not `readonly [...]`). `as const` produces a `readonly` tuple that fails `TS2322`. Annotate with the mutable type instead, e.g. `settingSources: ["project", "user"] as ("project" | "user")[]`.
- **Sibling unmerged branches silently regress on merge.** Before creating a brand-new file path, run `git branch -a` and `git log --all --oneline -- <path>`. A sibling harness branch may already own that path.
- **Harness-managed branches always prefix `harny/`** (legacy: `harness/`). Features introspecting "other harness branches" must filter by `^(harny|harness)/` — unfiltered set includes main, feature/*, stale locals.
- **`noUncheckedIndexedAccess` is enabled.** Array/string index access returns `T | undefined`. Use `?? ''` or explicit guards.
- **Read a recent sibling before adding a new file** to a module — match import style (relative vs `node:`, `.ts` extensions, ordering).
- **Verify command success by exit code** (`cmd; echo "exit: $?"`), not stdout text like "no errors".
- **Harness self-modifications take effect on the NEXT invocation.** The harness binary is frozen at startup; verify on a no-op task.
- **Subcommand conflict.** First positional matching `clean|ls|show|answer|ui` is treated as subcommand. Prompts starting with those words need rephrasing.
- **Claude's `settingSources: ["project", "user"]`** loads the target repo's `.claude/` skills and `CLAUDE.md` redirect automatically; the redirect imports canonical instructions from `AGENTS.md`.
- **Structured outputs missing?** Check the Zod schema for a top-level `$schema` key; `sessionRecorder.ts` strips it before passing to the SDK because the bundled `claude-code` binary silently ignores schemas with it.
- **`.harny/<slug>/` survives `git clean -fd`** (gitignored, untracked protection doesn't apply to gitignored paths).

## Plugin (Claude Code skills + agent)

The `plugin/` directory ships `harny` plugin — a Claude Code plugin with skills and an orchestrator agent for using harny in any repository. Versioned independently of the CLI.

Skills (invoke as `/harny:<name>`):
- **`harny`** — onboarding + router; start here if new to harny.
- **`check-repo`** — pre-flight readiness assessment for adopting harny in a repo.
- **`learn`** — fast, non-analytical capture of a learning into the local inbox.
- **`drain`** — analytical triage of accumulated learnings into Issues / `AGENTS.md` edits / discards.
- **`review`** — post-mortem of a single harny run with leaves-to-trunk analysis and triage tags.
- **`release`** — operate as release manager across multiple harny runs (dispatch → review → triage → loop).

Agent:
- **`orchestrator`** — dispatch and manage harny CLI runs from natural language. Does not auto-invoke `/review` or `/learn`; only suggests.

See `plugin/README.md` for install + structure. The plugin uses `agent-smith` conventions — `plugin/agent-smith-index.json` is the component map.
