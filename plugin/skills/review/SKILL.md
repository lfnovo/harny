---
name: review
description: Analyze a Harny 0.5 run from run.json v4, audit events, normalized attempt transcripts, ChangeSets, and provider usage. Use after failed, retried, slow, costly, paused, mixed-provider, or otherwise surprising runs.
allowed-tools: Bash, Read, Write, Agent
---

# review — post-mortem analysis of a single harny run

Turn a finished Harny run into structured learnings. Walk bottom-up: attempt transcripts → node summaries → cross-run narrative → architect proposals.

Sister of `/release` (release orchestration) and `/learn` + `/drain` (learnings inbox).

---

## When to invoke

- After any run that surprised you — fail, retry, slow, novel architectural surface.
- Skip for trivial green runs that match expectations exactly (a doc tweak that planner→dev→validator passed in one shot with no anomalies has nothing to teach).
- Optionally invoked as a step inside `/release`'s per-run loop.

---

## Inputs

- A run identifier — slug (e.g. `command-actor`) or run_id prefix (≥8 chars).
- The run dir at `<cwd>/.harny/<slug>/` must still exist.

---

## Process — leaves to trunk

Use sub-agents for large independent transcripts when available. Transcripts can be tens of thousands of lines.

### Step 1 — Map the run

Read in main context:
- `<cwd>/.harny/<slug>/run.json` — authoritative nodes, attempts, artifacts, ChangeSets and outcome.
- `<cwd>/.harny/<slug>/events.jsonl` — append-only audit trail.
- `<cwd>/.harny/<slug>/transcripts/` — normalized event streams scoped to agent attempts.

Record: workflow, total wall-clock, attempt counts per node, terminal status, pending human state, ChangeSets, provider/model usage and reported-cost coverage.

### Step 2 — Locate attempt transcripts

For each agent node attempt in `run.json`, locate its local transcript:

```
.harny/<slug>/transcripts/<node>/attempt-<n>.jsonl
.harny/<slug>/transcripts/<foreach>/<index>/<step>/attempt-<n>.jsonl
```

Each line is a normalized record with `seq`, `at`, `provider`, and a typed `event`. A cleaned run has no remaining local transcript; review before cleanup.

### Step 3 — Analyze attempts independently

For large runs, launch one Explore-type sub-agent per transcript with this brief. For small runs, analyze directly:

> Read `<jsonl_path>`. The file is JSONL — one normalized event per line, including messages, reasoning, tools, file changes, plans, usage, lifecycle, status, and errors. Report:
>
> 1. **Tool call inventory:** count calls by normalized tool name/kind. List shell commands invoked (deduplicated, with frequency).
> 2. **Confusion moments:** any sequence where the agent retried the same operation 2+ times, backtracked, or expressed uncertainty.
> 3. **Errors:** every event with `type: error` and every tool event with `status: failed` or a non-empty `error`. Quote verbatim.
> 4. **Requirements slippage:** the prompt's acceptance criteria are <list them>. Did the agent address each? Did it drift outside scope?
> 5. **Wall-clock anomalies:** gaps >2min between consecutive events. What was happening?
> 6. **Notable choices:** non-obvious technical decisions — what and why (quote the justifying message).
>
> Reply in <300 words, bullets only. Cite line numbers when helpful.

Run independent analyses in parallel when the host supports it.

### Step 4 — Synthesize the cross-node narrative

In main context, weave per-attempt reports into a story:

- Did the planner over/under-decompose? Did it skip clarification it should have asked for?
- Did the developer's first attempt match the planner's intent?
- Did failures cascade (planner ambiguity → dev wrong direction → validator catches)? Or were they orthogonal?
- For retried runs: what changed between attempts? Was the validator's feedback actionable?

### Step 5 — Apply the counterfactual test

For every "this would have been smoother if X" observation:

> Would a fresh dev tomorrow, reading only AGENTS.md + the codebase, hit the same friction?

- **Yes** → propose a durable fix. Specify the lowest-impact location:
  - Root AGENTS.md "Gotchas" for cross-cutting invariants.
  - Subtree AGENTS.md for module-local conventions.
  - Code comment near the trap.
  - Probe template.
  - New harness primitive.
  - `/learn <text>` — capture into inbox when the right destination isn't immediately clear, for later drain.
- **No** (the agent should have known) → propose a one-time prompt simplification, OR diagnose why the agent missed something it had access to.

Reject "improve the prompt" as a default — that just hides the gap.

### Step 6 — Emit the review document

Output structure:

```markdown
## Review — <slug> (<date>)

### Headline
<one sentence: what happened, what mattered>

### Per-node summary
- <node> (<provider/model>, <duration>, <attempts>, <usage>): <one line>

### Confusion / errors / slippage
<bullets with evidence — JSONL line refs or quoted snippets>

### Architect proposals (counterfactual-tested + triaged)

Each proposal carries a triage tag so /release can route it without re-classifying:

- **[NOW-blocks]** — prejudices the current release. Must fix before next harness run.
- **[NOW-quick]** — quick fixer that rounds out the system; no blocking but compounds (a small infra hardening, a one-line docs gotcha that prevents a recurring bug class). Apply now if cheap.
- **[BACKLOG]** — file as `gh issue`; doesn't prejudice the release.

Format:
1. **<Name>** [NOW-blocks | NOW-quick | BACKLOG] — <pattern observed> → <counterfactual verdict> → <action with specific location>
2. ...

### Inbox captures
<one-line entries, copy-paste-ready for `/learn <text>`. One per finding that didn't land immediately. The architect can drain them later via /drain.>

### Backlog candidates for future harness runs
<one-line prompt seeds, e.g. "fix dedup of task=N trailer in commit composer">
```

### Step 7 — Persist the review to the run dir

Write the full review markdown to `<cwd>/.harny/<slug>/review.md`. **Automatic — do not wait for confirmation.** Reasons:

- Review co-locates with the run it analyzes; future reviews and meta-tooling find it without indirection.
- Survives compaction and context loss — the architect can re-read at any time without re-running the skill.
- If a re-review runs later, overwrite the file but prepend a `<!-- re-reviewed YYYY-MM-DD -->` marker.
- The file goes into the run directory, which is gitignored (`.harny/<slug>/.gitignore` = `*` + `!.gitignore`). Per-clone, not committed.

### Step 8 — Hand off the inbox captures

After confirmation, invite the architect to append each "Inbox captures" line via `/learn <text>`. **Do NOT auto-invoke `/learn`** — the architect may want to edit or skip entries.

---

## Notes

- This skill REVIEWS one finished run. `/release` GUIDES release orchestration; the triage tags here feed directly into `/release`'s per-run loop.
- Sub-agents (Explore type) are the right tool for transcript reading. Each transcript can be tens of thousands of lines.
- Be skeptical of agent self-reports ("I implemented X correctly") — verify against actual file diffs and validator behavior.
- Negative findings are as valuable as positive — a node attempt that went smoothly with no anomalies is a data point ("the prompt + codebase context were sufficient").

---

## Edge cases

- **Run dir gone** (`harny clean` was run) — state, audit events, and local transcripts were removed together. Tell the architect the run is no longer reviewable from Harny's evidence.
- **Multiple matching slugs** for the prefix — list them, ask which one.
- **Workflow is not feature-dev** — planner output may be absent or have a different shape. Adapt to the node outputs that exist.
