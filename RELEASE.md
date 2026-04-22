# Harny — release approach

> **Purpose:** capture the methodology for developing harny v0.2.0+. This doc is the HOW; [engine-design.md](./engine-design.md) is the WHAT (technical architecture). Read both. This doc is meant to re-orient a fresh context window — it's self-sufficient.

---

## Core commitment

**Harny is built BY harny, starting from day zero of v0.2.0 development.**

The thing being built (XState engine, file convention, variants, auto.ts boundary workflow, router, humanReview, meta-loop foundations) is developed using the harness that exists today (v0.1.1, `feature-dev` workflow on planner → dev → validator).

**Self-hosting from the first commit of Phase 1.** The harness eats its own tail.

Why: this IS the product vision in action. If harny v0.1.1 can't build harny v0.2.0, that's a signal — we improve the prompts/setup until it can. Every harness run generates the training data the future meta-agent will consume.

---

## Two roles

| Role | Who | What they do |
|---|---|---|
| **Architect** | User + Claude (this conversation) | Discuss design, write prompts together, decide what's next, analyze run outputs, refine approach. **Make decisions.** |
| **Release manager** | Future runs of (User + AI) | Operate many harness invocations during deployment. Apply patterns established here. **Execute.** |

In v0.2.0 development, both roles are the same humans. But the architect role is dominant — we're establishing the patterns that release managers will follow long-term.

---

## Per-run methodology

For every single harness invocation:

1. **Decide WHAT to do next.** Based on the previous run's outcome + the engine-design.md roadmap.
2. **Discuss the prompt together** in chat. Architect (Claude) drafts, user refines, both agree.
3. **Run harness.** Use `bunx @lfnovo/harny` (or local `bun bin/harny.ts`) with the agreed prompt + appropriate flags.
4. **Wait.** Each run takes 5-15 min (planner + dev + validator + retries). That's OK.
5. **Analyze outcome together.** Read state.json, plan.json, transcripts. What worked? What surprised us?
6. **Discuss improvements.** Was the prompt too vague? Did the planner over-decompose? Did the validator miss something? Note observations.
6.5. **Extract at least one infra-improvement candidate.** Apply the **counterfactual test**: would a fresh dev tomorrow, reading only CLAUDE.md + the codebase, succeed without the hint we added in the prompt? If **no**, the gap belongs somewhere durable — CLAUDE.md "Gotchas", a code comment near the trap, an `engine-design.md` section, or a probe template — **not in the prompt**. The prompt is a crutch; we want harny to be the reason for success, not our nudges. Log to `LEARNINGS.md` (architect-emitted observations, distinct from `state.json:problems[]` which is agent-emitted).
7. **Plan the next run.** Apply learnings.

**No batch planning.** We do not write the next 5 prompts in advance. The next prompt is shaped by what we learned from the last one.

---

## Emergent planning principle

The earlier draft tried to plan 12 prompts across 6 waves. **Abandoned.** We don't know enough yet about how harness behaves on this codebase to plan that far ahead.

Replacement principle: **plan the immediate next move with full attention. Plan the run after that with what we learn from the immediate run.**

The engine-design.md gives us the destination. The path is discovered by walking.

---

## Rules of engagement

### Rule 1: No TS direto

**From the first harness run of Phase 1 onward, no human writes TypeScript by hand.** Every TS change goes through harness.

- Markdown (prompts, docs, CHANGELOG, this file): editable by hand for agility.
- JSON config files: editable by hand.
- Probes (`scripts/probes/*`): may be hand-written when investigating XState/Bun behaviors that need empirical validation outside of normal development.
- TS production code (`src/**/*.ts`, `bin/**/*.ts`): **harness only**. If the architects feel they "need to just edit this real quick", that's a signal that harness isn't ready yet — pause and improve the setup, don't break the rule.

### Rule 2: Preserve all runs

**No `harny clean` during Phase 1 development.** Every run's `.harny/<slug>/` directory stays on disk indefinitely. Reasons:

- Provides historical record of how harny was built.
- Generates training data for the future meta-agent.
- Lets architects compare runs to spot patterns ("planner over-decomposed every time we asked for type stubs").

When `.harny/` gets too cluttered (10+ runs), revisit — but default is preserve.

### Rule 3: Each run produces one logical commit

Multi-task plans are fine if validator gates each task individually. But each `harny "..."` invocation should produce a coherent commit chain that represents one focused change. Don't try to bundle "engine scaffolding + first agentActor + first probe" into one prompt — that's three runs.

### Rule 4: Merge to main after every passing run

After every harness run that ships a passing commit, the architect runs `git checkout main && git merge --no-ff harny/<slug>` before invoking the next run. Reasons:

- Worktrees isolate the working tree but NOT the branch graph. Successive runs branched from `main` "forget" the prior runs and silently regress files that were modified on dangling branches.
- The validator's "no other files modified" check is per-worktree, not cross-branch — it cannot catch a regression that exists only relative to a sibling branch.
- Cumulative merge keeps `main` as the source of truth, so the next run branches from a state that includes everything before it.

Exception: stacking by intent (e.g., a follow-up fix on top of a half-done feature). In that case, explicitly `git checkout harny/<prior-slug>` before invoking and document why in the prompt or commit message.

Branches are still preserved (Rule 2) — they form the run history. Merging doesn't delete them.

### Rule 5: This doc evolves

`RELEASE.md` is not a contract. It's a working agreement that we update as we learn. If a rule isn't serving us after 5 runs, we change it explicitly here — not silently.

---

## Current state (as of writing this doc)

- ✅ harny v0.1.1 published on npm (`@lfnovo/harny`)
- ✅ engine-design.md v3 — full architecture, 24 decisions consolidated, 0 strategic items pending
- ✅ XState probe — validated assumptions, kept as regression test at `scripts/probes/xstate/01-snapshot-recursion.ts`
- ✅ humanReview design landed (replace-only file convention with variants)
- ✅ auto.ts boundary workflow design landed (hybrid graph+try/finally cleanup)
- ✅ Phase 0 hand-coded scope decided: **nothing additional**. We have what we need.

**Phase 1 begins with the first harness invocation. We are about to write the first prompt together.**

---

## Pending decision: first prompt

Three candidates discussed. User leaning is open.

### Option 1 — Calibration ultra-safe (docs cleanup)
> "Delete TIER4_PLAN.md (superseded, marked at top). Update CHANGELOG.md noting the cleanup. Update CLAUDE.md if there are references."

- Risk: zero. Learning: low. Easy mode.

### Option 2 — Calibration honest (CLAUDE.md update)
> "Read engine-design.md. Add a new section to CLAUDE.md explaining the v0.2.0 engine architecture. Keep all existing content."

- Risk: low. Learning: medium. Tests doc-reading + writing capability.

### Option 3 — Real engine work, microscopic (engine/ scaffolding) [LEAN]
> "Create src/harness/engine/ directory with empty TypeScript stubs: types.ts, defineWorkflow.ts, dispatchers/{agent,command,humanReview}.ts, harnyActions.ts. Each file exports placeholder types/functions matching contracts in engine-design.md §8 and §10. Add src/harness/engine/README.md explaining the structure. Do NOT implement logic — only types and signatures."

- Risk: low-medium (only types, no logic). Learning: high (real engine work, sets pattern, useful for next runs).
- Architect lean: this one. Honest test of harness on real-but-bounded engine work.

### Option 4 — First real implementation (agentActor)
> "Implement agentActor in src/harness/engine/dispatchers/agent.ts per §9.1.1. Wrap runPhase, thread AbortSignal, read prior session_id from state.json. Include probe."

- Risk: medium-high. Learning: very high but failure modes hard to diagnose without scaffolding precedent.

---

## Immediate next step

Architect (user + Claude) finalize choice between options 1-4 + draft the actual prompt to use. Then invoke harness. Then analyze together.

If user picks Option 3 (architect lean), draft prompt is approximately:

```
Create src/harness/engine/ directory scaffolding for the v0.2.0 XState engine.

Read engine-design.md (entire file) for context, especially §8 (harny SDK), §10 (customization layers), and §11 (workflow shapes).

Create these files as TypeScript STUBS (types and function signatures only, no logic):
- src/harness/engine/types.ts — core types: WorkflowDefinition, ActorContext, FeatureSet, etc.
- src/harness/engine/defineWorkflow.ts — defineWorkflow() function signature
- src/harness/engine/harnyActions.ts — placeholder action registry per §8.2
- src/harness/engine/dispatchers/agent.ts — agentActor() factory signature
- src/harness/engine/dispatchers/command.ts — commandActor() factory signature
- src/harness/engine/dispatchers/humanReview.ts — humanReviewActor() factory signature
- src/harness/engine/README.md — folder structure explanation

Constraints:
- Add xstate@5 to package.json (devDependency for now).
- All function bodies should throw `new Error("not implemented")` or return type-correct stubs.
- Run `bun run typecheck` to confirm everything compiles.
- DO NOT modify any existing src/harness/ files.

Acceptance criteria:
1. All listed files exist with declared exports.
2. `bun run typecheck` passes clean.
3. Each file has a top-of-file comment referencing the engine-design.md section it implements.
4. README.md explains the role of each file in 1-2 lines.
5. xstate@5 appears in package.json devDependencies.
```

(Final wording to be agreed in chat before invocation.)

---

## How to re-orient on a fresh context

If returning to this work after a context compaction:

1. Read this file (RELEASE.md) — methodology and current state.
2. Read [engine-design.md](./engine-design.md) — full architecture, 24 decisions, open items map.
3. Read [CLAUDE.md](./CLAUDE.md) — codebase invariants and gotchas.
4. Check `.harny/` directory — find most recent run, read its state.json + plan.json to see what was last attempted.
5. Check `git log` — see what was last committed.
6. Ask user: "what's the next decision we're making?" Don't assume.

The combination of (this file + engine-design.md + the most recent run's artifacts) should be enough to resume work without losing context.
