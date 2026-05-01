---
name: harny
description: Onboarding and router for the harny plugin. Teaches the harny mental model (run anatomy, .harny/ state, architect role) and routes to focused skills. Use when adopting harny or unsure where to start.
allowed-tools: Bash, Read
---

# harny — start here

This is the umbrella skill for the harny plugin. Use it when:

- You're new to harny and want orientation.
- You know harny but forgot which slash command to use for a specific job.
- You want to evaluate whether harny is a good fit for a given repo.

The skill teaches the **mental model** and **routes you** to the focused skill that does the actual work.

---

## What harny is

[harny](https://github.com/lfnovo/harny) is a TypeScript task launcher built on the Claude Agent SDK. It runs a **planner → developer → validator** loop on your behalf, with the orchestrator (harny) committing only after the validator passes.

In practical terms: instead of telling Claude "do this thing in my repo and figure out when you're done", you tell harny "do this thing, and the validator command tells you when you're done." Harny handles iteration, retries, branch management, and commits.

**You stay in the loop as the architect.** You decide what to ship, what success looks like, and when to merge. Harny does the execution within your guardrails.

---

## How a harny run works

When you invoke `harny --name <slug> "<your prompt>"`:

1. **Planner** reads your prompt + the repo's `CLAUDE.md` and produces a plan (`plan.json`) with one or more tasks.
2. **Developer** executes one task at a time, making code changes.
3. **Validator** runs your validator command (typecheck, tests, lint, etc.). Read-only — no Edit/Write.
4. **If validator passes**, harny composes a commit message (developer's intent + validator's evidence) and commits.
5. **If validator fails**, harny retries the developer with the validator's feedback, up to a configurable cap. Reset between attempts is `git reset --hard` to the pre-phase SHA.
6. The run produces a branch `harny/<slug>` with one or more commits. You merge it (or not) when ready.

State of the run lives at `<cwd>/.harny/<slug>/`:

- `state.json` — phases, status, history.
- `plan.json` — task list with verdict history.
- `transcripts/` — per-phase SDK transcript pointers.
- The whole `.harny/` directory is gitignored — per-clone, never committed.

---

## The architect persona

The harny plugin uses the word **architect** for the human (you) operating from the **outer Claude Code conversation** — the conversation in your terminal where you interact with Claude. This is distinct from the agents *inside* a harny run (planner, developer, validator), who are not the architect.

The architect:

- Decides *what* to ship and *what success looks like*.
- Operates the slash commands in this plugin.
- Reviews diffs before merging (Rule 5 in `/release`).
- Captures friction via `/learn` for later triage via `/drain`.

The architect does **not**:

- Hand-write production code (Rule 1 in `/release`).
- Auto-merge without a diff review.
- Bulk-classify learnings without verification.

---

## Router — which skill for which job?

| You want to... | Use |
|---|---|
| Evaluate whether your repo is ready for harny | `/check-repo` |
| Note something interesting mid-conversation, no analysis | `/learn <text>` |
| Triage accumulated learnings into Issues / CLAUDE.md edits / discards | `/drain` |
| Post-mortem a single harny run that surprised you | `/review <slug>` |
| Operate as release manager across multiple harny runs | `/release` |
| Have an agent dispatch + monitor a harny run for you in natural language | `Task(subagent_type: "orchestrator", ...)` |

Prefix all skills with `/harny:` if your Claude Code resolves them by full namespace (e.g., `/harny:check-repo`).

---

## First-time adoption flow

If this is the first time you're using harny in a given repo, follow this order:

### 1. Install the harny CLI

```bash
bun install -g @lfnovo/harny
# or: npm install -g @lfnovo/harny
harny --version  # confirm
```

### 2. Run `/check-repo`

```
/check-repo
```

Walk through the 10-dimension readiness checklist. The skill produces a scorecard plus a prep checklist. Do the prep before the first run — it's much cheaper to fix readiness gaps now than to debug them mid-run.

### 3. (Optional) Add agent-instruction section to your CLAUDE.md

If your repo has accumulated lint/type debt on `main`, or if your validator command is non-obvious, document it explicitly for harny:

```markdown
## For Automated Agents

If you are an automated coding agent (harny, Claude Code in headless mode, etc.):

### Validator command
<paste the exact one-liner>

### Do NOT use as gates
<list tools that have pre-existing debt — explain why>
```

This single section saves hours of mid-run debugging.

### 4. Pick a small first task

Surgical scope. One module. Clear acceptance criteria. Do not start with "rewrite the auth system" — start with a bug fix or a single-file enhancement.

### 5. Dispatch

```bash
harny --name <some-slug> "<outcome statement + AC + constraints>"
```

Or have the orchestrator agent do it:

```
@orchestrator <natural-language intent>
```

### 6. Review the result

Check the diff before merging. If the run was non-trivial, run `/review <slug>` to extract learnings. Capture anything noteworthy via `/learn`.

### 7. Merge to main

```bash
git checkout main && git merge --no-ff harny/<slug>
```

Skipping this between runs causes the [sibling-branch silent-regress gotcha](https://github.com/lfnovo/harny). Always merge to main between sequential runs unless explicitly stacking.

---

## Common gotchas

- **`ANTHROPIC_API_KEY` in target repo's `.env`.** Bun auto-loads `.env` from cwd. If the target has the API key set, the SDK uses pay-per-use API billing instead of your Claude Code (Max/Pro) subscription. Workaround: prefix invocation with `ANTHROPIC_API_KEY= harny ...` (empty string overrides).
- **Pre-existing lint/type debt** as validator gate → harny tries to fix all of it. Either fix the debt, configure a baseline, or drop the tool from the validator.
- **Multiple long-lived branches** with stale work touching the same paths as your harny task → silent regression on later merge. Inventory before dispatching.
- **`harny clean`** during active development → loses run history that's useful for `/review` and `/drain`. Default is preserve.

---

## What this skill does NOT do

- Does not dispatch harny on your behalf — that's the `orchestrator` agent.
- Does not run the readiness checklist itself — that's `/check-repo`.
- Does not capture learnings — that's `/learn`.

This skill teaches and routes. The other skills do.

---

## When to come back here

- Forgot which skill does what → use the router table.
- A new architect joins your team → point them at this skill.
- Something feels off about how harny is behaving in your repo → re-read "Common gotchas" and consider re-running `/check-repo`.

---

## Notes

- This plugin is versioned independently of the `@lfnovo/harny` CLI. CLI breaking changes do not bump this plugin and vice-versa.
- All slash commands write only to `.harny/<slug>/` (which is gitignored) unless explicitly requested. They do not modify your code.
