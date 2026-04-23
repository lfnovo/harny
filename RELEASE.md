# Harny — release policy

> **Purpose:** project policy + philosophy for v0.2.0+ development. The operational HOW lives in `.claude/skills/release-management/SKILL.md`. The architectural WHAT lives in [engine-design.md](./engine-design.md).

---

## Core commitment

**Harny is built BY harny, starting from day zero of v0.2.0 development.**

The thing being built (XState engine, file convention, variants, auto.ts boundary workflow, router, humanReview, meta-loop foundations) is developed using the harness that exists today. **Self-hosting from the first commit of Phase 1.** The harness eats its own tail.

If harny v0.1.x can't build harny v0.2.x, that's a signal — we improve the prompts/setup until it can. Every harness run generates training data the future meta-agent will consume.

---

## Two roles

| Role | Who | What they do |
|---|---|---|
| **Architect** | User + Claude | Discuss design, agree on outcomes, decide what's next, analyze run outputs, refine approach. **Make decisions.** |
| **Release manager** | Same humans, different hat | Operate the harness invocations: dispatch, monitor, code-review, merge, triage findings. **Execute.** Operational details in `.claude/skills/release-management/SKILL.md`. |

In v0.2.x the same humans wear both hats; long-term the release-manager role is increasingly delegated to AI runs.

---

## Rules of engagement

### Rule 1 — No TS direto

No human writes TypeScript by hand. Every TS change goes through harness.

- Markdown (prompts, docs, CHANGELOG, this file): editable by hand for agility.
- JSON config files: editable by hand.
- Probes (`scripts/probes/*`): may be hand-written when investigating XState/Bun behaviors that need empirical validation.
- TS production code (`src/**/*.ts`, `bin/**/*.ts`): **harness only**. If the architects feel they "need to just edit this real quick", that's a signal that harness isn't ready yet — pause and improve the setup, don't break the rule.

### Rule 2 — Preserve all runs

No `harny clean` during Phase 1+ development. Every run's `.harny/<slug>/` directory stays on disk indefinitely.

- Provides historical record of how harny was built.
- Generates training data for the future meta-agent.
- Lets architects compare runs to spot patterns.

When `.harny/` gets too cluttered (10+ runs), revisit — but default is preserve.

### Rule 3 — Each run produces one logical commit

Each `harny "..."` invocation should produce a coherent commit chain that represents one focused change. Multi-task plans are fine if validator gates each task individually. Don't bundle "engine scaffolding + first agentActor + first probe" into one prompt — that's three runs.

### Rule 4 — Merge to main after every passing run

After every passing run, the architect runs `git checkout main && git merge --no-ff harny/<slug>` before invoking the next run.

- Worktrees isolate the working tree but NOT the branch graph. Successive runs branched from `main` "forget" the prior runs and silently regress files modified on dangling branches (LEARNINGS L6).
- The validator's "no other files modified" check is per-worktree, not cross-branch — it cannot catch a regression that exists only relative to a sibling branch.
- Cumulative merge keeps `main` as source of truth.

Exception: stacking by intent (a follow-up fix on top of a half-done feature). Explicitly `git checkout harny/<prior-slug>` first and document why.

Branches are still preserved (Rule 2) — they form the run history. Merging doesn't delete them.

### Rule 5 — Architect spot-checks code before merge

After every PASS verdict and before `git merge --no-ff`, the architect MUST:

1. Read the diff (`git show <commit>`). Look for: code smells, dead code, unused imports, missing error handlers, hidden side effects, observability gaps.
2. Re-run the new probe(s) independently on the merge target.
3. Optionally re-run regression probes if the change touches a load-bearing path.

The validator verifies functional correctness against acceptance criteria. The architect verifies code shape, integration, and what the validator's prompt-scoped check can't see (LEARNINGS L8).

If issues found → triage per `.claude/skills/release-management/SKILL.md` per-run loop step 6: prejudices-release fix NOW; quick-fix-now apply; rest as `gh issue` backlog.

### Rule 6 — This doc evolves

`RELEASE.md` is policy, not a contract. If a rule isn't serving us after 5+ runs, we change it explicitly here — not silently.

---

## Per-run methodology — see the skill

Operational details (per-run loop, prompt writing principles, parallelism heuristic, anti-patterns) live in **`.claude/skills/release-management/SKILL.md`**. Companion skill `.claude/skills/review-run/SKILL.md` does post-mortems on individual runs.

**Emergent planning principle (worth repeating):** plan the immediate next move with full attention. Plan the run after that with what we learn from the immediate run. The engine-design.md gives us the destination; the path is discovered by walking. **No batch planning.**

---

## How to re-orient on a fresh context

If returning to this work after a context compaction:

1. Read this file (RELEASE.md) — policy + philosophy.
2. Read [`engine-design.md`](./engine-design.md) — full architecture, with `§0 Build status snapshot` showing current progress.
3. Read [`CLAUDE.md`](./CLAUDE.md) — codebase invariants and gotchas.
4. Read [`LEARNINGS.md`](./LEARNINGS.md) — cumulative architect-emitted observations + run cost reference table.
5. Skim [`.claude/skills/release-management/SKILL.md`](./.claude/skills/release-management/SKILL.md) — operational HOW.
6. Check `git log --oneline -20` — see what was last committed.
7. Check `.harny/` for the most recent run; read its `state.json` + `review.md` (if `/review-run` was invoked).
8. Ask user: "what's the next decision we're making?" Don't assume.

The combination of (this file + engine-design.md §0 + the most recent run's artifacts + the release-management skill) is enough to resume work without losing context.
