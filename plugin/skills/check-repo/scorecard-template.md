# Scorecard template

Output the scorecard in this exact format. Replace `<...>` with the assessment.

```
Repo: <name>
Date: <YYYY-MM-DD>

1.  Validator gates ............... <emoji> — <one-sentence rationale citing evidence>
2.  Safe-reset hygiene ............ <emoji> — <one-sentence rationale citing evidence>
3.  Deterministic install ......... <emoji> — <one-sentence rationale citing evidence>
4.  Feedback loop time ............ <emoji> — <one-sentence rationale citing evidence>
5.  Task granularity / modularity . <emoji> — <one-sentence rationale citing evidence>
6.  Agent context (documentation) . <emoji> — <one-sentence rationale citing evidence>
7.  Testability ................... <emoji> — <one-sentence rationale citing evidence>
8.  Branch discipline ............. <emoji> — <one-sentence rationale citing evidence>
9.  Type and lint enforcement ..... <emoji> — <one-sentence rationale citing evidence>
10. Repo hygiene & secrets ........ <emoji> — <one-sentence rationale citing evidence>

Anti-signals present:
  - <signal> (or "none observed")

Overall: <ready | ready with prep | not yet>

First task suggestion:
  <small, surgical, one-module — never a sweeping refactor>

Prep checklist before first run:
  - <concrete fix>
  - <concrete fix>
  - <concrete fix>
```

## Notes for filling it in

- **Emoji** is one of 🟢 🟡 🔴 per the calibration in dimensions.md.
- **Rationale must cite evidence** — names a file, a count, a specific finding. Not "looks good" but "33 active local branches; many predate v0.2.0".
- **Overall** maps from dimension scores:
  - `ready` — all 🟢 or near-all 🟢 with one acceptable 🟡.
  - `ready with prep` — multiple 🟡, one or two 🔴 that are fixable in <30 min, no anti-signals dominant.
  - `not yet` — multiple 🔴, or a dominant anti-signal that no amount of prep fixes.
- **First task suggestion** should be cirurgical — name a real candidate when possible (e.g., "fix issue #N", "add parameter X to provider Y"), not a category.
- **Prep checklist** is concrete and ordered by impact. "Add `notebooks/` to .gitignore" beats "improve hygiene".
