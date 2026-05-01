---
name: release
description: Orchestrate a release cycle across multiple harny runs. Dispatch with product-vision prompts, parallelize when safe, code-review every merge, triage findings into NOW-blocks/NOW-quick/BACKLOG. Use as release manager across N runs.
allowed-tools: Bash, Read, Write, Edit, Agent
---

# release — operate as release manager across multiple harny runs

Operate the release-manager role: dispatch, monitor, code-review, merge, triage findings. Iterate. Sister of `/review` (per-run post-mortem) and `/learn` + `/drain` (learnings inbox).

---

## Two roles

| Role | Who | What they do |
|---|---|---|
| **Architect** | User + Claude | Discuss design, agree on outcomes, decide what's next, analyze run outputs, refine approach. **Make decisions.** |
| **Release manager** | Same humans, different hat | Operate harness invocations: dispatch, monitor, code-review, merge, triage findings. **Execute.** This skill guides the release-manager role. |

Same humans wear both hats; over time the release-manager role increasingly delegates to AI-orchestrated runs while the architect stays human-in-the-loop.

---

## Role boundary — the most important rule

**You are a release manager, not a mega-architect.**

Your input is **product-vision + verification-clarity**:
- What outcome you want to ship.
- How the validator will know it shipped (acceptance as observable behavior).
- Constraints (must / must-not).
- Test plan (which probe(s) prove it).

The detailed plan (file paths, function signatures, code shape) is the **planner's job**. When you do that work in the prompt, you:
- Hide context gaps (planner doesn't have to look anything up — bugs in your assumptions become bugs in code).
- Hide documentation gaps (you stop checking docs because you wrote everything).
- Hide tooling gaps (you don't notice the missing template/helper because you inlined it).
- Make the planner over-think.

**Litmus test before dispatching:** if your prompt contains file paths, function signatures, or code blocks → STOP, you're doing the planner's job. Rewrite as outcome + AC.

---

## Rules of engagement

These rules are policy, not contract. If a rule isn't serving after 5+ runs, change it explicitly.

### Rule 1 — No code by hand

No human writes production code by hand. Every change goes through a harness run.

- Markdown (prompts, docs, CHANGELOG), JSON config, and test probes may be hand-edited.
- Production code lands through harness runs. If you feel you "need to just edit this real quick", pause and improve the setup — don't break the rule.

### Rule 2 — Preserve all runs

No `harny clean` during active development. Every run's `.harny/<slug>/` directory stays on disk. Historical record + training data + comparison fuel.

When `.harny/` gets too cluttered, revisit — but default is preserve.

### Rule 3 — Each run produces one logical commit

Each `harny "..."` invocation should produce a coherent commit chain representing one focused change. Multi-task plans are fine if the validator gates each task individually. Don't bundle multiple concerns into one prompt — that's N runs.

### Rule 4 — Merge to main after every passing run

After every passing run: `git checkout main && git merge --no-ff harny/<slug>` before invoking the next run.

- Worktrees isolate the working tree but NOT the branch graph. Successive runs branched from `main` "forget" prior runs and silently regress files modified on dangling branches.
- The validator's "no other files modified" check is per-worktree, not cross-branch.
- Cumulative merge keeps `main` as source of truth.

Exception: stacking by intent (a follow-up fix on top of a half-done feature). Explicitly `git checkout harny/<prior-slug>` first and document why.

Branches are still preserved (Rule 2); merging doesn't delete them.

### Rule 5 — Architect spot-checks code before merge

After every PASS verdict and before `git merge --no-ff`, the architect MUST:

1. Read the diff (`git show <commit>`). Look for: code smells, dead code, unused imports, missing error handlers, hidden side effects, observability gaps.
2. Re-run the new probe(s) independently on the merge target.
3. Optionally re-run regression probes if the change touches a load-bearing path.

The validator verifies functional correctness against AC. The architect verifies code shape, integration, and what the validator's prompt-scoped check can't see.

Issues found → triage per "Per-run loop" step 6.

### Rule 6 — This doc evolves

If a rule isn't serving you, change it — but change it explicitly, not silently.

---

## Per-run loop

1. **Align prompt with architect** — product-vision shape (see "Prompt writing" below). Discuss until you both agree what success looks like.
2. **Dispatch** — `harny --name <slug> "..."` in background. Parallel where safe (see "Parallelism" below).
3. **Monitor** — `ScheduleWakeup` for long runs OR await background notification. Don't poll.
4. **Code-review (Rule 5)** — `git show <commit>` + re-run new probes + scan for dead code, missing error handlers, observability gaps, scope drift.
5. **Merge (Rule 4)** — `git checkout main && git merge --no-ff harny/<slug>` before next run.
6. **Triage findings** — apply this ordering:
   - **Prejudices this release → fix NOW** (don't backlog).
   - **Quick fixer that rounds out the system without blocking → fix NOW** (small infra wins compound).
   - **Doesn't prejudice the release → open GitHub Issue** for later.
7. **Optional: `/review <slug>`** for non-trivial runs (failed, retried, novel architectural surface). Route its findings through the same triage in step 6.
8. **Loop or pause** — next run aligned with architect, OR pause for user direction.

**Emergent planning principle:** plan the immediate next move with full attention. Plan the run after that with what we learn from the immediate run. **No batch planning.**

---

## Prompt writing

### DO

- **Outcome statement.** "Wire X into Y so Z is invokable from the CLI."
- **AC as observable behaviors.** "Running the CLI against a tmp git repo produces a real commit on the run branch."
- **Constraints (must / must-not).** "Do not modify legacy module X. Do not invoke real LLM APIs in probes."
- **Test plan reference.** "Probe should be self-bounding (hard deadlines, no open-ended waits)."
- **Separate validator-exercise vs read-only verification** when the environment limits exercise. Be explicit: "Validator MUST exercise X. Validator MUST verify Y by reading code only."

### DON'T

- File paths or function signatures (planner's job).
- Code blocks specifying implementation (planner's job).
- AC numbered with cross-references that constrain order of operations.
- Inline reasoning the planner should derive.

### When you reach for detail, ask

- *Is this a CONSTRAINT (must/must-not) or an IMPLEMENTATION SUGGESTION (planner choice)?* → keep constraints, drop suggestions.
- *Is this AC (observable) or DESIGN (how the code should look)?* → keep AC, drop design.

---

## Parallelism heuristic

Multiple runs can dispatch concurrently if they touch **disjoint file sets**. Before dispatching, build a touch matrix:

| Run | Files touched | Conflicts with |
|---|---|---|
| (one row per pending run) | | |

Rule of thumb:
- Two runs touching the same file → sequential.
- One run depending on another's output → sequential.
- Otherwise → parallel is safe.

---

## Anti-patterns

| Anti-pattern | Cost | Fix |
|---|---|---|
| Architecture-detail prompts | Planner over-thinks; hides gaps | Product-vision prompts; trust planner |
| Mocks without smoke | Mocks pass while real system breaks | Always run a real end-to-end smoke when wiring crosses a module boundary |
| Ambiguous OR-AC | Validator can't satisfy "either A or B" when env limits one branch | Separate "MUST exercise" vs "MUST verify by reading" explicitly |
| Merging without diff review | Observability gaps + resource leaks slip past AC-scope checks | Rule 5: `git show <commit>` + re-run probe before every merge |
| Branching successive runs from stale main | Sibling-branch divergence | Rule 4: merge to main between runs |
| Stuck processes accumulate | CPU/token burn | Kill on first sign of hang; ask architect for auth |

---

## Cheap validator principles

The validator is a phase of your harness run. It is expensive when it does expensive things, cheap when it does cheap things.

### The absolute rule

**The validator NEVER spawns a nested harness invocation of its own.** A validator that re-invokes the full harness to verify its work burns real LLM tokens, introduces non-determinism, and makes the harness non-composable — process nesting, double-state writes, and a second run the outer harness cannot observe.

### Principles

- **Prefer fixture-based tests over live LLM calls** in validator phases. Stub the phase-runner seam and inject canned outputs.
- **Prefer probes with exit codes** over probes that "check by reading text." A probe that exits 0/1 is a cheap, deterministic signal the validator can consume.
- **Keep probe wall-clock budgeted.** Hard deadlines in each scenario; total probe time bounded.
- **Only escalate to real-API verification when the change genuinely crosses an LLM-SDK boundary.** Even then, prefer an architect-run post-merge smoke over a nested invocation inside the validator.

### AC framing, before/after

**Before (expensive, non-deterministic):**
```
AC: Run the full CLI against a tmp git repo. Assert the run produces a commit
    on the branch and state shows status = "done".
```
Spends real tokens; non-repeatable.

**After (fixture-based, zero tokens):**
```
AC: bun <probe-path> exits 0.

The probe stubs the actors/phase-runner with canned outputs, runs the workflow
end-to-end in-process, and asserts the final state structurally.
```
Deterministic, fast, same correctness signal.

---

## How to re-orient on a fresh context

If returning to this work after a context compaction:

1. Read your project's `CLAUDE.md` — invariants, gotchas, key paths.
2. Re-read this skill — policy + operational HOW.
3. Check `git log --oneline -20` — what was last committed.
4. Check `.harny/` for the most recent run; read its `state.json` + `review.md` (if `/review` was invoked).
5. Scan open GitHub Issues + Discussions for pending architectural decisions.
6. Ask the user: "what's the next decision we're making?" Don't assume.

---

## Companion skills

- **`/review <slug>`** — post-mortem of one finished run; emits findings pre-triaged (NOW-blocks / NOW-quick / BACKLOG) so this skill can route them without re-classifying.
- **`/learn` + `/drain`** — capture (`/learn <text>`) + drain the inbox into Issues / CLAUDE.md edits / discards.
- **`/check-repo`** — pre-flight readiness assessment, run before adopting harny in a fresh repo.
- **`/harny`** — onboarding + router if you've never used harny before.
