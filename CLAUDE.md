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
- **The harness is the sole committer.** The developer proposes a `commit_message` in its verdict but does NOT commit; the harness commits only after the validator passes, with the composed message `<dev>\n\ntask=<id>\nvalidator: <evidence>`.
- **Validator is read-only on code** (no Edit/Write tools) and runs against the uncommitted working tree. It reports `verdict` (pass/fail), and on fail optionally `recommend_reset` to hint that the approach is fundamentally wrong.
- **Retry = resume, reset = fresh.** On fail without reset, the next developer attempt resumes the previous session with only the new validator feedback in the prompt. On reset (validator-recommended or after `maxRetriesBeforeReset`), the tree is rewound with `git reset --hard <pre-phase-sha> && git clean -fd` and the next developer starts a brand-new session. `.harness/<slug>/` survives the clean because it is gitignored.
- **Dev `blocked` is fatal.** If the developer returns `status: "blocked"`, the plan is immediately marked `failed` and the loop aborts. Rationale: either the dev could have unblocked itself (our prompt/tooling bug) or it truly couldn't (plan is infeasible). Both require human triage. This will change once human-in-the-loop feedback exists.
- **Branch only shows committed work.** Before returning on any terminal state (done/failed/exhausted/blocked_fatal), the tree is reset to the last commit so the branch is clean.
- **Zod schemas must not emit `$schema`.** The bundled `claude-code` binary silently ignores a schema with a top-level `$schema` key — `structured_output` comes back undefined with no error. `verdict.ts:toJsonSchema()` strips it.
- **Preconditions are mode-aware.** `assertCleanTree` applies to the PRIMARY working tree only in inline-isolation mode. In worktree mode, phases run in a separate git worktree — the primary's cleanliness is irrelevant to safety and requiring it would block legitimate concurrent or sequential runs that leave untracked per-task state under `.harness/<slug>/` in the primary. When wiring a new isolation mode, gate `assertCleanTree` on `mode === "inline"`.
- **`.harness/.gitignore` is tracked, not runtime-written.** The repo ships a static `.harness/.gitignore` containing `*` + `!.gitignore` (ignore everything inside `.harness/` except this gitignore itself). Any runtime logic that would create or overwrite this file is unnecessary — the file is already there, tracked, and correct. Writing it at runtime is a source of "untracked file dirties the tree" bugs; do not reintroduce that pattern.

## Validation discipline (self-build contract)

While the harness is being built on itself, validator phases MUST exercise acceptance criteria **empirically**, not by inspection alone:

- If an AC says "the harness runs in X mode", the validator must invoke the harness in X mode end-to-end and observe.
- If an AC says "two runs don't collide", the validator must start two runs and observe non-interference.
- If infrastructure prevents empirical exercise (missing dependency, API key not propagated into subprocess env, sandboxed filesystem, tool not in allowedTools, etc.), return **fail** with a `problems` annotation of category `environment` or `tooling` describing the blocker. **Do NOT downgrade to pass on grounds that "the code looks right and the primitives work in isolation"** — that shortcut compounds risk across tiers.

This is a temporary self-build contract. Once workflows are formalized (Tier 1b+), validator strictness becomes a per-workflow override in `harness.json`.

Infrastructure available to validator for empirical runs:
- `npm run run -- --harness --assistant <name> --task <slug> "<prompt>"` — the full harness is invokable from inside validator Bash. If SDK auth fails in the nested subprocess, that is an `environment` blocker and the verdict must be `fail`.
- `/tmp/harness-e2e-*` — throwaway dirs are fair game. `git init`, register a temp assistant, run.
- Two concurrent runs in two terminals = the canonical concurrency test.
- Guard hook for git history ops now has an **escape hatch**: commands that start with `cd /tmp/...`, `cd /private/tmp/...`, `cd /var/folders/...`, or use `git -C <path>` where `<path>` is outside the primary repo, are ALLOWED. This is so you can set up throwaway test repos (`git init && git commit -m seed`) in /tmp without fighting the guard. The sole-committer invariant still applies to the primary repo itself.

**Independence requirement for validators**: your empirical exercise must be YOUR OWN invocation. Inspecting a developer's prior smoke-test artifacts is one input to your evidence, never a substitute for your own run. If an AC says "the harness runs in mode X and commits land", YOU invoke the harness in mode X yourself and observe the commits. Developer smoke-tests may be stale, partial, or accidentally passing due to environment factors that don't replicate. Independent execution is the only protection against blind spots.

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
- Files per task dir: `plan.json` (versioned, single source of state), `sessions/NNNN_<uuid>.json` (per-phase transcripts, gitignored), `audit.jsonl` (append-only decision log, gitignored), `.gitignore` (locks both out of the repo).
- `git clean -fd` only removes untracked files; gitignored `.harness/<slug>/` survives, which is what we want.
