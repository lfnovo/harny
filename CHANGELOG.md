# Changelog

All notable changes to this project are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Phase 2 Tier 1a — Worktree isolation** (`765afa7`). `IsolationMode = "worktree" | "inline"` (default `worktree`). Each task runs in a dedicated git worktree at `<primary>/.harness/worktrees/<slug>/`; `.harness/<slug>/` state stays in the primary so audit survives worktree removal. Auto-remove on done; preserve on fail/blocked/exhausted for debug. CLI flag `--isolation`, harness.json field `isolation`. `assertCleanTree` is gated on `isolation === "inline"` — primary's cleanliness is irrelevant in worktree mode. Path-anchor refactor: `primaryCwd` (state writes) vs `phaseCwd` (SDK + git ops) propagated through `runPhase`, all phase wrappers, plan/audit/problem helpers, guard hooks. New git primitives: `addWorktree`, `removeWorktree`, `assertWorktreePathAbsent`. Smoke test `scripts/worktree-smoke.ts` covers primitives, sequential runs (2nd doesn't trip on 1st's leftover state), and concurrent runs (Promise.allSettled, two worktrees from same primary). Built off-harness after 5 dogfood attempts each exposed a fresh infrastructure bug.
- **Phase 2 Tier 5 (partial) — Three-mode logger** (`ce9c0f5`, merged in `daa8c4c`). `LogMode = "compact" | "verbose" | "quiet"`. `--compact` (new default) surfaces meaningful orchestrator progress only (phase transitions, validator verdict one-liner, decision, commit SHA + subject). `--verbose`/`-v` keeps the full SDK event dump. `--quiet` prints only final status + branch. Threaded through orchestrator, phases, sessionRecorder. TodoWrite agent capture still pending.
- **`harness clean <slug>` CLI subcommand** (`85474cd`). Idempotent cleanup: removes worktree (force), deletes branch, removes `.harness/<slug>/`. Each step a no-op on absent state. Recovers from killed/crashed runs without manual git plumbing.
- **`.harness/.gitignore` tracked statically** (`*` + `!.gitignore`) — replaces the prior runtime-write pattern that race-conditioned with `assertCleanTree` on subsequent runs. Backed in `74ca765`.
- **Transient API error retry** in `runPhase` — up to 3 attempts with exponential backoff (2s/4s/8s, cap 30s) for `overloaded_error`, `rate_limit_error`, HTTP 5xx. Each retry starts a fresh attempt record (preserves prior session file as evidence).
- **Validator escape hatch** in guard hooks — `Write|Edit|MultiEdit|NotebookEdit` to paths outside `phaseCwd` are now allowed (e.g. `/tmp/harness-e2e-*`) so validators can set up empirical fixtures. Primary repo itself stays strict read-only.
- **Developer git-committer escape hatch** — `cd /tmp/...`, `cd /private/tmp/...`, `cd /var/folders/...`, or `git -C <path>` where path resolves outside `phaseCwd` are allowed (throwaway test repos). Forbidden git regex broadened to catch `git -C <path> commit` patterns. Guard probe extended to 21 cases (escape-hatch + sneak-attempt coverage).
- **`PHASE2.md`** — roadmap with status tracker, gating questions resolved/open, evolutions during implementation, and backlog discovered through real dogfood usage.
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
- **Default model swapped to `sonnet`** for all three phases (`fdbf602`). Opus 4× more expensive and noticeably slower; Sonnet proven sufficient for self-build dogfood. Per-project `harness.json` can override back to `opus` for production use.
- **Default `permissionMode` swapped to `bypassPermissions`** (`32f76dd`). The previous `auto` silently fell back to "ask user" in headless / background runs, which never gets answered — Write/Edit calls to `/tmp/harness-e2e-*` paths sat blocked. Guard hooks already enforce the invariants we care about; stacking the SDK's own permission layer on top added only silent failures.
- **Default maxTurns bumped** to planner=50 / developer=200 / validator=200. The previous 10/30/20 were empirically insufficient for non-trivial work — planner ran out exploring a medium codebase, validator ran out doing nested empirical runs under the independence contract. Real-world agentic engineering tasks span many turns; these limits are safety caps, not targets.
- **VALIDATOR_PROMPT tightened twice during dogfood**: (1) explicit "INDEPENDENT empirical exercise required — developer artifacts are one input, never a substitute for your own run", (2) "ONE comprehensive nested run per task max; for cosmetic/additive changes, structural review + smoke run is sufficient — don't recurse the harness per AC". The second pass was added after observing 4× full nested invocations from a single validator burning 9+ minutes on one Bash call.
- **PLANNER_PROMPT tightened**: explicit task-granularity guidance — default to the smallest viable plan; 1 task is right for narrow refactors and additive features; 2-3 only for distinct validation surfaces; 4+ ONLY for genuinely independent shippable units. Cost framing stated in-prompt so the planner has the right objective function. Added after observing the planner default-splitting "add a logger flag" into 4 tasks, multiplying validator cost.
- **DEVELOPER_PROMPT augmented** with idempotency-check rule: when the task changes how the harness is invoked (new flags, modes, preconditions, isolation, state on disk), smoke tests MUST run the harness twice consecutively — many bugs only surface on the second run when the first leaves untracked state behind.
- **Commits now happen only after validator pass.** The developer no longer commits during its phase; it proposes a conventional-commit `commit_message` in its structured output. The harness composes the final commit as `<developer message>\n\ntask=<id>\nvalidator: <evidence>` and creates it from the working tree.
- Reset path uses `git reset --hard <pre-phase-sha>` + `git clean -fd` (ignored files survive, so `.harness/<slug>/` sessions + audit log are preserved).
- `blocked` from the developer is now **fatal** — the whole plan is marked `failed` and the loop aborts. Rationale: if the agent could have unblocked itself it would have; if it couldn't, human triage is required. This is temporary until human-in-the-loop feedback exists.
- On task fail (exhausted retries) or blocked, the working tree is reset to the pre-phase SHA so the branch only shows committed work.
- Developer prompt no longer instructs the agent to commit; validator prompt notes that changes are uncommitted when it runs.

### Fixed
- `.gitignore` pattern `node_modules/` (with trailing slash) only matched directories — symlinks named `node_modules` slipped through and got tracked when an agent created one inside its worktree to make `npm` work there. Tightened to `node_modules` (no trailing slash) catches files, dirs, and symlinks. The accidental tracked symlink was also dropped (`74ca765`).
- Planner `maxTurns: 10` was too low for non-trivial codebases — bumped twice during dogfood, ultimately settling at 50.

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
