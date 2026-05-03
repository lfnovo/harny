# Readiness dimensions reference

The ten dimensions the `check-repo` skill walks. Each ties back to a specific harny mechanic — pass means the mechanic works *with* the repo; fail means it works *against* it.

---

## Validate the validator (do this first)

The most expensive mistake when adopting harny is not in the code — it's discovering, mid-run, that the validator command was never going to pass on `main` to begin with. Harny then enters a loop trying to "fix" pre-existing problems it didn't cause.

**Pre-flight on a clean checkout of `main`:**

1. Run the exact install command harny will use (e.g., `uv sync --all-extras`, `bun install`).
2. Run the exact validator command planned for harny.
3. Confirm it exits 0.

Three failure modes to watch for:

- **Test collection failure.** A missing optional dependency makes pytest/jest/etc. fail to even *collect* tests — different from a regular test failure. Decide: install the extra, or exclude those test files from the validator.
- **Pre-existing lint/type debt.** A repo where `mypy`/`ruff`/`tsc` has accumulated errors on `main` cannot use them as gates without a baseline. Either fix the debt, configure a baseline (`mypy --baseline`, ruff `# noqa`), or drop them from the validator.
- **Tests that need credentials.** Integration tests requiring API keys will fail in a fresh worktree. Segregate them and exclude.

The output of this step is the user's final validator command. Pin it.

---

## 1. Validator gates (objective "done")

**Why.** Harny commits only after the validator phase passes. Without an automatic gate that returns exit 0/1 with meaningful signal, the validator becomes "an LLM looking at the code" — works, but loses the strongest mechanic.

**Checks.**
- At least one of: type-check, test suite, lint, or build that returns clean pass/fail.
- Validator-friendly subset identifiable (unit tests separate from integration).
- Gate is reliable. No "ignore these 12 known failures."
- Gate doesn't depend on hidden local state.

**Diagnostic.** "When a PR is accepted in this repo, what commands actually decide it's mergeable?"

**Calibration.**
- 🟢 Multiple gates (typecheck + tests + lint), all fast and reliable.
- 🟡 One gate, or gates with known-flaky tests.
- 🔴 No automatic gate. Or gates require credentials/services to run at all.

---

## 2. Safe-reset hygiene

**Why.** Reset does `git reset --hard <pre-phase-sha> && git clean -fd`. Anything not tracked, gitignored, or under `.harny/` is gone after reset.

**Checks.**
- Working tree clean by default.
- Everything important is tracked, gitignored, or reproducible.
- No untracked-but-important files at root (scratch scripts, manual logs).
- No directories like `output/`, `sessions/`, `tmp/` containing real work that isn't gitignored.
- `.gitignore` covers IDE files, OS files, build outputs, and personal scratch conventions.
- No committed secrets (`*-credentials.json`, `.env` not gitignored).

**Diagnostic.** "If I run `git stash && git clean -fd` right now, do you lose anything you care about?"

**Calibration.**
- 🟢 Clean tree. No floating scratch files. Gitignore complete.
- 🟡 A few floating files but nothing irreplaceable.
- 🔴 Real work lives outside git. Credentials committed. Working tree always dirty.

---

## 3. Deterministic install (cold worktree works)

**Why.** With `--isolation worktree`, harny creates a fresh worktree and runs install from scratch. Hidden install steps break this.

**Checks.**
- One canonical install command works from a clean clone.
- Lock file checked in and respected.
- No "and also `pip install X`" steps in CI that aren't in the manifest.
- No required env vars that block install or first import.
- Heavy optional deps (torch, native libs) can be skipped when not needed.
- The validator command runs against the right set of extras. A common trap: missing optional dep → tests fail to *collect*. Pin the install command to the extras the validator needs.

**Diagnostic.** "If I clone this repo on a new machine right now, how long until `<test command>` runs?"

**Calibration.**
- 🟢 `git clone && <one command>` gets you to a runnable state.
- 🟡 Works but slow (10+ min install) or has one or two extra steps.
- 🔴 Install has tribal-knowledge steps. CI installs things the manifest doesn't declare.

---

## 4. Feedback loop time

**Why.** The planner→developer→validator loop iterates. 20-min suite × 5 retries = 100 min before a result.

**Checks.**
- Validator command for a typical task runs in under ~5 min.
- Can scope the validator to the affected area (not the whole suite).
- Typecheck is incremental or fast on the whole project.
- Heavy tests (integration, e2e) are excludable.

**Diagnostic.** "For a single-file change, what's the fastest reliable check you can run?"

**Calibration.**
- 🟢 Validator subset runs in 1–3 min.
- 🟡 5–10 min. Tolerable but expensive on retries.
- 🔴 Full suite required, takes 15+ min, or no way to scope down.

---

## 5. Task granularity / architectural modularity

**Why.** The planner produces tasks; the developer executes one at a time. If every change touches 30+ files across many modules, context explodes and resets become expensive.

**Checks.**
- Typical changes touch a small, predictable number of files (rule of thumb: 2–10).
- The codebase has clear module boundaries.
- A "natural unit of work" (provider, route, migration) maps to one module.
- Cross-module changes are the exception.

**Diagnostic.** "What's the smallest meaningful change in this repo, and how many files does it touch?"

**Calibration.**
- 🟢 Modular by design (plugin/provider/component pattern). Changes localize.
- 🟡 Mostly modular, but some changes spider out unpredictably.
- 🔴 Tightly coupled. Most changes touch shared types/utilities/cross-cutting infra.

---

## 6. Agent context (documentation quality)

**Why.** Harny phases run with `settingSources: ["project", "user"]`, automatically loading `.claude/` and `CLAUDE.md` files into agent context. Repos with written orientation produce phases that understand conventions.

**Checks.**
- `CLAUDE.md` (or equivalent — `AGENTS.md`, `.cursor/rules`) at the repo root.
- Module-level CLAUDE.md or README in major directories.
- An `ARCHITECTURE.md` (or section in README) explaining **why**, not just what.
- A `CONTRIBUTING.md` listing patterns to follow when adding code.
- Naming conventions consistent enough to read from existing files.
- Documentation reflects current code (not 6 months stale).

**Diagnostic.** "If I dropped a smart engineer into this repo with only the docs, how long until they could write idiomatic code in it?"

**Calibration.**
- 🟢 Root CLAUDE.md + module-level docs + architecture rationale. All current.
- 🟡 Root CLAUDE.md exists, but stale or shallow. Module docs missing.
- 🔴 No agent-readable orientation. The only "docs" are the code itself.

---

## 7. Testability

**Why.** Tests are usually the validator's main signal. Flaky, slow, or credential-heavy tests are hostile to harny. Code that can't be tested in isolation is also code where harny can't add tests as part of a fix.

**Checks.**
- Tests are deterministic.
- External services (HTTP APIs, databases, FS) are mockable.
- Tests don't need real credentials, or such tests are clearly segregated.
- Tests can run in parallel (or you know the subset that can't).
- For a given file, you can identify which tests cover it.
- Unit tests exist for core domain logic.
- New tests are easy to write — fixtures and helpers exist.

**Diagnostic.** "If I introduce a bug in `<core file>`, will a test fail?"

**Calibration.**
- 🟢 Most files have nearby tests. External deps mocked. Suite deterministic.
- 🟡 Coverage is patchy. Some flakes.
- 🔴 Tests require real services, or suite is so flaky that green means nothing.

---

## 8. Branch discipline

**Why.** Harny manages branches under `harny/`. A serious gotcha: a sibling branch with stale work can silently regress paths when later merged.

**Checks.**
- Few long-lived feature branches (under ~10 active).
- Stale branches get cleaned up.
- Branch naming doesn't collide with `harny/*` or `harness/*`.
- No other AI-agent branches (`archon/*`, `codex/*`) operating on the same paths concurrently.
- For any active branch, you can name the paths it owns.

**Diagnostic.** "Of the active branches right now, how many have unmerged work touching the area harny will modify?"

**Calibration.**
- 🟢 Trunk-based or short-lived branches only. Few in flight.
- 🟡 10–20 branches in flight, mostly tracked, owners known.
- 🔴 Dozens of branches, unclear which are alive, multiple AI agents committing concurrently.

---

## 9. Type and lint enforcement

**Why.** Static analysis is the cheapest, fastest gate available — and gives the validator real teeth. A typed language with no enforced types is no better than a dynamic language for harny purposes.

**Checks.**
- Typecheck is part of CI, not just "best effort."
- Type coverage is high in areas harny will modify.
- Linter is enforced and not full of `# noqa` / `eslint-disable` escape hatches.
- Formatter runs in CI or pre-commit.
- **If `main` has accumulated lint/type errors, do not include those tools in the validator without a baseline.** Harny will try to fix them all and burn context on unrelated debt. Fix the debt first, configure a baseline, or drop the tool from the validator.

**Diagnostic.** "What does CI block on, beyond tests?"

**Calibration.**
- 🟢 Typecheck + lint + format all enforced and clean.
- 🟡 Some enforcement, but with carve-outs that include harny's working area.
- 🔴 Dynamic language, no types. Or types declared but ignored.

---

## 10. Repo hygiene & secrets

**Why.** Harny phases get broad tool access. Credentials in tracked files, or personal data in untracked files that survive resets, is risky.

**Checks.**
- No committed secrets (API keys, credentials, private certs).
- `.env` is in `.gitignore`; `.env.example` is committed.
- Service-account JSON lives outside the repo or is clearly a placeholder.
- Large binary artifacts aren't tracked.
- No accidental commits of `node_modules/`, `.venv/`, `__pycache__/`.

**Diagnostic.** "If this repo were public tomorrow, what would you have to scrub?"

**Calibration.**
- 🟢 No secrets, no large binaries, gitignore comprehensive.
- 🟡 Some hygiene gaps. `.env` not ignored, or scratch artifacts at root.
- 🔴 Committed credentials. `.env` tracked. Service account JSON in repo.

---

## Anti-signals (not scored, just flagged)

These can make a repo a poor fit for harny regardless of dimension scores:

- **"Done" is subjective.** UX/visual design, copy, product decisions. Validator has no oracle.
- **Legacy code with no types and no tests.** Validator is blind.
- **Cross-service changes are the norm.** Monorepo without enforced boundaries.
- **Build/run requires manual hand-holding.** Runs only on the original developer's machine.
- **Active human edits in the same files concurrently.** Harny works best when it owns a slice of the repo for the duration of a task.
- **Heavy dependence on credentials / external services for *any* check to run.**
