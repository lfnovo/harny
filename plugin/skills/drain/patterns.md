# Classification patterns

Six patterns from the 2026-04-23 drain sonda (walked 14 entries across 12 learnings from the legacy `LEARNINGS.md`). Match each inbox entry to one of these, with evidence cited.

---

## 1. Absorbed into code + CLAUDE.md (DISCARD)

The action was completely executed.

**Signals:**
- Function/file mentioned in the entry exists and matches the described behavior.
- CLAUDE.md has a bullet documenting the invariant.
- Sibling-mirror or prompt-level guards exist.

**Example.** Entry: "dispatcher convention should be enforced." Verification: `§8.4` literally documented in engine CLAUDE.md, all 3 dispatchers have top-of-file comment, pattern enshrined.

**Action:** DISCARD. No further work needed.

---

## 2. Absorbed by a later learning in the same log (DISCARD)

A positive-pattern or early observation that a subsequent run's action subsumed.

**Signals:**
- Entry describes a problem or idea.
- A later entry (or commit/run history) shows infra was shipped that makes the original moot.
- Topical overlap between the two.

**Example.** Entry L2: "probe-driven validation is cheap" (run #2). L9: "cheap validator infra shipped." L9 made L2's observation the default.

**Action:** DISCARD. Cite the later entry as evidence.

---

## 3. Absorbed by a file slated for migration (DISCARD with inter-phase note)

Content lives in a doc/file scheduled to move into a skill or other artifact.

**Signals:**
- The proposed target was `RELEASE.md` or similar — and that doc is being migrated to a skill.
- The substance of the action will travel with the migration.

**Action:** DISCARD. **Emit a cluster alert at end of drain** listing all entries in this bucket so the phase doing the migration knows what must be preserved.

---

## 4. Target dead but intent preserved elsewhere (DISCARD)

Action pointed at a file that no longer exists, yet the intent was captured by another mechanism.

**Signals:**
- Entry references a file/doc/section that has been moved or deleted.
- The intent is now visible elsewhere (sibling-mirror rule, CLAUDE.md absorption, code-as-template).

**Example.** L7 (Phoenix parity) pointed at `engine-design.md §9` (now in `specs/`) but the pattern is visible in `runEngineWorkflow.ts` which serves as template.

**Action:** DISCARD. Distinguish from "target dead AND intent not preserved" (which would be OPEN ISSUE).

---

## 5. Action partially landed (mixed — may need OPEN ISSUE + DISCARD)

Multi-part action where some parts are done, others are explicit backlog.

**Signals:**
- Entry has sub-actions `(a)`, `(b)`, `(c)`.
- Verifying each sub-action shows mixed status.

**Example.** L1 (run #2 subprocess cleanup) — (a) and (b) landed, (c) probe template never scaffolded → Issue #22 opened scoped to (c) only.

**Action:** OPEN ISSUE for the still-open parts; DISCARD the rest with a note of what landed.

---

## 6. Prompt-writing discipline without a home (OPEN ISSUE)

Guidance about how the architect should write prompts, with no natural existing destination.

**Signals:**
- Entry is meta-guidance ("probes must exercise full argv → observable effect", "phase prompts should X").
- Doesn't fit phase-prompt defaults (too specific).
- Doesn't fit general CLAUDE.md gotchas (not "always when editing").

**Examples.** L10 → Issue #25. L11 → Issue #26.

**Action:** OPEN ISSUE targeting the future skill that would absorb it (e.g., `harny-release` or `harny-orchestrator`). The Issue travels until that skill incorporates it.

---

## When in doubt

- "Verify before classify" beats "guess fast." It's better to spend 60 seconds on a `git log` than to misclassify.
- If you can't tell whether the action landed, mark DEFERRED and move on.
- If the user pushes back on your classification, take the feedback — they know their codebase better than you.
