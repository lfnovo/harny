---
name: learn
description: Append a one-line learning to the local harny inbox. Fast, non-analytical capture — copies text verbatim, no analysis, no follow-ups. Use when the user wants to note something about harny adoption mid-conversation without breaking flow.
allowed-tools: Bash, Read, Write, Edit
---

# learn — capture a harny learning

Fast, frictionless capture into the project's local harny inbox at `<cwd>/.harny/LEARNINGS.local.md`. Drained later by the `drain` skill.

**The whole point is zero friction.** The user is mid-conversation and wants to note something without breaking flow. Do not analyze. Do not ask follow-ups. Do not propose solutions. Capture and return.

## Steps

### 1. Locate the inbox

Path: `<cwd>/.harny/LEARNINGS.local.md`. The cwd is the current working directory of the conversation.

If `.harny/` does not exist, create it. The file `.harny/.gitignore` (containing `*` + `!.gitignore`) ships with harny runs and keeps everything inside `.harny/` out of git, including this inbox. If `.harny/` is being created here for the first time, also write that gitignore.

### 2. Lazy-create the inbox file if missing

Use this header exactly:

```markdown
# harny learnings inbox

Working memory, append-only, gitignored. Drain via `/drain`.
Entry format: `- [<ISO UTC timestamp> · <branch>] <text>`
```

### 3. Gather minimal context

- Current ISO UTC timestamp. Example: `2026-04-23T18:45:00Z`. Use `date -u +%Y-%m-%dT%H:%M:%SZ` via Bash.
- Current git branch via `git rev-parse --abbrev-ref HEAD`. If the repo is detached or `git` errors, use `-`.

### 4. Append the entry

Single-line format:

```
- [2026-04-23T18:45:00Z · main] the raw text verbatim
```

If the captured text has newlines, indent continuation lines with two spaces so the bullet list stays valid:

```
- [2026-04-23T18:45:00Z · main] first line
  continuation
  more continuation
```

**Copy the user's text verbatim.** Do not rewrite, do not summarize, do not "improve" the wording.

### 5. Confirm briefly

One short line back to the user, then return to whatever was being discussed:

> Captured to `.harny/LEARNINGS.local.md`. Back to what we were doing.

No questions. No analysis. No "would you like me to also...".

## What this skill does NOT do

- Does not apply the counterfactual test ("would a fresh dev hit this?").
- Does not propose file targets (CLAUDE.md edits, GitHub issues, etc.).
- Does not open issues or discussions.
- Does not edit any file other than `.harny/LEARNINGS.local.md` and (on first creation) `.harny/.gitignore`.
- Does not prompt for more detail.

All of that belongs to the `drain` skill, invoked separately when the user is ready to triage accumulated entries.

## Edge cases

- **No `args` provided.** Ask one short question: "What do you want me to capture?" — then return to the steps above. Do not ask for elaboration on the content.
- **`args` starts with the word `drain`.** Do not run capture. Tell the user this skill is for capture only and suggest `/drain` for triage. Do not invoke `drain` automatically.
- **`.harny/` exists but is not a directory** (e.g., a file with that name). Stop and report — do not overwrite.
- **`git` command unavailable.** Use `-` for the branch field rather than failing.
