# harny

TypeScript task launcher built on the Claude Agent SDK. Implements Anthropic's "harness engineering" pattern: a planner → developer → validator loop orchestrated externally, with file-based handoff through `plan.json`.

Published as `@lfnovo/harny` on npm (the unscoped `harny` name was blocked by npm's anti-typosquatting filter for similarity to `yarn`/`vary`); runs via `bunx @lfnovo/harny` against the current working directory by default. Global install via `bun add -g @lfnovo/harny` exposes the binary as just `harny`.

## Key paths

- `bin/harny.ts` — published bin entrypoint (shebang + import of `src/runner.ts`).
- `src/runner.ts` — CLI entry. Flags: `--assistant <name>` (opt-in; defaults to `process.cwd()`), `--task <slug>`, `--workflow <name>` (default `feature-dev`), `--input <path>`, `--isolation <worktree|inline>`, `--mode <interactive|silent|async>`, `-v/--verbose`, `--quiet`. Subcommands (recognized when first positional matches): `clean <slug>`, `ls [--status X] [--cwd X] [--workflow X]`, `show <runId> [--tail] [--since=<duration>]` (run_id prefix ≥8 chars accepted; `--tail` streams active phase activity, `--since=Ns|Nm|Nh` backfills recent events), `answer <runId> [<text> | --json '{...}']` (no-arg form walks parked batches interactively), `ui [--port=N] [--no-open]` (boots local viewer + opens browser).
- `src/harness/orchestrator.ts` — generic interpreter. Resolves workflow from registry, sets up git/branch/worktree per workflow flags, then branches on workflow shape: **engine path** (`isEngineWorkflow`) calls `runEngineWorkflow` directly (XState createActor; no plan, no buildCtx, no commitComposed); **legacy path** builds `WorkflowContext`, calls `workflow.run(ctx)`, and wraps in `withRunSpan(...)`. Catches `PausedForUserInputError` from phases and exits cleanly with `status: "waiting_human"`. Idempotent rerun guard: refuses to clobber an existing `state.json` (done/failed = exit gracefully, running = error with stale-pid hint, waiting_human = error with `harny answer` hint).
- `src/harness/workflow.ts` — the `Workflow` contract: `id`, `needsBranch`, `needsWorktree`, `inputSchema?`, `phaseDefaults`, `defaultMode?`, `run(ctx)`, `resumeFromAnswer?(ctx, answer: string | Record<string,string>)`. Plus `WorkflowContext` and the `defineWorkflow()` helper.
- `src/harness/sessionRecorder.ts` — generic `runPhase<T>()`. Calls `query()` with `cwd: phaseCwd`, returns the validated `structured_output`. Transcripts are NOT written by us — the SDK persists them to `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` and (when `HARNY_PHOENIX_URL` is set) Phoenix mirrors via OpenInference instrumentation. Wraps each `query()` in `withPhaseContext(setup, phaseName, body)` so the rename span processor can collapse the SDK's `ClaudeAgent.query` span into `harny.<phaseName>`. Retries up to 3 times on transient API errors. Strips `$schema` from Zod-emitted JSON schemas before passing to the SDK. Wires `canUseTool` mode-aware: silent strips `AskUserQuestion` from allowedTools; async parks via deny+interrupt.
- `src/harness/state/` — files written to `.harny/<slug>/`:
  - `schema.ts` — Zod schema for `state.json` (single source of truth per run). Types: `State`, `PhaseEntry`, `HistoryEntry`, `HumanReviewHistoryEntry`, `PendingQuestion`, `PhoenixRef`. `schema_version: 2`. V1 files are rejected outright (no migration). New v2 fields: `origin.features` (free-form router features map, nullable), `workflow_chosen` ({ id, variant }, nullable), `history[]` supports `human_review` entries (discriminated union) alongside legacy `{ at, phase, event }` entries.
  - `store.ts` — `StateStore` interface bound to one run dir.
  - `filesystem.ts` — `FilesystemStateStore` impl (read-modify-write atomic via `writeJsonAtomic`). Plus cross-run discovery helpers: `listRunsInCwd(cwd)`, `listAllRuns(cwds[])`, `findRun(cwds[], runIdOrSlug)`.
  - `plan.ts` — `Plan` I/O for `feature-dev`'s `plan.json`, atomic save, path helpers (`planDir`, `planFilePath`, `worktreePathFor`).
  - `problem.ts` — `Problem` schema + `writeProblems` (one file per problem under `problems/`). Available to workflows that emit Problem annotations.
  - `audit.ts` — legacy `AuditEntry` type retained only for the `WorkflowContext.audit` callback signature; the writer function is no longer called (history is folded into `state.json:history[]`).
- `src/harness/observability/phoenix.ts` — opt-in Phoenix observability via Arize OpenInference. `setupPhoenix({ workflowId, runId, taskSlug, cwd })` is a no-op when `HARNY_PHOENIX_URL` is unset; otherwise registers `@arizeai/phoenix-otel` once per process (project = `basename(cwd)`), patches the SDK namespace with the ESM-namespace-freeze workaround, and adds a `RenameClaudeAgentSpanProcessor` that renames the SDK's `ClaudeAgent.query` span to `harny.<phase>`. Exports `withRunSpan(setup, taskSlug, attrs, body)` (top-level AGENT span; calls `tracerProvider.forceFlush()` before returning) and `withPhaseContext(setup, phaseName, body)`.
- `src/viewer/` — read-only HTTP wrapper + vanilla JS SPA for browsing runs. Boot via `harny ui`. `server.ts` exposes `/api/{health,config,assistants,runs,runs/:cwdHash/:slug,runs/:cwdHash/:slug/git-log}` and serves `index.html`. Phoenix project name → GraphQL ID lookup runs server-side (Phoenix has no CORS) and is cached 30s.
- `src/harness/types.ts` — shared types: `LogMode`, `IsolationMode`, `RunMode`, `PhaseName`, `PhaseConfig`, `ResolvedPhaseConfig`, `HarnessConfigFile`, `ResolvedHarnessConfig`, `Plan`, `PlanTask`, `PlanTaskHistoryEntry`.
- `src/harness/config.ts` — `loadHarnessConfig(cwd, workflow, cliMode?)` — accepts any object with optional `phaseDefaults` and `defaultMode` (duck-typed `WorkflowConfigLike`; both `Workflow` and engine workflow stubs satisfy it). Deep-merges `workflow.phaseDefaults` with `harny.json`'s `phases` map. Exports `resolveRunMode(cli, file, workflow)` with precedence: CLI > `harny.json` `defaultMode` > workflow `defaultMode` > auto.
- `src/harness/askUser.ts` — `resolveAnswer`, `runAskUserQuestionTTY`, `denyAskUserQuestionHeadless`, `SilentModeError`, `PausedForUserInputError`.
- `src/harness/git.ts` — preconditions, branch creation, commit helpers, worktree primitives.
- `src/harness/guardHooks.ts` — `PhaseGuards` (`{readOnly?, noPlanWrites?, noGitHistory?}`) + `buildGuardHooks`. Escape hatch for paths outside phase cwd (e.g., `/tmp/harny-e2e-*`) is honored.
- `src/harness/clean.ts` — `clean <slug>` subcommand: idempotent worktree + branch + state dir cleanup.
- `src/harness/workflows/` — workflow catalog. Self-contained per workflow: own verdict schemas, prompts, defaults. Registry in `index.ts` exports `getWorkflow(id): Workflow | WorkflowDefinition<any>` and `isEngineWorkflow(w): w is WorkflowDefinition<any>` (checks for `.machine` + absence of `.run`). Engine workflows (e.g., `echo-commit`) are registered alongside legacy ones. New legacy workflows go here; new engine workflows live in `src/harness/engine/workflows/` and are imported into this registry.
- `src/harness/engine/runtime/runEngineWorkflow.ts` — `runEngineWorkflow(workflow, { cwd, userPrompt, taskSlug, runId, log?, mode?, logMode?, timeoutMs? })`: if `workflow.buildActors` is defined, calls `machine.provide({ actors: workflow.buildActors(deps) })` first; then `createActor(machine, { input: { cwd, userPrompt } })`, subscribes to `{ next, error }` (machine errors fast-fail, not just snapshot transitions), resolves when final state reached, calls `actor.stop()` in finally. Default deadline 600_000ms (10 min); overridable via `ctx.timeoutMs`.
- `src/harness/engine/runtime/runPhaseAdapter.ts` — `adaptRunPhase(deps)` bridges the engine to `sessionRecorder.runPhase`. Required `deps.phaseConfig: ResolvedPhaseConfig` (no bogus defaults — caller passes a real config like `DEFAULT_PLANNER`). Threads `mode`, `logMode`, `outputSchema` (the engine's actual Zod schema, NOT z.unknown), `resumeSessionId`. Optional `sessionRunPhase` DI seam for probes; default = real `runPhase` import.
- `src/harness/engine/workflows/featureDev.ts` — `feature-dev-engine` machine: `planning → loop[developer → validator → committing → next] → done|failed`. Default export sets `buildActors: buildFeatureDevActors`.
- `src/harness/engine/workflows/featureDevActors.ts` — `buildFeatureDevActors(deps)` builds production actors. Reuses legacy `DEFAULT_PLANNER/DEVELOPER/VALIDATOR` configs and `PlannerVerdictSchema/DeveloperVerdictSchema`. Defines engine-only `EngineValidatorVerdictSchema` (extends legacy `pass|fail` to include `blocked`) so the SDK can produce all three. Includes a `commitActor` over `gitCommit` for the `committing` state.
- `src/harness/engine/harnyActions.ts` — effect actions (`gitCommit` auto-stages via `git add -A` first; throws on empty stage), pure-state assigns (`advanceTask`, `bumpAttempts`, `stashValidator`, `stashDevSession`) typed against `PlanDrivenContext`. Plus `*Logic` constants (`commandActorLogic`, `commitLogic`, etc.) for `setup({ actors })` composition (factories like `commandActor(opts)` are for direct `createActor` use).
- `src/harness/workflows/composeCommit.ts` — `composeCommitMessage({ devMessage, taskId, role, evidence })`: strips pre-existing `task=<id>` trailers from devMessage before appending exactly one — prevents the duplicate-trailer bug. Used by both legacy and engine paths.
- `src/harness/coldInstall.ts` — `coldInstallWorktree({ worktreePath, primaryCwd })`: detects missing `node_modules` in fresh worktree and runs `bun install` (gated by `harny.json:coldWorktreeInstall`, default `true`). Called from orchestrator after `addWorktree`.

## Invariants

- **The TS harness is the sole writer of `plan.json`.** Agents return structured verdicts (Zod-validated) and the harness merges them.
- **The harness is the sole committer.** The developer proposes a `commit_message` in its verdict but does NOT commit; the harness commits only after the validator passes, with the composed message `<dev>\n\ntask=<id>\nvalidator: <evidence>`.
- **Validator is read-only on code** (no Edit/Write tools) and runs against the uncommitted working tree.
- **Retry = resume, reset = fresh.** On fail without reset, the next developer attempt resumes the previous session with only the new validator feedback. On reset, the tree is rewound with `git reset --hard <pre-phase-sha> && git clean -fd` and the next developer starts a brand-new session. `.harny/<slug>/` survives the clean because it is gitignored.
- **Dev `blocked` is fatal.** If the developer returns `status: "blocked"`, the plan is immediately marked `failed` and the loop aborts.
- **Branch only shows committed work.** Before returning on any terminal state, the tree is reset to the last commit so the branch is clean.
- **Zod schemas must not emit `$schema`.** The bundled `claude-code` binary silently ignores a schema with a top-level `$schema` key. `sessionRecorder.ts` strips it before passing to the SDK.
- **Preconditions are mode-aware.** `assertCleanTree` applies to the PRIMARY working tree only in inline-isolation mode. In worktree mode, phases run in a separate git worktree.
- **`.harny/.gitignore` is tracked, not runtime-written.** The repo ships a static `.harny/.gitignore` containing `*` + `!.gitignore`. Do not write it at runtime.

## Config files

- `~/.harny/assistants.json` (user-global, optional) — named working directories registered for `harny` invocation. With it, `--assistant <name>` resolves to a registered cwd and `harny ls`/`harny ui` see runs across all registered projects. Without it, `harny` operates on `process.cwd()` only. See `assistants.example.json` for schema.
- `<cwd>/.harny/<slug>/state.json` (per-run, atomic write) — single source of truth for one harness invocation. Schema versioned at `schema_version: 2` (v1 files rejected with a clear error naming the run dir). Holds origin (+ features), environment, lifecycle, phases[], history[], pending_question, workflow_state, workflow_chosen, and (when Phoenix is enabled) `phoenix: {project, trace_id}`.
- `<cwd>/.harny/<slug>/plan.json` (per-run, feature-dev only) — versioned plan with `tasks: PlanTask[]`, written exclusively by the harness.
- `harny.json` (target repo root, optional) — per-project overrides: `phases` map, `isolation`, `defaultMode`, `maxIterationsPerTask`, `maxIterationsGlobal`, `maxRetriesBeforeReset`, `coldWorktreeInstall` (boolean, default `true`) — auto `bun install` in fresh worktrees, `siblingBranchGuard` (boolean, default `true`) — post-developer sibling-branch ownership check. See `harny.example.json`.

## Environment variables

- `HARNY_PHOENIX_URL` — when set, turns on Phoenix observability (Arize OpenInference instrumentation; one trace per harness run; project = `basename(cwd)`; trace name = `--task` slug). Absent → zero-overhead no-op. Typical local setup: `docker run -d -p 6006:6006 arizephoenix/phoenix:latest` then `export HARNY_PHOENIX_URL=http://127.0.0.1:6006`.
- `HARNY_UI_PORT` — overrides the default port (4123) for `harny ui`.

## SDK input mode

Single Message Input (`prompt` is a string). One-shot per phase, fresh session every time — matches the harness goal of context reset per phase. Empirically verified that hooks AND `canUseTool` both fire in Single Mode — see `scripts/hook-probe.ts` and `scripts/canusetool-probe.ts`.

## Run modes

`RunMode = "interactive" | "silent" | "async"` controls how human-in-the-loop interactions are handled. Resolution precedence: `--mode` CLI flag > `harny.json` `defaultMode` > `Workflow.defaultMode` > auto (`process.stdin.isTTY` → `interactive`, else `silent`).

- **interactive**: TTY readline for both `ctx.askUser` and the SDK's `AskUserQuestion` tool.
- **silent**: `AskUserQuestion` is stripped from `allowedTools` before `query()`; `ctx.askUser` throws `SilentModeError`.
- **async**: `AskUserQuestion` calls park as `state.pending_question`, run exits `waiting_human`. Resume with `harny answer <runId> [--json '{...}']` or `harny answer <runId>` (interactive walk).

## Phoenix observability (opt-in)

Set `HARNY_PHOENIX_URL` (e.g. `http://127.0.0.1:6006`) before running. Per-run shape: one Phoenix trace per harness run, named after the `--task` slug; root span kind=AGENT; phase children renamed from `ClaudeAgent.query` to `harny.<phase>`. Project = `basename(cwd)`. Resource attributes on every span: `harny.workflow`, `harny.run_id`, `harny.task_slug`, `harny.cwd`. The viewer reads `state.phoenix.{project, trace_id}` from `state.json`, resolves the project name → Phoenix GraphQL ID server-side, and renders an "Open trace in Phoenix" deep-link in the run header.

## User preferences

- **Conventional commits.** Do NOT mention Claude Code in commit messages or PR descriptions.
- **No emojis** in code, output, or docs.
- Python work: `uv` + `pytest` + `loguru`.
- Never implement what wasn't requested; ask before adding improvements.

## Workflow

- **Runtime: Bun ≥ 1.3** (enforced by `engines.bun` in `package.json`). The project runs TypeScript natively — no `tsx`, no build step.
- `bun run typecheck` after any code change.
- Local dev entry: `bun run harny -- "<prompt>"` (script in `package.json`) or `bun bin/harny.ts "<prompt>"`.
- Published entry: `bunx @lfnovo/harny "<prompt>"` (defaults to `process.cwd()`, workflow `feature-dev`). Or `bun add -g @lfnovo/harny` then `harny "<prompt>"`.
- E2E smoke tests live in throwaway `/tmp/harny-e2e-*` dirs: `git init`, `cd` in, run `bun /path/to/harny/bin/harny.ts "<prompt>"`, inspect `.harny/<slug>/state.json`.
- State inspection: `harny ls [--status waiting_human]`, `harny show <runId>` (prefix ≥8 chars), `harny answer <runId> [...]`, `harny clean <slug>`.
- **Visual inspection**: `harny ui` boots a viewer on `http://127.0.0.1:4123` showing all runs across registered assistants + the current cwd, with auto-refresh, plan tasks, phases timeline, and Phoenix deep-links when enabled. Lives until Ctrl-C.
- **Optional Phoenix**: `docker run -d -p 6006:6006 arizephoenix/phoenix:latest` then `export HARNY_PHOENIX_URL=http://127.0.0.1:6006`.

## Releasing

Tag-driven via `.github/workflows/publish.yml` (trigger: push of `v*` tag). The action checks that `package.json:version` matches the tag, runs `bun run typecheck`, and `npm publish --access public` with `NPM_TOKEN` from repo secrets (granular npm token, Bypass 2FA enabled, scoped to `@lfnovo/harny`). Workflow:

```sh
# bump package.json version, update CHANGELOG.md (move [Unreleased] under new version header)
git commit -am "chore(release): v0.1.1"
git tag v0.1.1 && git push origin main v0.1.1
```

The first publish (v0.1.0 on 2026-04-22) was done manually because the secret wasn't set yet. All subsequent releases go through CI.

## Operational skills (`.claude/skills/`)

**Audience rule.** Skills under `.claude/skills/` ship to downstream consumers of harny — devs using harny in their own repos. They must be written in generic, dev-agnostic terms. **Architect-only guidance (conventions for people working ON harny itself: release-management methodology, build-status snapshots, meta-loop internals) goes in `CLAUDE.md`, `RELEASE.md`, `LEARNINGS.md`, `engine-design.md` — never in a skill file.** When editing a skill, ask: "would a user of harny in an unrelated repo need this?" If no, it belongs in architect docs.

Currently installed skills (some still misplaced — slated for migration to architect docs):

- **`release-management`** — architect-only methodology; lives here for convenience during Phase 1 but should migrate to `RELEASE.md`/CLAUDE.md.
- **`review-run`** — architect-only post-mortem tool; same migration applies.
- Companion docs: `RELEASE.md` (methodology + Rules 1-6), `LEARNINGS.md` (architect-emitted observations L1-L8).

## Subtree conventions

- When touching files under `src/harness/engine/`, also read `src/harness/engine/CLAUDE.md` first for engine-specific conventions (dispatcher pattern, sibling-mirror rule, probe shape).

## Gotchas

- The `claude-code` binary embedded by the SDK uses `jsonSchema` internally; `outputFormat.schema` is translated at the SDK layer. If structured outputs are missing, check the schema for the `$schema` top-level key first.
- `settingSources: ["project", "user"]` loads the target repo's `.claude/` skills and CLAUDE.md — phases benefit from project context automatically.
- SDK transcripts live in `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` (managed by the SDK, not by us). The harness only stores `phases[].session_id` references in `state.json`.
- Files per task dir: `state.json` (single source of truth) + `plan.json` (feature-dev only). The repo-level `.harny/.gitignore` (`*` + `!.gitignore`) keeps these out of git.
- `git clean -fd` only removes untracked files; gitignored `.harny/<slug>/` survives.
- When creating a brand-new file path that did not exist on the current branch, run `git branch -a` and `git log --all --oneline -- <path>` first. A sibling unmerged branch may already own that path; creating a stub silently regresses on merge.
- Worktrees start without `node_modules`; the orchestrator auto-runs `bun install` on cold worktrees (toggle: `harny.json` `coldWorktreeInstall`, default `true`). The legacy gotcha persists only if the toggle is disabled.
- Read at least one existing sibling file when adding new files to a module — match its import style (relative vs node:, .ts extensions, ordering).
- Phoenix integration uses an ESM-namespace-freeze workaround (`{ ...ClaudeAgentSDKNS }` shallow copy before `manuallyInstrument`) — without this, both Bun and Node throw on namespace mutation. Validated in `scripts/probes/phoenix/02-openinference.ts`.
- macOS has no `timeout(1)` by default. Prefer in-script `Promise.race` hard deadlines over outer `timeout N` wrappers when writing or instructing probes.
- When verifying a command succeeded, capture its exit code explicitly: `cmd; echo "exit: $?"` — stdout text alone (e.g. 'no errors') is not a reliable success signal.
- Phoenix's UI doesn't expose CORS, so the viewer resolves project name → GraphQL global ID server-side (cached 30s) when building deep-link URLs.
- The run-level Phoenix span only flushes reliably because `withRunSpan` calls `tracerProvider.forceFlush()` in its `finally`. Without that the BatchSpanProcessor commonly drops the root span on process exit.
- Subcommands are recognized by the first positional arg matching one of `clean|ls|show|answer|ui`. Prompts that literally start with one of those words conflict — phrase prompts to start differently.
- The Read tool errors with EISDIR on directories. Use Glob `<dir>/**/*` or Bash `ls <dir>` for directory discovery.
- Harness self-modifications take effect on the NEXT invocation, not the committing run. The harness binary is loaded once at startup; `commit_executed` uses that frozen path. Re-run on a no-op task to verify in-loop.
- Project enables `noUncheckedIndexedAccess`. Index access on arrays/strings returns `T | undefined`. Use `?? ''` or explicit guards before passing to a string parameter.
- Harness-managed branches always carry a `harny/` (or legacy `harness/`) prefix. Any feature that introspects "other harness branches" must filter by `^(harny|harness)/`. The unfiltered set includes main, feature/*, and stale locals.
