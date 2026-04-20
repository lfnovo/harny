# Changelog

All notable changes to this project are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Phase 2 Tier 0**: three invariant guard hooks registered per-phase in `sessionRecorder`. Validator `PreToolUse` denies `Write|Edit|MultiEdit|NotebookEdit` (read-only invariant). Developer `PreToolUse` denies writes to `.harness/<slug>/plan.json` (sole-writer invariant) and Bash commands matching history-changing git operations (`commit|push|reset|rebase|merge|revert|cherry-pick|tag|am` or `--amend`) (sole-committer invariant). Unit-tested via `scripts/guard-probe.ts` (13/13 cases).
- **Phase 2 Tier 0**: problem annotation capture. `DeveloperVerdictSchema` and `ValidatorVerdictSchema` gain an optional `problems: Problem[]` field (`{category, severity, description}` with categories `environment | design | understanding | tooling`). Orchestrator writes one file per problem to `.harness/<slug>/problems/<id>.json` — idempotent, append-only, safe under git merges. Schema versioned at `schema_version: 1`. Dataset accumulates from day one for the future `/improve` consumer.
- `PHASE2.md` — roadmap with 11 tiers, gating questions, completion criteria. Drives session-by-session pull-down of Phase 2 work.
- Empirical probe (`scripts/hook-probe.ts`) proving hooks DO fire in Single Message Input mode, contradicting a claim in the streaming-vs-single doc. Streaming mode is therefore not a prerequisite for Phase 2.
- Validator now reports a third signal `recommend_reset` alongside `verdict` and `reasons`. When true, the harness wipes the working tree and starts the next attempt fresh instead of resuming.
- `maxRetriesBeforeReset` config (default 1) — after N failed retries the harness forces a reset regardless of the validator's recommendation.
- `audit.jsonl` append-only log at `.harness/<slug>/audit.jsonl` with every developer outcome, validator verdict, harness decision (retry/reset/commit/failed/blocked_fatal), and commit/reset execution records. Task-local `.gitignore` excludes it.
- Retry path resumes the developer's previous session (`resume: sessionId`) with only the new validator feedback in the prompt; reset path starts a fresh session.
- `commit_sha` at the task level in `plan.json` — records the single commit that represents the accepted task.

### Changed
- **Commits now happen only after validator pass.** The developer no longer commits during its phase; it proposes a conventional-commit `commit_message` in its structured output. The harness composes the final commit as `<developer message>\n\ntask=<id>\nvalidator: <evidence>` and creates it from the working tree.
- Reset path uses `git reset --hard <pre-phase-sha>` + `git clean -fd` (ignored files survive, so `.harness/<slug>/` sessions + audit log are preserved).
- `blocked` from the developer is now **fatal** — the whole plan is marked `failed` and the loop aborts. Rationale: if the agent could have unblocked itself it would have; if it couldn't, human triage is required. This is temporary until human-in-the-loop feedback exists.
- On task fail (exhausted retries) or blocked, the working tree is reset to the pre-phase SHA so the branch only shows committed work.
- Developer prompt no longer instructs the agent to commit; validator prompt notes that changes are uncommitted when it runs.

## [0.1.0] — 2026-04-20

### Added
- CLI launcher (`src/runner.ts`) built on `@anthropic-ai/claude-agent-sdk`. Streams every SDK event into a per-session JSON file.
- `assistants.json` registry of named working directories, selected via `--assistant <name>`. Paths resolve relative to the file itself. A gitignored config with `assistants.example.json` documenting the schema.
- `--verbose` / `-v` flag that dumps every SDK event as it arrives.
- Three-phase harness orchestration (planner → loop(developer → validator)), activated by `--harness`. Planner runs once; dev/validator loop until the plan is complete or iteration caps are hit.
- `--task <slug>` with a timestamp fallback. The harness creates a `harness/<slug>` branch, commits `plan.json` after planning, and commits once per accepted task.
- `plan.json` lives at `<cwd>/.harness/<slug>/plan.json` and is written only by the TypeScript layer. Agents return Zod-validated structured verdicts that the harness merges in.
- Precondition checks before any work (is git repo, clean tree, branch absent). Fail fast on any violation.
- Per-project `harness.json` at the target repo root overrides defaults per phase (prompts, tools, model, effort, `maxTurns`, MCP servers). Deep-merge, arrays replace. Library defaults live in `src/harness/defaults.ts`.
- Structured outputs via the SDK's native `outputFormat: { type: "json_schema", ... }`. Schemas defined as Zod in `src/harness/verdict.ts`; `z.toJSONSchema()` feeds the SDK.
- Ordinal prefix on session files (`NNNN_<session_id>.json`) so execution order is obvious without parsing UUIDs.
- `.gitignore` inside each task directory so `sessions/` stays untracked while `plan.json` is versioned.
- `harness.example.json` documenting the per-project config schema.

### Fixed
- `toJsonSchema()` strips the top-level `$schema` key produced by `z.toJSONSchema()`. The bundled `claude-code` binary silently ignores any schema that has `$schema` at the top, causing `structured_output` to come back undefined with no error — manifested as the planner "succeeding" with free-form text instead of the validated plan.
