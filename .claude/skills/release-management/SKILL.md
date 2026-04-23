---
name: release-management
description: Operate as harny release manager — orchestrate harness runs with product-vision prompts, dispatch in parallel when safe, code-review every merge, triage findings into now/quick/backlog, and surface gaps through smoke tests.
---

# release-management

Companion to RELEASE.md. Used when actively driving a Phase 1+ release — invoking harness, merging passing runs, deciding next move.

## When to invoke

- Active release work (multiple harness runs across an epic).
- Companion to `/review-run` (post-mortem of one finished run). This skill GUIDES the running; review-run REVIEWS one run.

## ⚠️ Role boundary — the most important rule

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
- Make the planner over-think (LEARNINGS L8 / run #16: planner spent 7min on an already-fully-spec'd prompt).

**Litmus test before dispatching:** if your prompt contains file paths, function signatures, or TypeScript code blocks → STOP, you're doing the planner's job. Rewrite as outcome + AC.

## Per-run loop

1. **Align prompt with architect** — product-vision shape (see "Prompt writing" below). Discuss until you both agree what success looks like.
2. **Dispatch** — `bun bin/harny.ts --task <slug> "..."` in background. Parallel where safe (see "Parallelism" below).
3. **Monitor** — `ScheduleWakeup` for long runs OR await background notification. Don't poll.
4. **Code-review (Rule 5)** — `git show <commit>` + re-run new probes + scan for: dead code, missing error handlers, observability gaps, scope drift. The validator's AC scope ≠ code health (LEARNINGS L8).
5. **Merge (Rule 4)** — `git checkout main && git merge --no-ff harny/<slug>` before next run. Branches are preserved (Rule 2); main is the integration point.
6. **Triage findings** — apply this ordering:
   - **Prejudices this release → fix NOW** (don't backlog). E.g., engine smoke surfaced 4 bugs in Epic B.5 — none could wait.
   - **Quick fixer that rounds out the system without blocking → fix NOW** (small infra wins compound: Rules 4+5, gitCommit add -A, schema pass-through).
   - **Doesn't prejudice the release → file as `gh issue` for later.** Cosmetic / nice-to-have / future-epic.
7. **Optional: `/review-run <slug>`** for non-trivial runs (failed, retried, novel architectural surface). Route its findings through the same triage in step 6.
8. **Loop or pause** — next run aligned with architect, OR pause for user direction.

## Prompt writing

### DO

- **Outcome statement.** "Wire engine workflow into orchestrator so feature-dev-engine can be invoked from CLI."
- **AC as observable behaviors.** "Running `harny --workflow feature-dev-engine` against a tmp git repo produces a real commit on the run branch."
- **Constraints (must / must-not).** "Do not modify legacy `src/harness/workflows/featureDev/`. Do not invoke real Claude API in probes."
- **Test plan reference.** "Probe should be self-bounding (Promise.race deadlines)."
- **Separate validator-exercise vs read-only verification** when env limits exercise (e.g., no API key in validator subprocess). Be explicit: "Validator MUST exercise X. Validator MUST verify Y by reading code only."

### DON'T

- File paths or function signatures (planner's job).
- TypeScript code blocks specifying implementation (planner's job).
- AC numbered with cross-references that constrain order of operations.
- Prescribe `timeout N` (macOS gotcha — see LEARNINGS L5; CLAUDE.md "Gotchas").
- Inline reasoning the planner should derive.

### When you reach for detail, ask:

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
- One run depends on another's output (e.g., B.5 needed B.4 first).

Successful runs in this session: 4 parallel runs at peak (#11 docs + #18 probe + #19 viewer + #20 CLI), all merged cleanly because file sets disjoint.

## Anti-patterns from this Phase 1 session

| Anti-pattern | Cost | Fix |
|---|---|---|
| Architecture-detail prompts | Planner over-thinks (run #16: 7min on already-spec prompt); hides gaps | Product-vision prompts; trust planner |
| Mocks without smoke | Epic B.5 mocks passed; smoke found 4 real bugs (timeout, schema bypass, prompt threading, gitCommit add) | Always run real CLI smoke when wiring crosses the engine ↔ SDK boundary |
| Ambiguous OR-AC | Validator can't satisfy "either A or B" when env limits one branch (B.5 first attempt: 3 retries before reset) | Separate "MUST exercise" vs "MUST verify by reading" explicitly |
| Merging without diff review | Validator AC scope ≠ code health; observability gaps + actor leaks slipped (L8) | Rule 5: `git show <commit>` + re-run probe before every merge |
| Branching successive runs from stale main | Sibling-branch divergence (L6: command.ts regression in `land-learnings`) | Rule 4: merge to main between runs |
| Stuck processes accumulate | Old probes left running for hours, burning CPU/tokens | Kill on first sign of hang; ask architect for auth |

## Companion

- **`/review-run <slug>`** — post-mortem of one finished run; emits findings classified by triage (prejudices-release / quick-fix-now / backlog) so this skill can route them.
- **`RELEASE.md`** — the methodology rules (1-6) + per-run ritual (steps 1-7 + 6.5).
- **`LEARNINGS.md`** — architect-emitted observation log (L1-L8 + cost reference table).
- **`engine-design.md` §0** — current build status snapshot.

## Cheap validator patterns

### The absolute rule

**The validator NEVER spawns a nested harny invocation.** A validator that invokes `bun bin/harny.ts` (or equivalent) to verify its own work burns real Claude tokens and introduces non-determinism. It also makes the harness non-composable — harny-in-validator creates process nesting, double-state writes, and a second run that the outer harness cannot observe.

### Use the testing infrastructure instead

`src/harness/testing/` exports five cheap helpers designed for exactly this purpose:

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

- **`runPhaseAdapter`** — changes to how engine args are translated to `sessionRunPhase` args
- **`sessionRecorder`** — changes to the `runPhase` loop, event parsing, or `PhaseRunResult` shape
- **Zod-SDK schema serialization** — how `z.ZodType` is translated to `outputFormat.schema` (the `$schema` strip, field mappings)
- **Tool definitions** — new or renamed entries in `allowedTools` that the SDK must actually invoke
- **Hooks** (`buildGuardHooks`) — guard logic that intercepts tool calls
- **`canUseTool` semantics** — new modes or conditions on the tool-gating callback
- **Session resume** — changes to the `resume` option threading or `resumeSessionId` plumbing

Even for these, the right escalation path is an **architect-run post-merge smoke** (e.g., `scripts/probes/engine/08-real-runphase-adapter.ts` style), never a nested harny invocation inside a validator phase.

### Before/after: E2E smoke → fixture-based AC

**Before (expensive, non-deterministic):**
```
AC: Run `bun bin/harny.ts --task l1-prompt-overlays "add overlay support"` against a tmp
    git repo. Assert the run produces a commit on the branch and state.json shows
    lifecycle.status = "done".
```
This spends real Claude tokens and makes the validator phase non-repeatable.

**After (fixture-based, zero tokens):**
```
AC: bun scripts/probes/testing/01-l1-prompt-overlays.ts exits 0.

The probe must:
1. Call runEngineWorkflowDry(featureDevWorkflow, input, fixtures) with plannerActor
   stubbed to return a plan containing the overlay task, developerActor stubbed to
   return { status: 'done', commit_message: 'feat: overlays' }, validatorActor
   stubbed to return { verdict: 'pass', reasons: ['overlays rendered'] }, and
   commitActor stubbed to return { sha: 'abc123' }.
2. Assert snapshot.status === 'done'.
3. Call withSyntheticState + assertStateField to verify lifecycle.status = 'done'
   without any real harness invocation.
```

The after-form is deterministic, fast, and gives the validator everything it needs to confirm the code wires up correctly — without burning tokens.
