# harness

TypeScript task launcher built on the Claude Agent SDK. Implements Anthropic's "harness engineering" pattern: a planner → developer → validator loop orchestrated externally, with file-based handoff through `plan.json`.

## Key paths

- `src/runner.ts` — CLI entry. Flags: `--assistant <name>`, `--task <slug>`, `--harness`, `-v/--verbose`.
- `src/harness/orchestrator.ts` — runs planner once, then loops `developer → validator` until the plan is complete or caps are hit.
- `src/harness/phases/` — `planner.ts`, `developer.ts`, `validator.ts`. Each is a thin wrapper over `runPhase<T>()`.
- `src/harness/sessionRecorder.ts` — generic `runPhase<T>()`. Calls `query()` once per phase, passes `outputFormat` + Zod schema, captures every SDK event to `<cwd>/.harness/<slug>/sessions/NNNN_<uuid>.json`, returns the validated `structured_output`.
- `src/harness/plan.ts` — plan.json schema, atomic I/O, mutation helpers.
- `src/harness/verdict.ts` — Zod schemas for planner/developer/validator outputs and the `toJsonSchema()` helper.
- `src/harness/config.ts` + `defaults.ts` — phase defaults and per-project `harness.json` loader (deep-merge; arrays REPLACE).
- `src/harness/git.ts` — preconditions, branch creation, commit helpers.

## Invariants

- **The TS harness is the sole writer of `plan.json`.** Agents return structured verdicts (Zod-validated) and the harness merges them. Never have an agent edit the plan.
- **Validator is read-only on code** (no Edit/Write tools) and uses Bash to exercise the product. A fail keeps the task `in_progress` until `maxIterationsPerTask` is exceeded, then marks it `failed`.
- **One commit per accepted task.** Planner also commits `plan.json`. Branch name is `harness/<task-slug>`. Preconditions (is git repo, clean tree, branch absent) fail fast.
- **Zod schemas must not emit `$schema`.** The bundled `claude-code` binary silently ignores a schema with a top-level `$schema` key — `structured_output` comes back undefined with no error. `verdict.ts:toJsonSchema()` strips it.

## Config files

- `assistants.json` (repo root, gitignored) — named working directories. See `assistants.example.json`.
- `harness.json` (target repo root, optional) — per-project phase overrides. See `harness.example.json`.

## SDK input mode

Single Message Input (`prompt` is a string). One-shot per phase, fresh session every time — matches the harness goal of context reset per phase.

Switch to Streaming Input (prompt becomes an AsyncGenerator) when we need:
- Hooks (PreToolUse, PostToolUse, SessionStart, etc.)
- `canUseTool` callback (custom per-tool-call approval)
- Image attachments in messages
- Dynamic message queueing / interruption

## User preferences

- **Conventional commits.** Do NOT mention Claude Code in commit messages or PR descriptions.
- **No emojis** in code, output, or docs.
- Python work: `uv` + `pytest` + `loguru`.
- Never implement what wasn't requested; ask before adding improvements.

## Workflow

- `npm run typecheck` after any code change.
- End-to-end smoke tests live in throwaway `/tmp/harness-e2e-*` dirs: `git init`, add an entry to `assistants.json`, run the harness with a small multi-step task, inspect `.harness/<slug>/plan.json` + `sessions/`.
- `npm run run -- --harness --assistant <name> [--task <slug>] "<prompt>"` is the full flow.
- `npm run run -- --assistant <name> "<prompt>"` is the legacy single-query path; kept for quick probes.

## Gotchas

- The `claude-code` binary embedded by the SDK uses `jsonSchema` internally; `outputFormat.schema` is translated at the SDK layer. If structured outputs are missing, check the schema for the `$schema` top-level key first.
- `settingSources: ["project", "user"]` loads the target repo's `.claude/` skills and CLAUDE.md — phases benefit from project context automatically.
- Session files buffer events in memory until the `system/init` event provides a session_id. In the unlikely event no init arrives, a `NNNN_no-session-<timestamp>.json` fallback is written.
