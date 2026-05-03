---
name: check-repo
description: Walk a repo through the harny readiness checklist. Score 10 dimensions Red/Yellow/Green, surface anti-signals, output a scorecard + prep checklist. Use when adopting harny in a new repo, or troubleshooting why it struggles in a familiar one.
allowed-tools: Bash, Read
---

# check-repo — readiness assessment for harny adoption

Interview-style walk through ten readiness dimensions. Goal: produce a scorecard the user can act on and a prep checklist of fixes to apply before the first harny run.

This skill **observes the repo and asks the user only what cannot be inferred**. Use the tools to look at the repo first; ask only when you need judgment or context.

---

## Step 1 — Locate the repo and frame

The cwd of the conversation is the target repo. Confirm by running:

```
git rev-parse --is-inside-work-tree
git rev-parse --show-toplevel
```

If the cwd is not a git repo, stop and tell the user. harny needs git.

Greet briefly, no preamble:

> Walking your repo through the harny readiness checklist. Ten dimensions, R/Y/G each. I'll observe what I can and ask you when I need judgment. End output is a scorecard you can act on.

---

## Step 2 — Optional: validate the validator first

Before scoring, read the "Validate the validator" section in `${CLAUDE_SKILL_DIR}/dimensions.md` and ask the user:

> Have you already run the install + validator command on `main` and confirmed it exits 0? If not, we should do that before scoring — it's the single most useful pre-flight step.

If they say no, walk them through it (steps in dimensions.md). If they say yes, proceed.

---

## Step 3 — Walk the ten dimensions

Load the full dimensions reference once:

```
Read ${CLAUDE_SKILL_DIR}/dimensions.md
```

For each of the 10 dimensions, in order:

1. **Read aloud** the dimension's "Why it matters" — one short paraphrase, not the full block. The user does not need to hear the doc verbatim.
2. **Gather evidence from the repo** using whatever tools fit the dimension. Examples:
   - Dim 2 (safe-reset): `git status`, look for floating files at root, check `.gitignore` coverage
   - Dim 3 (install): identify lock files, check CI workflow vs declared dependencies
   - Dim 6 (docs): look for `CLAUDE.md`, `ARCHITECTURE.md`, module-level docs
   - Dim 8 (branches): `git branch -a | wc -l`, `git branch -r`
   - Dim 9 (lint/type): identify configured tools, check whether CI blocks on them
3. **Ask only what is needed** — the diagnostic question or specific judgment calls. Do not ask the user to answer the checklist items one by one; you should infer most of them.
4. **Score Red / Yellow / Green** using the calibration in dimensions.md, with a one-sentence rationale that names the specific evidence.
5. Move on. Do not lecture, do not propose fixes inline — fixes go in the prep checklist at the end.

Pace: 30-60 seconds per dimension on average. Heavier dimensions (1, 7, 9) may need a question; lighter ones (8, 10) often score from observation alone.

---

## Step 4 — Anti-signals

After the 10 dimensions, scan for anti-signals (in dimensions.md). These are not scored — they are red flags that may make the repo a poor fit for harny regardless of dimension scores:

- "Done" is subjective (UX/design-heavy)
- Legacy without types or tests
- Cross-service changes are the norm
- Build requires hand-holding
- Active human edits in the same files concurrently
- Heavy credential dependence

Note any present.

---

## Step 5 — Produce the scorecard

Load the template:

```
Read ${CLAUDE_SKILL_DIR}/scorecard-template.md
```

Fill it in. Include:
- One-line rationale per dimension citing the evidence
- Anti-signals list (or "none observed")
- Overall verdict: `ready` / `ready with prep` / `not yet`
- A prep checklist of concrete fixes the user should apply before the first run
- A first-task suggestion: small, surgical, one-module — never a sweeping refactor for the first run

Output the scorecard to the conversation. Do not write it to a file unless the user asks.

---

## Step 6 — Offer next steps

Brief offer of follow-ups, only if relevant:

- If `ready with prep`: list the top 1-3 prep items the user could fix now.
- If `not yet`: explain the single biggest blocker.
- If `ready`: suggest a first task and which skill helps next (e.g., `/harny:harny` for orchestration model).

Do not auto-invoke other skills.

---

## What this skill does NOT do

- Does not write or modify any file in the user's repo.
- Does not commit, branch, or push anything.
- Does not invoke harny — that is the orchestrator agent's job.
- Does not auto-fix the items it flags. It produces a checklist; the user (or `/harny:harny`) drives action.

---

## Edge cases

- **Repo with no commits.** harny needs at least one commit. Tell the user `git commit --allow-empty -m "initial"` before retrying.
- **Repo without CLAUDE.md.** Score dimension 6 honestly (likely 🔴 or 🟡), do not lecture.
- **Mid-walk interruption.** If the user stops you with a question, answer it tersely and resume from the dimension you were on.
- **User pushes back on a score.** Take the feedback. The user knows their repo better than you do. Re-score with their context.
