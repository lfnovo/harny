# src/harness/testing — testing strategy + primitives

Architect-facing. Constitution for what we test, how, and where. Co-located `*.test.ts` files across `src/` reference the primitives here. `scripts/probes/**` is the CI-runnable subset of the same system.

## Why we test (corruption-first)

The primary fear is that harny **corrupts the user's codebase, worktree, branch, or filesystem**. Everything else — wasted tokens, lost orchestration progress, confusing state — is recoverable. The user can `harny clean` and rerun. They cannot un-delete a branch or un-commit an unreviewed change onto `main`.

This ordering drives the whole strategy: **invariants come before happy-path coverage**. A test that asserts "validator cannot Write/Edit" is worth more than a test that asserts "planner produces the expected plan for prompt X."

## What we fake (only the LLM)

The LLM is the only non-deterministic, slow, expensive dependency in harny. Everything else — filesystem, git, XState, Zod, argv parsing — is deterministic and cheap to exercise directly.

**Seal the LLM at the `sessionRunPhase` DI seam.** `runPhaseAdapter` already takes `sessionRunPhase` via deps; production injects the real one, tests inject a fixture. 90% of harny's orchestration logic becomes testable without a single token spent.

Real-LLM verification is a **release-time smoke**, not a PR-time test.

## Where tests live

- **Co-located:** `foo.test.ts` sits next to `foo.ts`. `bun:test` discovers `**/*.test.ts` natively, matching the Bun-native, zero-config ethos.
- **Runner:** `bun:test`. No vitest, no node:test, no jest.
- **Probes (`scripts/probes/**`):** continue to exist. They are the CI-gated subset exercising the same primitives. Same philosophy, different trigger (CI matrix vs `bun test`). **Not a parallel system.** A probe that duplicates a `*.test.ts` should be collapsed; a `*.test.ts` that needs a heavier environment (tmp repo, worktree, phoenix) should be promoted to a probe.

## Risk surfaces, ranked by corruption potential

Write tests in this order when adding new behavior. When a bug lands, the first question is: which surface did it breach?

1. **Git operations touching primary cwd** — `reset`, `commit`, `branch`, `worktree add/remove`. Any path where harny writes to the user's real working tree.
2. **Validator writing code** — `guardHooks` must block `Write|Edit|MultiEdit|NotebookEdit` during validator phase. Bypass = unreviewed code in the tree.
3. **Commit composition** — wrong SHA, wrong message, unvalidated commit landing. `composeCommit` + the orchestrator's commit gate.
4. **State persistence** — schema rejection, partial writes, pid recovery, `state.json` / `plan.json` corruption.
5. **Resume / park / reset semantics** — lose work, infinite loop, skip phases.
6. **CLI arg parsing** — wrong workflow dispatched (see commit `3d2dabd` for a real incident).
7. **Phase dispatch + retry logic** — right phase at the right time, retry count bounded.

Validated end-to-end during the 2026-04-24 build-out: all seven surfaces now have invariant tests, and the ordering reflected real promotion dependencies (earlier surfaces required less primitive infrastructure).

## Layers (three, ordered by risk)

### L1 — Schemas as contracts

`StateSchema`, `PlanSchema`, phase verdict schemas. Parse valid, reject invalid, round-trip. First-citizen tests because schema failures corrupt everything downstream. Zero dependencies, run in milliseconds.

### L2 — Invariants under a fake LLM

The main bar. Given fixture `PhaseRunResult` outputs, assert the harness produces the right artifacts: `state.json` shape, `plan.json` transitions, commit composition, retry/reset decisions, park/resume behavior. Uses `runPhaseWithFixture` / `scripted` / `runEngineWorkflowDry`. Zero real git, zero real LLM, zero filesystem beyond in-memory stubs.

### L3 — Real boundaries

`FilesystemStateStore` against a tmp dir, git helpers against a `tmpGitRepo()`, worktree lifecycle, CLI `parseArgs(argv) → ParsedArgs` with real argv shapes. Slower (seconds) but still sub-second per test.

Everything beyond L3 — an actual `runHarness` invocation end-to-end — is **release smoke**, not a PR test.

## Primitives (this module)

All built during the 2026-04-24 campaign and available for use. See `index.ts` and sibling files for full APIs.

**Environment / fixtures:**
- `tmpGitRepo(opts?)` — disposable git repo under `os.tmpdir()` with idempotent `cleanup()`. Optional `seed: { name?, email?, initialCommit? }` for repos that need identity + an initial commit.
- `withSyntheticState(stateDir, partialState, fn)` — fabricates a minimal valid `state.json`, runs `fn`, cleans up.
- `assertStateField(stateDir, dotPath, expected)` — dot-path assertion against a `state.json` on disk.

**LLM-sealed runners (L2):**
- `runPhaseWithFixture(phaseConfig, fixtureResult, store?)` — wraps `adaptRunPhase` with a stubbed `sessionRunPhase` returning a single canned result.
- `scripted(results, opts?)` / `capturingScripted(results, opts?)` — queued `SessionRunPhase` fakes. Two forms: sequential array OR by-phase-name record. `capturingScripted` also records input args for sequence assertions. Routes by `args.phase`, not `phaseName` — the adapter translates upstream.
- `runEngineWorkflowDry(workflow, input, fixtures)` — drives the XState machine with substituted actors. 5000ms deadline.

**Mocks:**
- `MockStateStore` — in-memory `StateStore` with two observable surfaces: `state` (mutable snapshot; direct mutation is an intentional escape hatch that bypasses `calls[]`) and `calls[]` (append-only log of method calls for sequence assertions).
- `MockGitOps` — in-memory `GitOps` with `calls[]` and `config.throws?` for per-method throw injection.

**Production DI seams:**
- `realGitOps` / `GitOps` interface (`src/harness/gitOps.ts`) — orchestrator consumes the interface. Tests pass `MockGitOps`.
- `sessionRunPhase` seam in `runPhaseAdapter` — tests inject fixture runners via the helpers above.

Before adding a new primitive, check whether an existing one can be extended. Extension is easier to audit than proliferation.

## Promotion discipline

When moving a probe from `scripts/probes/**` to a co-located `*.test.ts`:

- **Promotions are mechanical by default.** The probe's existing assertions move verbatim; new assertions require justification in the commit body. This keeps the promotion diff reviewable.
- **Primitive evolution during promotion is in scope.** If the probe reveals that a testing primitive is too narrow or too partial, widening it is part of the same work. Production code changes are not — those follow fix-when-breaks.
- **Primitive creation happens between waves, not during.** When a helper pattern appears in 2+ independent test files, promote it to `src/harness/testing/` in its own commit, outside a surface wave. Mixing primitive work with dense wave work adds noise.
- **Kill the probe in the same commit as the promotion.** Coexistence periods invite silent drift.
- **When a probe reveals a bug,** file the bug as an issue, write the test with `.skip` + an issue link in its body, unskip when the fix lands via harny. Do not inline-fix production TS during a test-writing session — that violates the "no human-written TS" invariant for `src/**`.

## New-test checklist

When you add or change behavior, work through these in order:

- **Touches git, state persistence, or branch handling?** → L2 invariant test is required, not optional.
- **Adds or changes a pure function** (schema, regex, arg parser, commit composer)? → L1 test co-located next to the function.
- **Crosses an external boundary** (git, fs, process spawn)? → L3 test using `tmpGitRepo` / `withSyntheticState`.
- **Touches the `sessionRunPhase` boundary or adds a new actor?** → L2 test with `runPhaseWithFixture` / `scripted` / `runEngineWorkflowDry`. Never real LLM.
- **Introduces a dual source of truth** (two places encoding the same content — a prompt file and a constant, a Zod schema and a hand-maintained type, etc.)? → L1 parity test at the boundary. See the drift shape under Field observations.
- **Bug fix?** → the fix lands with a test that would have failed before. No exception.

## What we don't test

- **Real LLM calls in automated tests.** Non-deterministic, slow, burns tokens. Release-smoke only — architect runs one real invocation against a fixture repo per release.
- **"Did the LLM give a good answer?"** That's validator's job at runtime, not the test suite's.
- **Coverage percentages.** No numeric gates. Coverage is a symptom, not the goal. The real gate is "each risk surface has an invariant test."
- **Performance.** Harny runs once per task; there is no hot path. Skip perf tests until a real incident demands one.
- **Exhaustive happy-path permutations.** One happy-path test per workflow is enough. The bar is invariants, not combinatorial coverage.

## Field observations (2026-04-24 build-out)

The campaign promoted ~40 probes to `*.test.ts` and surfaced four distinct shapes of "promotion reveals X" gap. Every future promotion should expect at least one of these. Each is a legitimate scope expansion of the promotion, not scope creep — but each lives under different discipline (see above):

- **Typing gap.** The probe typechecked, but the testing primitive's type was too narrow for the probe's actual usage. Fix in the primitive; the probe promotion tightens the contract at the same time.
- **Fidelity gap.** The test mock or capture was too partial for the contract under test (e.g., mocking `console.log` but not `console.error`, so output leaks silently). Fix in the test helper and note the pattern near the primitive so it doesn't re-emerge.
- **Latent bug.** The code behaves incorrectly in a case the probe didn't exercise, and writing the more-thorough test catches it. File the bug, skip the test with an issue link in its body, continue the wave. When the fix lands, unskip.
- **Drift between dual sources of truth.** Two places encode the same content (a markdown prompt file and a constant referenced by the same phase, for example) and have silently diverged. Two fix shapes, in preference order: **(a) collapse the dual source** — derive one from the other at load time so divergence becomes structurally impossible; (b) if collapsing isn't viable, an L1 parity test at the dual boundary. (a) is strictly stronger when feasible — it eliminates the class of bug, not just the current instance. (See the fix for prompt-constant drift: `.md` files loaded at module init, constants derived from them — no parity test needed because there is no longer a second source.) Also audit for other dual-source pairs when you find one.

General rule: **promotion is not only a re-homing of tests.** It is also calibration of the testing infrastructure and an opportunity to surface gaps that runtime invariants don't catch. Budget for this when planning a promotion wave.

## Test budget

- **`bun test`** (L1 + L2, co-located): under 30 s total. Runs on file save during development.
- **`bun test --integration`** or similar glob (L3): under 2 min. Runs pre-push.
- **Probes (`scripts/probes/**`):** minutes, runs on PR merge gate + nightly. Not on every PR push.
- **Release smoke:** one real CLI invocation, architect-run, not CI-gated.

As of the 2026-04-24 build-out, the full co-located suite (~224 tests across 29 files) runs in ~2.3s — well under budget, with headroom for further coverage. If a test category grows past its budget, split it or demote part of it to a probe. Don't inflate the budget.

## Cross-references

- `src/harness/engine/harnyActions.ts` — git actions invoked by the engine. Risk surface #1.
- `src/harness/guardHooks.ts` — the `readOnly` guard is the first line of defense for risk surface #2 (validator writing code). Invariant tests on that file are non-negotiable.
- `src/harness/workflows/composeCommit.ts` + the commit gate in `src/harness/engine/workflows/featureDev.ts` — risk surface #3.
- `src/harness/state/*` — state persistence. Risk surface #4.
- `src/harness/orchestrator.ts` + `src/harness/clean.ts` — resume/reset lifecycle. Risk surface #5.
- `src/runner/*` — CLI parsing + dispatch. Risk surface #6.
- `src/harness/engine/dispatchers/*` + `src/harness/engine/runtime/runPhaseAdapter.ts` — phase dispatch. Risk surface #7.
- `scripts/probes/**` — the CI-runnable subset. Same primitives, different invocation.
