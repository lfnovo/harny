# harness

TypeScript task launcher built on the Claude Agent SDK. Implements Anthropic's "harness engineering" pattern: a planner → developer → validator loop orchestrated externally, with file-based handoff through `plan.json`.

## Key paths

- `src/runner.ts` — CLI entry. Flags: `--assistant <name>`, `--task <slug>`, `--harness`, `--workflow <name>`, `--input <path>`, `--isolation <worktree|inline>`, `--mode <interactive|silent|async>`, `-v/--verbose`, `--quiet`. Subcommands: `harness clean <slug>`, `harness ls [--status X] [--cwd X] [--workflow X]`, `harness show <runId>` (run_id prefix ≥8 chars accepted), `harness answer <runId> [<text> | --json '{...}']` (no-arg form walks parked batches interactively), `harness ui [--port=N] [--no-open]` (boots local viewer + opens browser).
- `src/harness/orchestrator.ts` — generic interpreter. Resolves workflow from registry, sets up git/branch/worktree per workflow flags, builds `WorkflowContext`, calls `workflow.run(ctx)`, cleans up. Zero workflow-specific logic. Wraps `workflow.run(ctx)` in `withRunSpan(...)` so all phase spans share one Phoenix trace_id when observability is enabled. Catches `PausedForUserInputError` from phases and exits cleanly with `status: "waiting_human"`. Idempotent rerun guard: refuses to clobber an existing `state.json` (done/failed = exit gracefully, running = error with stale-pid hint, waiting_human = error with `harness answer` hint).
- `src/harness/workflow.ts` — the `Workflow` contract: `id`, `needsBranch`, `needsWorktree`, `inputSchema?`, `phaseDefaults`, `defaultMode?`, `run(ctx)`, `resumeFromAnswer?(ctx, answer: string | Record<string,string>)`. Plus `WorkflowContext` (capabilities exposed to workflow body, including `mode: RunMode` and optional `resumeMeta` populated only on async resume) and the `defineWorkflow()` helper.
- `src/harness/sessionRecorder.ts` — generic `runPhase<T>()`. Calls `query()` with `cwd: phaseCwd`, returns the validated `structured_output`. Transcripts are NOT written by us — the SDK persists them to `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` and (when `HARNESS_PHOENIX_URL` is set) Phoenix mirrors via OpenInference instrumentation. Wraps each `query()` in `withPhaseContext(setup, phaseName, body)` so the rename span processor can collapse the SDK's `ClaudeAgent.query` span into `harness.<phaseName>`. Retries up to 3 times on transient API errors (overloaded, rate_limit). Strips `$schema` from Zod-emitted JSON schemas before passing to the SDK. Wires `canUseTool` mode-aware: silent strips `AskUserQuestion` from allowedTools; async parks via deny+interrupt (surfaces as `PhaseRunResult.status="paused_for_user_input"` + `parked` payload).
- `src/harness/state/` — files written to `.harness/<slug>/`:
  - `schema.ts` — Zod schema for `state.json` (single source of truth per run). Types: `State`, `PhaseEntry`, `HistoryEntry`, `PendingQuestion`, `PhoenixRef`. `schema_version: 1`.
  - `store.ts` — `StateStore` interface bound to one run dir. Methods: `createRun`, `getState`, `updateLifecycle`, `appendPhase`, `updatePhase`, `appendHistory`, `setPendingQuestion`, `patchWorkflowState`, `setPhoenix`.
  - `filesystem.ts` — `FilesystemStateStore` impl (read-modify-write atomic via `writeJsonAtomic`). Plus cross-run discovery helpers: `listRunsInCwd(cwd)`, `listAllRuns(cwds[])`, `findRun(cwds[], runIdOrSlug)` (run_id prefix ≥8 chars OR exact slug).
  - `plan.ts` — `Plan` I/O for the `feature-dev` workflow's `plan.json`, atomic save, path helpers (`planDir`, `planFilePath`, `worktreePathFor`).
  - `problem.ts` — `Problem` schema + `writeProblems` (one file per problem under `problems/`). Currently unused by core; available to workflows that emit Problem annotations in verdicts.
  - `audit.ts` — legacy `appendAudit`/`AuditEntry` type. The function is no longer called by core (history is folded into `state.json:history[]`); the type is still imported by `workflow.ts` for back-compat in the `WorkflowContext.audit` callback signature. Safe to delete the function once we typecheck-clean against an inline replacement.
- `src/harness/observability/phoenix.ts` — opt-in Phoenix observability via Arize OpenInference. `setupPhoenix({ workflowId, runId, taskSlug, cwd })` is a no-op when `HARNESS_PHOENIX_URL` is unset; otherwise registers `@arizeai/phoenix-otel` once per process (project = `basename(cwd)`), patches the SDK namespace with the ESM-namespace-freeze workaround, and adds a `RenameClaudeAgentSpanProcessor` that renames the SDK's `ClaudeAgent.query` span to `harness.<phase>` based on a `PHASE_CONTEXT_KEY` set by `withPhaseContext`. Exports `withRunSpan(setup, taskSlug, attrs, body)` (top-level AGENT span named after the task slug; calls `tracerProvider.forceFlush()` before returning so the run span flushes before process exit) and `withPhaseContext(setup, phaseName, body)` (no new span — just attaches phase name to OTel context for the rename processor).
- `src/viewer/` — read-only HTTP wrapper + vanilla JS SPA for browsing runs. Boot via `harness ui`. `server.ts` exposes `/api/{health,config,assistants,runs,runs/:cwdHash/:slug,runs/:cwdHash/:slug/git-log}` and serves `index.html` (Tailwind via CDN, hash router, ~330 LOC). Phoenix project name → GraphQL ID lookup runs server-side (Phoenix has no CORS) and is cached 30s; the detail endpoint pre-bakes `state.phoenix.url` for the SPA. Lives only as long as the parent CLI process — Ctrl-C stops it.
- `src/harness/types.ts` — shared types: `LogMode`, `IsolationMode`, `RunMode`, `PhaseName` (open string), `PhaseConfig`, `ResolvedPhaseConfig`, `HarnessConfigFile`, `ResolvedHarnessConfig` (carries `mode`), `Plan`, `PlanTask`, `PlanTaskHistoryEntry` (open shape).
- `src/harness/config.ts` — `loadHarnessConfig(cwd, workflow, cliMode?)` — workflow-aware: deep-merges `workflow.phaseDefaults` with `harness.json`'s `phases` map. Exports `resolveRunMode(cli, file, workflow)` with precedence: CLI > harness.json `defaultMode` > workflow `defaultMode` > auto (`process.stdin.isTTY` ? `interactive` : `silent`).
- `src/harness/askUser.ts` — `resolveAnswer(options, raw)` (number/text/case-insensitive option resolver), `runAskUserQuestionTTY(input)` (renders the SDK AskUserQuestion batch in a TTY, validates per-question, returns the SDK-shaped `{behavior, updatedInput:{questions, answers}}`), `denyAskUserQuestionHeadless()`, `SilentModeError`, `PausedForUserInputError`.
- `src/harness/git.ts` — preconditions, branch creation, commit helpers, and worktree primitives (`addWorktree`, `removeWorktree`, `assertWorktreePathAbsent`).
- `src/harness/guardHooks.ts` — `PhaseGuards` (`{readOnly?, noPlanWrites?, noGitHistory?}`) + `buildGuardHooks` parameterized by guard config. Workflows declare guards per phase. Escape hatch: writes/git ops against paths outside phase cwd (e.g., `/tmp/harness-e2e-*`) are allowed.
- `src/harness/clean.ts` — `harness clean <slug>` CLI subcommand: idempotent worktree + branch + state dir cleanup.
- `src/harness/workflows/` — workflow catalog. Each workflow is self-contained: own verdict schemas, prompts, defaults, helpers. Registry in `index.ts`. New workflows go here as a single file (small) or folder (large like `featureDev/`); core never edits.

## Invariants

- **The TS harness is the sole writer of `plan.json`.** Agents return structured verdicts (Zod-validated) and the harness merges them. Never have an agent edit the plan.
- **The harness is the sole committer.** The developer proposes a `commit_message` in its verdict but does NOT commit; the harness commits only after the validator passes, with the composed message `<dev>\n\ntask=<id>\nvalidator: <evidence>`.
- **Validator is read-only on code** (no Edit/Write tools) and runs against the uncommitted working tree. It reports `verdict` (pass/fail), and on fail optionally `recommend_reset` to hint that the approach is fundamentally wrong.
- **Retry = resume, reset = fresh.** On fail without reset, the next developer attempt resumes the previous session with only the new validator feedback in the prompt. On reset (validator-recommended or after `maxRetriesBeforeReset`), the tree is rewound with `git reset --hard <pre-phase-sha> && git clean -fd` and the next developer starts a brand-new session. `.harness/<slug>/` survives the clean because it is gitignored.
- **Dev `blocked` is fatal.** If the developer returns `status: "blocked"`, the plan is immediately marked `failed` and the loop aborts. Rationale: either the dev could have unblocked itself (our prompt/tooling bug) or it truly couldn't (plan is infeasible). Both require human triage. Note: `AskUserQuestion` (Tier 3b) gives the agent a way to surface ambiguity *before* getting stuck; "blocked" remains reserved for genuine infeasibility. Converting blocked → ask is still on the Tier 3 backlog.
- **Branch only shows committed work.** Before returning on any terminal state (done/failed/exhausted/blocked_fatal), the tree is reset to the last commit so the branch is clean.
- **Zod schemas must not emit `$schema`.** The bundled `claude-code` binary silently ignores a schema with a top-level `$schema` key — `structured_output` comes back undefined with no error. `sessionRecorder.ts` strips it before passing to the SDK.
- **Preconditions are mode-aware.** `assertCleanTree` applies to the PRIMARY working tree only in inline-isolation mode. In worktree mode, phases run in a separate git worktree — the primary's cleanliness is irrelevant to safety and requiring it would block legitimate concurrent or sequential runs that leave untracked per-task state under `.harness/<slug>/` in the primary. When wiring a new isolation mode, gate `assertCleanTree` on `mode === "inline"`.
- **`.harness/.gitignore` is tracked, not runtime-written.** The repo ships a static `.harness/.gitignore` containing `*` + `!.gitignore` (ignore everything inside `.harness/` except this gitignore itself). Any runtime logic that would create or overwrite this file is unnecessary — the file is already there, tracked, and correct. Writing it at runtime is a source of "untracked file dirties the tree" bugs; do not reintroduce that pattern.

## Validation discipline (self-build contract)

While the harness is being built on itself, validator phases MUST exercise acceptance criteria **empirically**, not by inspection alone:

- If an AC says "the harness runs in X mode", the validator must invoke the harness in X mode end-to-end and observe.
- If an AC says "two runs don't collide", the validator must start two runs and observe non-interference.
- If infrastructure prevents empirical exercise (missing dependency, API key not propagated into subprocess env, sandboxed filesystem, tool not in allowedTools, etc.), return **fail** with a `problems` annotation of category `environment` or `tooling` describing the blocker. **Do NOT downgrade to pass on grounds that "the code looks right and the primitives work in isolation"** — that shortcut compounds risk across tiers.

This is a temporary self-build contract. Once workflows are formalized (Tier 1b+), validator strictness becomes a per-workflow override in `harness.json`.

Infrastructure available to validator for empirical runs:
- `bun run run -- --harness --assistant <name> --task <slug> "<prompt>"` — the full harness is invokable from inside validator Bash. If SDK auth fails in the nested subprocess, that is an `environment` blocker and the verdict must be `fail`.
- `/tmp/harness-e2e-*` — throwaway dirs are fair game. `git init`, register a temp assistant, run.
- Two concurrent runs in two terminals = the canonical concurrency test.
- Guard hook for git history ops now has an **escape hatch**: commands that start with `cd /tmp/...`, `cd /private/tmp/...`, `cd /var/folders/...`, or use `git -C <path>` where `<path>` is outside the primary repo, are ALLOWED. This is so you can set up throwaway test repos (`git init && git commit -m seed`) in /tmp without fighting the guard. The sole-committer invariant still applies to the primary repo itself.

**Independence requirement for validators**: your empirical exercise must be YOUR OWN invocation. Inspecting a developer's prior smoke-test artifacts is one input to your evidence, never a substitute for your own run. If an AC says "the harness runs in mode X and commits land", YOU invoke the harness in mode X yourself and observe the commits. Developer smoke-tests may be stale, partial, or accidentally passing due to environment factors that don't replicate. Independent execution is the only protection against blind spots.

## Config files

- `~/.harness/assistants.json` (user-global, all paths absolute) — named working directories registered for harness invocation. See `assistants.example.json` at the repo root for schema. Lives outside the repo so worktrees and multiple harness clones share one source of truth.
- `<cwd>/.harness/<slug>/state.json` (per-run, atomic write) — single source of truth for one harness invocation. Schema versioned at `schema_version: 1` (Zod-validated on load). Holds origin, environment, lifecycle, phases[], history[], pending_question, workflow_state, and (when Phoenix is enabled) `phoenix: {project, trace_id}`. Replaces the prior SQLite registry. There is no central index DB — `harness ls` walks `~/.harness/assistants.json` cwds and reads each `.harness/*/state.json`.
- `<cwd>/.harness/<slug>/plan.json` (per-run, feature-dev only) — versioned plan with `tasks: PlanTask[]`, written exclusively by the harness. Workflows that don't emit a plan (`docs`, `issue-triage`) skip it.
- `harness.json` (target repo root, optional) — per-project overrides: `phases` map, `isolation`, `defaultMode`, `maxIterationsPerTask`, `maxIterationsGlobal`, `maxRetriesBeforeReset`. See `harness.example.json`.

## Environment variables

- `HARNESS_PHOENIX_URL` — when set, turns on Phoenix observability (Arize OpenInference instrumentation of the SDK; one trace per harness run; project = `basename(cwd)`; trace name = `--task` slug). Absent → zero-overhead no-op. Typical local setup: `docker run -d -p 6006:6006 arizephoenix/phoenix:latest` then `export HARNESS_PHOENIX_URL=http://127.0.0.1:6006`.
- `HARNESS_UI_PORT` — overrides the default port (4123) for `harness ui`.

## SDK input mode

Single Message Input (`prompt` is a string). One-shot per phase, fresh session every time — matches the harness goal of context reset per phase. Empirically verified that hooks AND `canUseTool` both fire in Single Mode (despite the SDK doc suggesting otherwise) — see `scripts/hook-probe.ts` and `scripts/canusetool-probe.ts`.

Switch to Streaming Input (prompt becomes an AsyncGenerator) only when we need image attachments or dynamic message queueing/interruption — neither is required today.

## Run modes (Tier 3b)

`RunMode = "interactive" | "silent" | "async"` controls how human-in-the-loop interactions are handled. Resolution precedence (highest wins): `--mode` CLI flag > `harness.json` `defaultMode` > `Workflow.defaultMode` > auto (`process.stdin.isTTY` → `interactive`, else `silent`). Resolved into `ResolvedHarnessConfig.mode` and exposed on `WorkflowContext.mode`.

- **interactive**: TTY readline for both `ctx.askUser` (workflow code-side) and the SDK's built-in `AskUserQuestion` tool. Numbered options selectable by number or text via `resolveAnswer`.
- **silent**: `AskUserQuestion` is stripped from `phaseConfig.allowedTools` before `query()` (the agent never sees it); `ctx.askUser` throws `SilentModeError`. Workflows decide whether to catch and provide a default or fail.
- **async**: `AskUserQuestion` calls park the entire batch as `state.pending_question` (kind=`ask_user_question_batch`, with `phase_session_id` + `tool_use_id` + `phase_name` for resume). The `canUseTool` callback returns `{behavior:"deny", interrupt:true}`, which causes the SDK loop to throw with `subtype=error_during_execution`. `sessionRecorder` recognizes the captured `parkState` and returns `PhaseRunResult.status = "paused_for_user_input"`; `ctx.runPhase` writes the pending question and throws `PausedForUserInputError`. Orchestrator catches and exits cleanly with `status: "waiting_human"`. `ctx.askUser` (code-side) parks via the existing single-question path.

**Resume (async)**: `harness answer <runId> --json '{"<question>":"<label>"}'` validates each answer against the parked `pending_question.options` (per-question `resolveAnswer`), or `harness answer <runId>` with no args walks the batch interactively (reusing `runAskUserQuestionTTY`). `resumeHarness(runId, answer, { searchCwds })` scans the assistant cwds, locates the run via `findRun()`, populates `ctx.resumeMeta = { phaseName, phaseSessionId, toolUseId }`, and dispatches to `Workflow.resumeFromAnswer(ctx, answer: string | Record<string,string>)`. `feature-dev` re-invokes the paused phase (currently planner only) with `resumeSessionId` + a Q&A prompt prefix; the model integrates the answers without re-asking (verified by `scripts/canusetool-probe.ts`). If the model asks a different question on resume, a new park row replaces the old one (multi-round async — documented limitation). Resume runs get a NEW Phoenix trace; the original trace stays queryable in Phoenix by `harness.run_id` resource attribute.

## Phoenix observability (opt-in)

Set `HARNESS_PHOENIX_URL` (e.g. `http://127.0.0.1:6006`) before running the harness to mirror SDK transcripts to a local Phoenix instance via Arize OpenInference. Per-run shape: one Phoenix trace per `harness run`, named after the `--task` slug; root span kind=AGENT; phase children are renamed from `ClaudeAgent.query` to `harness.<phase>` so the tree reads `calculator > harness.planner > harness.developer > harness.validator > <tool spans>`. Project = `basename(cwd)`. Resource attributes on every span: `harness.workflow`, `harness.run_id`, `harness.task_slug`, `harness.cwd`. The viewer (`harness ui`) reads `state.phoenix.{project, trace_id}` from `state.json`, resolves the project name → Phoenix GraphQL ID server-side, and renders a single "Open trace in Phoenix" deep-link in the run header.

**What we deliberately don't use**: `AbortSignal`-driven mid-stream cancellation. SDK sessions are treated as disposable; `resume:sessionId` + injected user-message prefix is the resume mechanism.

## User preferences

- **Conventional commits.** Do NOT mention Claude Code in commit messages or PR descriptions.
- **No emojis** in code, output, or docs.
- Python work: `uv` + `pytest` + `loguru`.
- Never implement what wasn't requested; ask before adding improvements.

## Workflow

- **Runtime: Bun ≥ 1.3** (enforced by `engines.bun` in `package.json`). The project runs TypeScript natively — no `tsx`, no build step.
- `bun run typecheck` after any code change. (`tsc` is still the type-checker of record; Bun is only the runtime.)
- End-to-end smoke tests live in throwaway `/tmp/harness-e2e-*` dirs: `git init`, add an entry to `~/.harness/assistants.json` (absolute path), run the harness with a small multi-step task, inspect `.harness/<slug>/state.json`.
- `bun run run -- --harness --assistant <name> [--task <slug>] [--mode <interactive|silent|async>] "<prompt>"` is the full flow.
- `bun run run -- --assistant <name> "<prompt>"` is the legacy single-query path; kept for quick probes. Also instrumented for Phoenix when `HARNESS_PHOENIX_URL` is set.
- State inspection (filesystem-only, no DB): `bun run run -- harness ls [--status waiting_human]`, `harness show <runId>` (run_id prefix ≥8 chars accepted). Resume parked runs with `harness answer <runId> [<text> | --json '{...}']` (no-arg form walks batches interactively).
- `harness clean <slug> --assistant <name>` removes worktree + branch + state dir for a slug. Idempotent.
- **Visual inspection**: `bun run run -- harness ui` boots a local viewer on `http://127.0.0.1:4123` showing all runs across registered assistants with auto-refresh, plan tasks, phases timeline, and (when Phoenix is enabled) deep-links to the run trace. Lives until Ctrl-C.
- **Optional Phoenix**: `docker run -d -p 6006:6006 arizephoenix/phoenix:latest` then `export HARNESS_PHOENIX_URL=http://127.0.0.1:6006` before running the harness.

## Gotchas

- The `claude-code` binary embedded by the SDK uses `jsonSchema` internally; `outputFormat.schema` is translated at the SDK layer. If structured outputs are missing, check the schema for the `$schema` top-level key first.
- `settingSources: ["project", "user"]` loads the target repo's `.claude/` skills and CLAUDE.md — phases benefit from project context automatically.
- SDK transcripts live in `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` (managed by the SDK, not by us). The harness only stores `phases[].session_id` references in `state.json`. When Phoenix is enabled, the same transcripts also flow through OpenInference instrumentation.
- Files per task dir: `state.json` (single source of truth — origin, environment, lifecycle, phases, history, pending_question, workflow_state, optional phoenix ref) + `plan.json` (feature-dev only, versioned). The repo-level `.harness/.gitignore` (`*` + `!.gitignore`) keeps these out of git.
- `git clean -fd` only removes untracked files; gitignored `.harness/<slug>/` survives, which is what we want.
- Phoenix integration uses an ESM-namespace-freeze workaround (`{ ...ClaudeAgentSDKNS }` shallow copy before `manuallyInstrument`) — without this, both Bun and Node throw on namespace mutation. Validated in `scripts/probes/phoenix/02-openinference.ts`.
- Phoenix's UI doesn't expose CORS, so the viewer resolves project name → GraphQL global ID server-side (cached 30s) when building deep-link URLs.
- The run-level Phoenix span only flushes reliably because `withRunSpan` calls `tracerProvider.forceFlush()` in its `finally`. Without that the BatchSpanProcessor commonly drops the root span on process exit.
