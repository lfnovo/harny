---
name: harny-review
description: Post-mortem analysis of a single harny run. Reads state.json + plan.json + every phase's SDK transcript (.jsonl), surfaces moments of confusion, errors, requirements slippage, and emits a leaves-to-trunk review with evidence-backed improvement proposals. Invoke after any harness invocation that produced non-trivial learnings — especially failed/retried runs, runs that hit unexpected wall-clock, or runs touching new architectural ground. Architect-side skill that runs in the outer Claude conversation, not inside a harny run.
---

# harny-review

Architect-side skill. Turns a finished harny run into structured learnings. Sister of `harny-release` (release orchestration) and `harny-learnings` (inbox capture + drain).

## When to invoke

- After every harness run that surprised us (fail, retry, slow, novel architectural surface).
- Skip for trivial green runs that match expectations exactly (e.g., a doc tweak that planner→dev→validator passed in one shot with no anomalies).
- Optionally invoked as step 7 of `harny-release`'s per-run loop.

## Inputs

- A run identifier — slug (e.g. `command-actor`) or run_id prefix (≥8 chars).
- The run dir at `<cwd>/.harny/<slug>/` must still exist (`harny-release` Rule 2: preserve all runs).

## Process — leaves to trunk

The review walks bottom-up: individual phase transcripts → per-phase summary → cross-phase narrative → architect proposals. Use sub-agents aggressively to keep the main context window clean.

### Step 1 — Map the run

Read these files in the main context:
- `<cwd>/.harny/<slug>/state.json` — phases array, history, status, ended_reason, problems
- `<cwd>/.harny/<slug>/plan.json` — task list with verdict history (if feature-dev)

Record: workflow, total wall-clock, attempt counts per phase, terminal status, any agent-emitted `problems[]`.

### Step 2 — Locate phase transcripts

For each entry in `state.json:phases[]`, the SDK transcript is at:

```
~/.claude/projects/<encoded-cwd>/<session_id>.jsonl
```

Where `<encoded-cwd>` is the run's working directory (the worktree path if isolation=worktree, else cwd) with `/` replaced by `-` and a leading `-`. If the worktree was cleaned, the encoded dir uses the worktree path that no longer exists on disk — the JSONL still lives under that name.

### Step 3 — Spawn one sub-agent per phase (in parallel)

Launch one Explore-type sub-agent per phase transcript with this brief:

> Read `<jsonl_path>`. The file is JSONL — one event per line, mix of agent messages, tool_use, tool_result, attachments, hooks. Report:
> 1. **Tool call inventory:** count of Bash, Read, Edit, Write, Grep, Glob calls. Names of bash commands invoked (deduplicated, with frequency).
> 2. **Confusion moments:** any sequence where the agent retried the same operation 2+ times, backtracked, or expressed uncertainty in its messages.
> 3. **Errors:** every `tool_result` with `is_error: true` or non-zero exit_code in Bash output. Quote the error verbatim.
> 4. **Requirements slippage:** the prompt's acceptance criteria are <list them>. Did the agent address each? Did it drift into work outside scope?
> 5. **Wall-clock anomalies:** gaps >2min between consecutive events. What was happening?
> 6. **Notable choices:** non-obvious technical decisions the agent made — what and why (quote the message that justified it).
>
> Reply in <300 words, bullets only. Cite line numbers in the JSONL when helpful.

Run sub-agents in parallel (single message, multiple Agent tool calls).

### Step 4 — Synthesize cross-phase narrative

In the main context, weave the per-phase reports into a story:
- Did the planner over/under-decompose? Did it skip clarification it should have asked for?
- Did the developer's first attempt match the planner's intent?
- Did failures cascade (planner ambiguity → dev wrong direction → validator catches)? Or were they orthogonal?
- For retried runs: what changed between attempts? Was the validator's feedback actionable?

### Step 5 — Apply the counterfactual test

For every "this would have been smoother if X" observation, apply the test:

> Would a fresh dev tomorrow, reading only CLAUDE.md + the codebase, hit the same friction?

- **Yes** → propose a durable fix. Specify the lowest-impact location:
  - CLAUDE.md "Gotchas" (root, auto-loaded) for cross-cutting invariants.
  - Subtree CLAUDE.md (e.g., `src/harness/engine/CLAUDE.md`) for module-local conventions.
  - Code comment near the trap.
  - Probe template.
  - New harness primitive.
  - `/harny-learnings <text>` — capture into inbox when the right destination isn't immediately clear, for later drain.
- **No** (the agent should have known) → propose a one-time prompt simplification for next time, OR diagnose why the agent missed something it had access to (model capability gap? ambiguous existing code?).

Reject "improve the prompt" as a default — that just hides the gap.

### Step 6 — Emit review document

Output structure:

```markdown
## Review — <slug> (<date>)

### Headline
<one sentence: what happened, what mattered>

### Per-phase summary
- planner (<duration>, <attempts>): <one line>
- developer (<duration>, <attempts>): <one line>
- validator (<duration>, <attempts>): <one line>

### Confusion / errors / slippage
<bullets with evidence — JSONL line refs or quoted snippets>

### Architect proposals (counterfactual-tested + triaged)

Each proposal carries a triage tag so `harny-release` can route it without re-classifying:

- **[NOW-blocks]** — prejudices the current release. Must fix before next harness run.
- **[NOW-quick]** — quick fixer that rounds out the system; no blocking but compounds (e.g., a small infra hardening, a one-line docs gotcha that prevents a recurring bug class). Apply now if cheap.
- **[BACKLOG]** — file as `gh issue`; doesn't prejudice the release.

Format:
1. **<Name>** [NOW-blocks | NOW-quick | BACKLOG] — <pattern observed> → <counterfactual verdict> → <action with specific location>
2. ...

### Inbox captures
<one-line entries, copy-paste-ready for `/harny-learnings <text>`. One per finding that didn't land immediately. The architect can drain them later via `/harny-learnings drain`.>

### Backlog candidates for future harness runs
<one-line prompt seeds, e.g. "fix dedup of task=N trailer in commit composer">
```

### Step 7 — Persist the review to the run dir

Write the full review markdown (the document emitted in step 6) to `<cwd>/.harny/<slug>/review.md`. This is automatic — do NOT wait for confirmation. Reasons:

- Review co-locates with the run it analyzes; future reviews and the meta-agent find it without indirection.
- Survives compaction and context loss — the architect can re-read at any time without re-running the skill.
- If a re-review is run later (e.g., after more context emerges), overwrite the file but prepend a `<!-- re-reviewed YYYY-MM-DD -->` marker.
- The file goes into the run directory, which is gitignored at the project level (`.harny/<slug>/.gitignore` = `*` + `!.gitignore`). It is per-clone, not committed.

### Step 8 — Hand off the inbox captures

After the architect confirms the review, invite them to append each "Inbox captures" line via `/harny-learnings <text>`. Do NOT auto-invoke the capture — the architect may want to edit or skip entries. The captured entries land in `.harny/LEARNINGS.local.md` for later drain.

## Notes

- Companion to `harny-release` — that skill GUIDES release orchestration; this one REVIEWS one finished run. Triage tags ([NOW-blocks] / [NOW-quick] / [BACKLOG]) feed directly into `harny-release`'s per-run loop step 6.
- This skill is the architect's tool, not the harness's. It runs in the *outer* Claude conversation that orchestrates harny invocations.
- Sub-agents (Explore type) are the right tool for transcript reading: each transcript can be tens of thousands of lines and you don't want them in the main context.
- Be skeptical of agent self-reports ("I implemented X correctly") — verify against actual file diffs and validator behavior.
- Negative findings are as valuable as positive — a phase that went smoothly with no anomalies is a data point ("the prompt + codebase context were sufficient").
