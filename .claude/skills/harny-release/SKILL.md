---
name: harny-release
description: Orchestrate a harny release — dispatch harness runs with product-vision prompts, parallelize when safe, code-review every merge, triage findings into now/quick/backlog, and surface gaps through smoke tests. Architect-side skill that runs in the outer Claude conversation, not inside a harny run. Sister of harny-review (per-run post-mortem) and harny-learnings (inbox capture + drain).
---

# harny-release

Architect-side skill. Operate as release manager across multiple harness runs within a release cycle.

## Two roles

| Role | Who | What they do |
|---|---|---|
| **Architect** | User + Claude | Discuss design, agree on outcomes, decide what's next, analyze run outputs, refine approach. **Make decisions.** |
| **Release manager** | Same humans, different hat | Operate harness invocations: dispatch, monitor, code-review, merge, triage findings. **Execute.** This skill guides the release-manager role. |

Same humans wear both hats; over time the release-manager role increasingly delegates to AI-orchestrated runs while the architect remains human-in-the-loop.

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

**Litmus test before dispatching:** if your prompt contains file paths, function signatures, or TypeScript code blocks → STOP, you're doing the planner's job. Rewrite as outcome + AC.

## Rules of engagement

These rules are policy, not contract. If a rule isn't serving after 5+ runs, change it explicitly.

### Rule 1 — No TS direto

No human writes TypeScript by hand. Every TS change goes through harness.

- Markdown (prompts, docs, CHANGELOG): editable by hand for agility.
- JSON config files: editable by hand.
- Probes (`scripts/probes/*`): may be hand-written when investigating XState/Bun behaviors that need empirical validation.
- TS production code (`src/**/*.ts`, `bin/**/*.ts`): **harness only**. If the architect feels they "need to just edit this real quick", pause and improve the setup — don't break the rule.

### Rule 2 — Preserve all runs

No `harny clean` during active development. Every run's `.harny/<slug>/` directory stays on disk indefinitely. Historical record + training data + comparison fuel.

When `.harny/` gets too cluttered (10+ runs), revisit — but default is preserve.

### Rule 3 — Each run produces one logical commit

Each `harny "..."` invocation should produce a coherent commit chain representing one focused change. Multi-task plans are fine if validator gates each task individually. Don't bundle multiple concerns into one prompt — that's N runs.

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

## Per-run loop

1. **Align prompt with architect** — product-vision shape (see "Prompt writing" below). Discuss until you both agree what success looks like.
2. **Dispatch** — `bun bin/harny.ts --task <slug> "..."` in background. Parallel where safe (see "Parallelism" below).
3. **Monitor** — `ScheduleWakeup` for long runs OR await background notification. Don't poll.
4. **Code-review (Rule 5)** — `git show <commit>` + re-run new probes + scan for dead code, missing error handlers, observability gaps, scope drift.
5. **Merge (Rule 4)** — `git checkout main && git merge --no-ff harny/<slug>` before next run.
6. **Triage findings** — apply this ordering:
   - **Prejudices this release → fix NOW** (don't backlog).
   - **Quick fixer that rounds out the system without blocking → fix NOW** (small infra wins compound).
   - **Doesn't prejudice the release → open GitHub Issue** for later.
7. **Optional: `/harny-review <slug>`** for non-trivial runs (failed, retried, novel architectural surface). Route its findings through the same triage in step 6.
8. **Loop or pause** — next run aligned with architect, OR pause for user direction.

**Emergent planning principle:** plan the immediate next move with full attention. Plan the run after that with what we learn from the immediate run. **No batch planning.**

## Prompt writing

### DO

- **Outcome statement.** "Wire X into Y so Z is invokable from CLI."
- **AC as observable behaviors.** "Running `harny --workflow <id>` against a tmp git repo produces a real commit on the run branch."
- **Constraints (must / must-not).** "Do not modify legacy `src/.../`. Do not invoke real Claude API in probes."
- **Test plan reference.** "Probe should be self-bounding (Promise.race deadlines)."
- **Separate validator-exercise vs read-only verification** when env limits exercise (e.g., no API key in validator subprocess). Be explicit: "Validator MUST exercise X. Validator MUST verify Y by reading code only."

### DON'T

- File paths or function signatures (planner's job).
- TypeScript code blocks specifying implementation (planner's job).
- AC numbered with cross-references that constrain order of operations.
- Prescribe `timeout N` (macOS gotcha — see CLAUDE.md "Gotchas").
- Inline reasoning the planner should derive.

### When you reach for detail, ask

- *Is this a CONSTRAINT (must/must-not) or an IMPLEMENTATION SUGGESTION (planner choice)?* → keep constraints, drop suggestions.
- *Is this AC (observable) or DESIGN (how the code should look)?* → keep AC, drop design.

## Parallelism heuristic

Multiple runs can dispatch concurrently if they touch **disjoint file sets**. Build a touch matrix before dispatching:

| Run | Files touched | Conflicts with |
|---|---|---|
| docs bundle | CLAUDE.md, README.md | (other docs runs) |
| orchestrator change | src/harness/orchestrator.ts | (other orchestrator runs) |
| new probe | scripts/probes/.../*.ts (new) | none (additive) |
| viewer | src/viewer/* | (other viewer runs) |

Sequential when:
- Two runs touch the same file (e.g., orchestrator-touching changes serialize).
- One run depends on another's output.

## Anti-patterns

| Anti-pattern | Cost | Fix |
|---|---|---|
| Architecture-detail prompts | Planner over-thinks; hides gaps | Product-vision prompts; trust planner |
| Mocks without smoke | Mocks pass while real system breaks | Always run real CLI smoke when wiring crosses engine ↔ SDK boundary |
| Ambiguous OR-AC | Validator can't satisfy "either A or B" when env limits one branch | Separate "MUST exercise" vs "MUST verify by reading" explicitly |
| Merging without diff review | Observability gaps + actor leaks slip past AC-scope checks | Rule 5: `git show <commit>` + re-run probe before every merge |
| Branching successive runs from stale main | Sibling-branch divergence | Rule 4: merge to main between runs |
| Stuck processes accumulate | CPU/token burn | Kill on first sign of hang; ask architect for auth |

## Cheap validator patterns

### The absolute rule

**The validator NEVER spawns a nested harny invocation.** A validator that invokes `bun bin/harny.ts` (or equivalent) to verify its own work burns real Claude tokens and introduces non-determinism. It also makes the harness non-composable — harny-in-validator creates process nesting, double-state writes, and a second run the outer harness cannot observe.

### Use the testing infrastructure instead

`src/harness/testing/` exports cheap helpers designed for exactly this purpose:

| Helper | What it gives you |
|---|---|
| `tmpGitRepo()` | Disposable `git init` dir with async `cleanup()`. |
| `runPhaseWithFixture(config, fixture)` | Canned `PhaseRunResult` injected via the `sessionRunPhase` DI seam — zero SDK calls. |
| `assertStateField(dir, dotPath, predicate)` | Read `state.json`, walk a dot-path, assert literal or predicate match. |
| `withSyntheticState(dir, partial, fn)` | Write a minimal valid `state.json`, run `fn`, clean up in finally. |
| `runEngineWorkflowDry(workflow, input, fixtures)` | Full XState machine run with all actors stubbed. Zero tokens. Returns final snapshot. |

Template: `scripts/probes/_templates/validator-smoke.ts` — copy and fill in.

### SDK-boundary escalation list

The only cases that may require real-Claude verification are changes that cross the Claude Agent SDK boundary:

- **`runPhaseAdapter`** — how engine args translate to `sessionRunPhase` args.
- **`sessionRecorder`** — the `runPhase` loop, event parsing, `PhaseRunResult` shape.
- **Zod-SDK schema serialization** — `z.ZodType` → `outputFormat.schema` translation (the `$schema` strip, field mappings).
- **Tool definitions** — new or renamed entries in `allowedTools` that the SDK must actually invoke.
- **Hooks** (`buildGuardHooks`) — guard logic that intercepts tool calls.
- **`canUseTool` semantics** — new modes or conditions on the tool-gating callback.
- **Session resume** — changes to the `resume` option threading or `resumeSessionId` plumbing.

Even for these, the right path is an **architect-run post-merge smoke** (e.g., `scripts/probes/engine/08-real-runphase-adapter.ts` style), never a nested harny invocation inside a validator phase.

### Before/after: E2E smoke → fixture-based AC

**Before (expensive, non-deterministic):**
```
AC: Run `bun bin/harny.ts --task X "..."` against a tmp git repo. Assert the run
    produces a commit on the branch and state.json shows lifecycle.status = "done".
```
Spends real Claude tokens; non-repeatable.

**After (fixture-based, zero tokens):**
```
AC: bun scripts/probes/testing/0N-task.ts exits 0.

The probe must:
1. Call runEngineWorkflowDry(workflow, input, fixtures) with actors stubbed
   (planner returns a plan, developer returns { status: 'done', commit_message },
   validator returns { verdict: 'pass', reasons }, commitActor returns { sha }).
2. Assert snapshot.status === 'done'.
3. Call withSyntheticState + assertStateField to verify lifecycle.status = 'done'.
```

Deterministic, fast, same correctness signal.

## How to re-orient on a fresh context

If returning to this work after a context compaction:

1. Read [`CLAUDE.md`](../../../CLAUDE.md) — invariants, gotchas, key paths.
2. Re-read this skill — policy + operational HOW.
3. Check `git log --oneline -20` — what was last committed.
4. Check `.harny/` for the most recent run; read its `state.json` + `review.md` (if `/harny-review` was invoked).
5. Scan open GitHub Issues + Discussions for pending architectural decisions.
6. Ask the user: "what's the next decision we're making?" Don't assume.

## Companion skills

- **`/harny-review <slug>`** — post-mortem of one finished run; emits findings pre-triaged (prejudices-release / quick-fix / backlog) so this skill can route them without re-classifying.
- **`/harny-learnings`** — capture (`/harny-learnings <text>`) + drain the inbox into Issues / CLAUDE.md edits / discards.
