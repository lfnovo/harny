---
name: drain
description: Triage accumulated learnings from the local harny inbox into GitHub Issues, CLAUDE.md edits, or discards. Walks one entry at a time, verifies claims against current code, opens issues with provenance. Sister of /learn.
allowed-tools: Bash, Read, Edit, Write
---

# drain — analytical triage of the harny learnings inbox

The drainable companion to `/learn`. Walks the user through the inbox at `<cwd>/.harny/LEARNINGS.local.md` (and optionally `.harny/*/review.md` files), classifying each entry into a destination — GitHub Issue, CLAUDE.md edit, or DISCARD — with evidence cited.

This skill is **analytical and slow**. Unlike `/learn` (which captures verbatim), drain verifies claims, decomposes multi-part actions, and writes back changes only with the user's approval per entry.

---

## Inputs

- **`<cwd>/.harny/LEARNINGS.local.md`** — raw captures from `/learn`.
- **`<cwd>/.harny/*/review.md`** — per-run reviews produced by `/review`. Treat the "Architect proposals" section as drainable; inline review narrative is context only.

If neither source has content, tell the user there's nothing to drain and stop.

---

## UX — walk one at a time

Batch summary tables tempt bulk classification without thinking. **Walk one entry at a time, human-in-the-loop.**

For N > 10 entries, offer the user a pause marker mid-drain:

> 5 done, 7 remaining — continue, or pause here?

---

## Per-item process

For each entry, in order:

### 1. Read the entry verbatim back to the user

So you both look at the same words.

### 2. Verify claims against current state

Before classifying, check the code/repo:

- **References to a file/commit/function** — does it exist? Does the referenced behavior match? Use `Read`, `git log -- <path>`, `git show <sha>`.
- **Look for absorption markers.** "Permanent fix landed", "Already infra-shipped", "Convention enshrined in CLAUDE.md" — strong DISCARD signals. Verify each.
- **Correlate with run history.** An entry about "task trailer duplication" + a run named `dedup-task-trailer` → fix likely landed. Check `git log --all --oneline --grep <keyword>`.
- **CLAUDE.md cross-check.** If the entry's principle is now documented, it's been absorbed.

### 3. Decompose multi-part actions

If the entry has sub-actions `(a)`, `(b)`, `(c)`, triage each separately. Common pattern: (a) and (b) landed, (c) is still open → opens an Issue scoped to (c) only, discards (a)+(b).

### 4. Apply the counterfactual test

> Would a fresh dev, reading only CLAUDE.md + code, hit the same friction?

If yes → there's still teaching to do (CLAUDE.md edit or Issue).
If no → the lesson has been absorbed elsewhere → DISCARD.

### 5. Propose a destination

Load the classification patterns once, early in the drain:

```
Read ${CLAUDE_SKILL_DIR}/patterns.md
```

Match the entry to one of the 6 patterns. Propose the destination with evidence.

### 6. Wait for user approval

Show:
- The classification verdict
- The evidence supporting it
- The proposed action (DISCARD, OPEN ISSUE, CLAUDE.md edit, DEFER)

Do not execute until the user says go.

### 7. Execute

Per verdict:

- **DISCARD** — Edit `.harny/LEARNINGS.local.md` to remove the entry. No other artifact created.
- **PROMOTED to CLAUDE.md** — Apply the edit (Edit tool). Remove inbox entry.
- **OPEN ISSUE** — Use `gh issue list --search ...` to dedup first; then `gh issue create` with proper title prefix and `learning` label. Remove inbox entry.
- **OPEN DISCUSSION** — `gh discussion create` with `rfc:` or `decide:` prefix. Remove inbox entry.
- **DEFERRED** — Edit the entry in place to add `[deferred YYYY-MM-DD: <reason>]`. Keep entry.

---

## Side-effect: stale doc drift

While verifying entries, you'll often spot **unrelated documentation drift** — a CLAUDE.md paragraph describing a value that changed months ago, a `§N` reference pointing at a deleted doc, etc.

**Rule:**
- **1-2 line factual fix** verifiable from code → propose inline alongside the current entry's verdict.
- **Larger drift** (paragraph, multiple refs, architectural staleness) → open a separate Issue with label `documentation` rather than expanding the entry's verdict.

---

## Cluster detection

Track classification cohorts during the walk. At the end, emit concise cluster alerts:

- **"Migration debt":** N entries absorbed by file X scheduled to migrate. List what must be preserved.
- **"Issue family":** N entries opened as Issues under a common theme. Propose a tracking milestone or umbrella Issue.
- **"Doc drift found":** Inline fixes applied during the walk. Summarize for the user's review.

---

## GitHub discipline

### Issues

- **Dedup first.** `gh issue list --search "<key terms>" --state all --json number,title,state`. Surface matches before opening.
- **Title prefix:** `feat:`, `bug:`, `learning:`, `docs:`, `chore:`.
- **Labels:** always `learning` if origin was a drained entry, plus one of `enhancement` / `bug` / `documentation`.
- **Body must include an "Origin" section** citing the source (file path + original entry text). Preserves provenance.

### Discussions

- Use Discussions (not Issues) when the entry poses an **open question** ("is this worth doing?", "which of 3 approaches?") rather than a ready-to-implement change.
- Title prefix: `rfc:` for debate, `decide:` for decision-shaped prompt.
- Labels: `rfc` or `decision`. Add `resolved` after the discussion concludes (enables ADR-style search via `label:decision label:resolved`).

---

## Inbox mutation

- DISCARD / PROMOTED / ISSUE-OPENED / DISCUSSION-OPENED → **delete the entry** from `.harny/LEARNINGS.local.md`.
- DEFERRED → **keep and annotate** with `[deferred YYYY-MM-DD: <reason>]`.
- No separate history of drained items is kept. The resulting Issue / commit / Discussion IS the history.

---

## What this skill does NOT do

- Does not auto-classify in batches without human approval.
- Does not edit files outside `.harny/LEARNINGS.local.md`, the proposed CLAUDE.md edits, and inline doc-drift fixes (each approved per-entry).
- Does not bulk-open issues — every Issue creation is a single, deduped, evidence-backed action.

---

## Edge cases

- **Inbox does not exist** → tell user, suggest `/learn` to capture first.
- **Entry references a slug whose `.harny/` dir was cleaned** → state is gone, but the entry text is still drainable. Verify against current code instead.
- **`gh` not authenticated** → ask user to `gh auth login`. Do not proceed with Issue/Discussion actions.
- **User rejects a proposed classification** → take the feedback. Their context overrides yours. Re-classify or defer.
- **Entry mid-drain triggers a follow-up thought from the user** → suggest they `/learn` it; resume drain.
