# harny

TypeScript task launcher built on the Claude Agent SDK. Implements Anthropic's "harness engineering" pattern: a planner → developer → validator loop orchestrated externally, with file-based handoff through `plan.json`. Published as `@lfnovo/harny`; runs via `bunx @lfnovo/harny` or `harny` after global install.

## What you're editing (orientation)

- **Code** lives under `bin/`, `src/runner.ts`, `src/harness/`, `src/viewer/`.
- **Before editing the engine** (`src/harness/engine/`) read `src/harness/engine/CLAUDE.md` — engine conventions (dispatcher contract, sibling-mirror rule, probe shape) live there.
- **Before editing observability** (`src/harness/observability/`) read `src/harness/observability/CLAUDE.md` — Phoenix instrumentation has non-obvious workarounds.
- **Operational skills** (architect + operator flows) live in `.claude/skills/harny-*`; full documentation strategy in `specs/documentation.md` (gitignored).

## Critical invariants (don't break these)

- **Harness is the sole writer of `plan.json`.** Agents return Zod-validated verdicts; the harness merges them.
- **Harness is the sole committer.** Developer proposes a `commit_message`; harness commits only after validator passes, composing `<dev>\n\ntask=<id>\n<role>: <evidence>`.
- **Validator is read-only on code** (no Edit/Write). Runs against the uncommitted working tree.
- **Retry = resume, reset = fresh.** Fail-without-reset resumes the prior developer session with only the new validator feedback. Reset does `git reset --hard <pre-phase-sha> && git clean -fd`; `.harny/<slug>/` survives (gitignored).
- **Dev `blocked` is fatal.** Plan marked `failed`, loop aborts.
- **Branch only shows committed work.** Before returning on any terminal state, the tree is reset to the last commit.
- **`.harny/.gitignore` is tracked, not runtime-written.** Ships as `*` + `!.gitignore`.
- **`plan.json` shares the lifecycle key of `state.json` v2 — no independent version number.** If a stale `plan.json` on disk fails validation, run `harny clean` to migrate.

## Workflow essentials

- **Runtime: Bun ≥ 1.3.** TypeScript runs natively — no `tsx`, no build step.
- **`bun run typecheck` after every change.**
- **No human-written TS.** Production code under `src/**/*.ts` and `bin/**/*.ts` lands through harness runs only; see `harny-release` skill Rule 1. Markdown, JSON config, and probes under `scripts/probes/*` may be hand-edited.
- **Local dev:** `bun run harny -- "<prompt>"` or `bun bin/harny.ts "<prompt>"`. E2E smoke: `/tmp/harny-e2e-*` dir + `git init` + `bun /path/to/harny/bin/harny.ts "<prompt>"`.
- **State inspection:** `harny ls [--status X]`, `harny show <runId> [--tail]`, `harny answer <runId>`, `harny ui`.
- **Conventional commits.** Never mention Claude Code in commit messages or PR descriptions. No emojis in code, output, or docs. Never implement what wasn't requested — ask before adding improvements.

## Key paths

- `bin/harny.ts` — published bin entrypoint.
- `src/runner.ts` — CLI entry, arg parsing, subcommands (`clean|ls|show|answer|ui`).
- `src/harness/orchestrator.ts` — run lifecycle, git/worktree setup, dispatches to engine.
- `src/harness/sessionRecorder.ts` — `runPhase<T>()`, SDK seam.
- `src/harness/state/` — `state.json` (v2) + `plan.json` I/O, cross-run helpers.
- `src/harness/engine/` — XState workflows. See subtree CLAUDE.md.
- `src/harness/observability/` — Phoenix instrumentation. See subtree CLAUDE.md.
- `src/viewer/` — read-only HTTP + SPA, booted via `harny ui`.
- `src/harness/workflows/composeCommit.ts` — commit-message composer.
- `src/harness/guardHooks.ts` — `PhaseGuards` (`readOnly` blocks `Write|Edit|MultiEdit|NotebookEdit`; Bash not blocked — validator needs it).
- `src/harness/coldInstall.ts` — cold-worktree `bun install`.

## Config

- **`~/.harny/assistants.json`** (user-global, optional) — named cwds for `--assistant <name>` resolution and cross-project `ls`/`ui`.
- **`HARNY_PHOENIX_URL`** — opt-in Phoenix observability (details in `src/harness/observability/CLAUDE.md`).
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
- **The Read tool errors EISDIR on directories.** Use Glob `<dir>/**/*` or Bash `ls <dir>` for directory discovery.
- **`settingSources: ["project", "user"]`** loads the target repo's `.claude/` skills and CLAUDE.md into phases automatically — phases inherit project context.
- **Structured outputs missing?** Check the Zod schema for a top-level `$schema` key; `sessionRecorder.ts` strips it before passing to the SDK because the bundled `claude-code` binary silently ignores schemas with it.
- **`.harny/<slug>/` survives `git clean -fd`** (gitignored, untracked protection doesn't apply to gitignored paths).

## Skills

- **`harny-release`** — release cycle orchestration (generic, for adopters): dispatch, code-review merges, triage findings, cheap validator patterns, re-orient on fresh context.
- **`harny-review`** — per-run post-mortem: leaves-to-trunk analysis with counterfactual test + triage tags.
- **`harny-learnings`** — capture (`/harny-learnings <text>`) and drain (`/harny-learnings drain`) the local inbox into Issues / CLAUDE.md edits / discards.

Full documentation strategy: `specs/documentation.md` (gitignored working memory).
