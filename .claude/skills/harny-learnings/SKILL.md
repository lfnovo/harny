---
name: harny-learnings
description: Capture and drain architect learnings about this project. Two modes - capture (fast, non-analytical, default) appends a raw note to the local inbox; drain (analytical, batched, manual) triages accumulated notes into GitHub Issues, CLAUDE.md edits, or discards. Invoke as `/harny-learnings <text>` for capture, or `/harny-learnings drain` for drain. Architect-side skill that runs in the outer Claude conversation, not inside a harny run.
---

# harny-learnings

Architect-side skill. Two modes — capture and drain — sharing the same inbox at `.harny/LEARNINGS.local.md` (gitignored, per-clone, working memory).

## Mode dispatch

Parse the skill's `args`:
- If `args` is empty or the first word is not `drain` → **capture mode**. Treat the entire `args` string as the learning text.
- If the first word is `drain` → **drain mode**.

If `args` is empty AND no obvious intent, default to capture mode and ask the user what to capture.

---

## Mode 1 — Capture (fast, non-analytical)

**Rule: do not analyze, do not propose solutions, do not ask follow-ups. Capture and return.**

The whole point of capture is zero friction — the architect is mid-conversation and wants to note something without breaking flow.

### Steps

1. **Locate the inbox:** `<cwd>/.harny/LEARNINGS.local.md`. The cwd is the current working directory of the Claude conversation.

2. **Lazy-create the file if missing** with this header exactly:

   ```markdown
   # harny learnings inbox

   Working memory, append-only, gitignored. Drain via `/harny-learnings drain`.
   Entry format: `- [<ISO UTC timestamp> · <branch>] <text>`
   ```

3. **Gather context** (cheap):
   - Current ISO UTC timestamp (e.g., `2026-04-23T18:45:00Z`).
   - Current git branch (`git rev-parse --abbrev-ref HEAD`). If detached or unavailable, use `-`.

4. **Append** a single-line entry:

   ```
   - [2026-04-23T18:45:00Z · main] the raw text verbatim
   ```

   If the text has newlines, indent continuation lines with two spaces so the bullet list stays valid:

   ```
   - [2026-04-23T18:45:00Z · main] first line
     continuation
     more continuation
   ```

   Do NOT rewrite, summarize, or "improve" the text. Copy verbatim.

5. **Confirm briefly** in the outer conversation:

   > Captured to `.harny/LEARNINGS.local.md`. Back to what we were doing.

   One line. No questions. No analysis. Return to prior context.

### What capture does NOT do

- Does not apply counterfactual test.
- Does not propose file targets.
- Does not open Issues.
- Does not edit CLAUDE.md.
- Does not prompt for more detail.

All of that belongs to drain.

---

## Mode 2 — Drain (analytical, batched, manual)

**Status:** shape established by the 2026-04-23 drain sonda (walked 14 entries across 12 learnings from the legacy `LEARNINGS.md`). Six classification patterns emerged — encoded below. Still iterate as more real drains happen.

### Inputs

- `.harny/LEARNINGS.local.md` — raw captures from `/harny-learnings <text>`.
- `.harny/*/review.md` — per-run reviews produced by the review skill (future `harny-review` / today `review-run`). Treat the "Architect proposals" section as the drainable content; inline review narrative is context only.

### UX — walk one at a time

Batch summary tables tempt bulk classification without thinking. Walk **one entry at a time**, human-in-the-loop. For N > 10 entries, offer the architect a pause marker mid-drain (e.g., "5 done, 7 remaining — continue?").

### Per-item process

1. **Read the entry.**
2. **Verify claims against the current codebase** before classifying:
   - Entries referencing a file/commit/function may have been absorbed. Check the referenced target exists and the referenced behavior matches.
   - Look for "Permanent fix landed" or "Already infra-shipped" markers — strong DISCARD signals.
   - Check commit history / subsequent runs with correlated slugs (e.g., an entry about "task trailer duplication" + a run called `dedup-task-trailer` → fix landed).
3. **Decompose multi-part actions.** If the original action block has `(a)`, `(b)`, `(c)`, triage each sub-action separately. One may be landed while another is still open.
4. **Apply the counterfactual test:** *"Would a fresh dev, reading only CLAUDE.md + code, hit the same friction?"*
5. **Propose a destination** (see classification patterns below).
6. **Record notes for the architect**, citing evidence (file paths, line numbers, commit SHAs, existing Issues).
7. **Wait for approval**, then execute:
   - Remove the inbox entry (discard/promoted/opened).
   - Annotate if deferred (`[deferred YYYY-MM-DD: <reason>]`).

### Classification patterns (six, from 2026-04-23 sonda)

**1. Absorbed into code + CLAUDE.md (DISCARD).** Action completely executed. Signals: function/file explicitly matches; CLAUDE.md has a bullet documenting the invariant; sibling-mirror or prompt-level guards exist. Example from sonda: L3 (dispatcher convention) — `§8.4` literally documented in engine CLAUDE.md, all 3 dispatchers have top-of-file comment, pattern enshrined.

**2. Absorbed by a later learning in the same log (DISCARD).** A positive-pattern or early observation that a subsequent run's action subsumed. Example: L2 (probe-driven validation is cheap, run #2) → L9 (cheap validator infra shipped) made this the default. Detect by scanning later entries for topical overlap + landed infra.

**3. Absorbed by a file slated for migration (DISCARD with inter-phase note).** Content lives in a doc/file scheduled to move into a skill (e.g., `RELEASE.md` → `harny-release`). Trust the migration to preserve substance; drop from inbox. Emit a **cluster alert** at end of drain listing all entries in this bucket so the phase doing the migration knows what must be preserved.

**4. Target dead but intent preserved elsewhere (DISCARD).** Action pointed at a file that no longer exists (or has been parked), yet the intent was captured by another mechanism — code-as-template via sibling-mirror rule, or absorption into CLAUDE.md. Example: L7 (Phoenix parity) pointed at `engine-design.md §9` (now in `specs/`) but the pattern is visible in `runEngineWorkflow.ts` which serves as template. Distinguish from "target dead AND intent not preserved" (which would be OPEN ISSUE).

**5. Action partially landed (mixed — may need OPEN ISSUE + DISCARD).** Multi-part action where some parts are done, others are explicit backlog. Open Issue for the still-open parts; DISCARD the rest with a note of what landed. Example: L1 (run #2 subprocess cleanup) — (a) and (b) landed, (c) probe template never scaffolded → Issue #22.

**6. Prompt-writing discipline without a home (OPEN ISSUE).** Guidance about how the architect should write prompts (e.g., "probes must exercise full argv → observable effect") with no natural existing destination. It doesn't belong in phase-prompt defaults (too specific), doesn't fit general CLAUDE.md gotchas (not "sempre que edita"). Open Issue targeting the future `harny-release` (or similar orchestration skill); the Issue travels until that skill absorbs it. Examples: L10 (#25), L11 (#26).

### Side-effect: stale doc drift

While verifying an entry against the current state, the skill often discovers **unrelated documentation drift** — a paragraph in CLAUDE.md describing a value that changed months ago, a `§N` reference pointing at a deleted doc, etc.

**Rule:** if the fix is 1-2 lines AND factually verifiable from the code, propose it inline with the current learning's verdict. Example from sonda: while verifying L12 (timeout bumped to 1800s in code), found CLAUDE.md still saying `600_000ms (10 min)` — fixed inline in the same turn.

If the drift is larger (paragraph, multiple refs, architectural staleness), open a separate Issue with label `documentation` rather than expanding the learning's verdict.

### Cluster detection and alerting

Track classification cohorts during the walk. At the end of the drain, emit concise cluster alerts:

- **"Migration debt":** N entries absorbed by file X that is scheduled to migrate. List what must be preserved.
- **"Issue family":** N entries opened as Issues under a common theme (e.g., probe-writing discipline). Propose a tracking milestone or umbrella Issue.
- **"Doc drift found":** inline fixes applied to CLAUDE.md / other docs during the walk. Summarize for the architect's review.

### GitHub Issue discipline

- **Dedup first.** Before opening, `gh issue list --repo <owner>/<repo> --search "<key terms>" --state all --json number,title,state`. Surface matches to the architect; don't blindly open duplicates.
- **Title prefix** from the convention: `feat:`, `bug:`, `learning:`, `docs:`, `chore:`.
- **Labels:** always `learning` when the origin was a drained learning, plus one of `enhancement` / `bug` / `documentation` for the work shape.
- **Body must include an "Origin" section** citing the learning source (file + original action text). Preserves provenance.

### Discussion discipline

- Use Discussions (not Issues) when the entry poses an **open question** ("is this worth doing?", "which of 3 approaches do we want?") rather than a ready-to-implement change.
- Title prefix: `rfc:` for debate, `decide:` for a decision-shaped prompt.
- Labels: `rfc` or `decision`. Add `resolved` after the discussion concludes (that enables the ADR-consultable property — search `label:decision label:resolved`).

### Mutation of the inbox

- DISCARD / PROMOTED / ISSUE-OPENED / DISCUSSION-OPENED → **delete the entry** (skill edits `.harny/LEARNINGS.local.md`).
- DEFERRED → **keep and annotate** with `[deferred YYYY-MM-DD: <reason>]` so it's not re-triaged next run.
- No separate history of drained items is kept. The resulting Issue / commit / Discussion IS the history.

---

## Notes

- **Skill is "outer".** Runs in the Claude conversation outside any harny run — the architect's top-level thread.
- **Inbox is gitignored.** Lives in `.harny/LEARNINGS.local.md`; the repo-level `.harny/.gitignore` (`*` + `!.gitignore`) keeps it out of git.
- **No automatic drain.** Manual trigger only. No cron, no hooks, no auto-trigger on N entries.
- **Prefix convention.** Issue titles use `feat:`, `bug:`, `learning:`. Discussion titles use `rfc:`, `decide:`. Labels: `learning`, `decision`, `resolved`, plus pre-existing (`rfc`, `spike`, `ready`, `epic`, `bug`, `enhancement`, ...).
