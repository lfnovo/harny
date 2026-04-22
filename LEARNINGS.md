# Harny — architect learnings log

Append-only log of architect-level observations from harness runs. One entry per run that produced a non-trivial learning. Format per entry: pattern observed → counterfactual test → action. Updated after each run during the per-run analysis ritual (RELEASE.md step 6.5).

For agent-emitted issues, see `state.json:problems[]` per run instead.

---

## Run #4 — `land-learnings` (2026-04-22)

### L6 — architect must merge after every run, or branches diverge silently

- **Pattern observed:** Run #4 was branched from `main` while runs #1-3 lived on dangling branches (`harny/engine-scaffolding`, `harny/command-actor`, `harny/tail-show`) that had never been merged. The dev correctly created a one-line comment `command.ts` because main had no `command.ts` to comment on — but that file would have regressed the real implementation when merged. Architect (Claude) only noticed during the validator's "untracked file" anomaly note; would have been an invisible regression otherwise.
- **Counterfactual:** Yes — any architect (human or AI) running successive harness invocations on the same repo will face this. Worktrees only isolate the working tree, not the branch graph. The orchestrator branches from whatever HEAD the primary worktree is on at invocation time.
- **Action:** Adopt **policy (a) — merge cumulative after each run**. Codified in RELEASE.md as a new rule. Concretely: after every passing run, `git checkout main && git merge --no-ff harny/<slug>` before invoking the next. Exception: when stacking by intent (e.g., a fix-up run on top of a half-done feature), explicitly checkout the prior branch first and document why. Branches are preserved (RELEASE.md Rule 2) but main is the integration point.

---

## Run #2 — `command-actor` (2026-04-22)

### L3 — XState `fromPromise` swallows subscriber-level errors on abort

- **Pattern observed:** When an abort fires on a `fromPromise` actor, the internal observer calls `.error()`, which plain `.subscribe(nextCb)` subscribers never see — the rejection is invisible. Dev gastou ~2min grepping xstate internals to discover this. Discovered in run `command-actor` during the timeout scenario fail.
- **Counterfactual:** Yes — every future dispatcher (agent, humanReview, planActor, validatorActor, etc.) faces the exact same testability question. Fresh dev would re-discover it.
- **Action:** Convention for engine dispatchers: every dispatcher exports both (a) a plain `async fn(opts, signal)` (canonical implementation, the probe surface) and (b) a thin `fromPromise(fn)` actor wrapper (XState adapter only). Probes exercise the async fn directly with an `AbortController` rather than `createActor` + `stop()`. Lands in `engine-design.md §8` as a contract; one-line top-of-file comment in each dispatcher referencing it.

### L4 — Worktrees start without `node_modules`

- **Pattern observed:** Newly-created harny worktrees don't share `node_modules` with the primary repo. Dev's first `bun run typecheck` failed with `Cannot find module 'xstate'`. Recovered with `bun install`. Lost ~2min. Logged as agent-emitted Problem in `state.json:problems[]`.
- **Counterfactual:** Yes — any phase that imports runtime deps or runs typecheck on a fresh worktree hits this.
- **Action:** Start with a CLAUDE.md "Gotchas" bullet ("Worktrees start without node_modules. Phases that run typecheck or import runtime deps must `bun install` first."). Revisit with an orchestrator change (auto `bun install` on cold-start worktree) if it recurs.

### L5 — macOS lacks `timeout(1)`

- **Pattern observed:** Architect prescribed `timeout 20 bun ...` in run #2's prompt. Both dev and validator hit `command not found: timeout` on macOS (no coreutils by default). Both recovered by invoking bun directly. The probe's internal 3s-per-scenario `Promise.race` was the actual safety net. Confirmed again in run #3 (`tail-show`) — validator explicitly noted *"`timeout` binary not in PATH on macOS zsh; used direct bun invocation"*.
- **Counterfactual:** Yes — any prompt that prescribes outer `timeout N` will fail the same way on stock macOS.
- **Action:** (a) CLAUDE.md "Gotchas" bullet ("macOS has no `timeout(1)`. Prefer in-script `Promise.race` hard deadlines."). (b) Architect rule: stop prescribing `timeout N` in prompts. The internal probe deadline is the real safety net.

### L1 — subprocess cleanup pattern

- **Pattern observed:** First attempt hung indefinitely. Three orphan `bun scripts/probes/...` zsh processes accumulated in 16+ minutes because the dev wrote AbortSignal/timeout handlers that returned before the child process actually died (`proc.kill()` fired, but the parent settled before `proc.exited` resolved). The probe also had no outer deadline, so a hang in any single scenario hung the whole probe — and the SDK Bash tool didn't enforce its 2min default.
- **Counterfactual:** Would a fresh dev tomorrow, reading only CLAUDE.md + the codebase, write `proc.kill('SIGKILL'); await proc.exited` correctly on first try? **No.** This is a real subprocess-control gotcha that's not documented anywhere in the project.
- **Action:**
  - (a) Comment block at top of `src/harness/engine/dispatchers/command.ts` documenting the SIGKILL + await proc.exited + Promise.race deadline pattern.
  - (b) Bullet in CLAUDE.md "Gotchas" referencing it.
  - (c) Backlog: probe template `scripts/probes/_template.ts` that bakes in the outer deadline pattern.

### L2 — probe-driven validation is cheap

- **Pattern observed:** Validator phase took only 39s on the retry — it re-ran the probe (which is itself a 4-scenario test rig with built-in deadlines) and inspected the output. No need for 5 separate empirical exercises.
- **Counterfactual:** N/A (this is a positive pattern, not a fix).
- **Action:** Document as pattern in `engine-design.md` or in the validator prompt — "when a task ships with its own probe, validation = re-run probe + read 1-line PASS/FAIL output. ~30-60s." Encourage future runs to write probes precisely so validation stays cheap.

---

## Run #1 — `engine-scaffolding` (2026-04-22)

### L1 — commit message duplicates `task=N` trailer

- **Pattern observed:** Commit `ef7894a` ends with `task=t1` twice — once from the dev's proposed `commit_message`, once from the harness's composition layer that appends `task=<id>` and validator evidence.
- **Counterfactual:** Dev wouldn't catch this — it's the harness's composition logic in `src/harness/orchestrator.ts` (or wherever the commit message is assembled).
- **Action:** Backlog. Future run: dedup the trailer when composing — or instruct dev not to include `task=` in their proposed message (the harness adds it).

### L2 — validator evidence in commit body is verbose

- **Pattern observed:** Validator's `evidence` field gets pasted verbatim under `validator: ...` in the commit body. Useful as audit trail but pollutes `git log --oneline` width and makes squash-merge messages unwieldy.
- **Counterfactual:** Architect concern, not agent concern.
- **Action:** Backlog. Options: (a) cap evidence at N chars, (b) move to a separate trailer line, (c) move out of commit message into `state.json` only. Decide later based on whether anyone actually reads commit-body evidence.
