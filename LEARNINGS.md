# Harny — architect learnings log

Append-only log of architect-level observations from harness runs. One entry per run that produced a non-trivial learning. Format per entry: pattern observed → counterfactual test → action. Updated after each run during the per-run analysis ritual (RELEASE.md step 6.5).

For agent-emitted issues, see `state.json:problems[]` per run instead.

---

## Run #2 — `command-actor` (2026-04-22)

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
