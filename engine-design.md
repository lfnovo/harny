# Harny engine — design v3

> Status: **draft for review**. Consolidates all design discussions: XState v5 + thin harny SDK, workflows as TS files, humanReview as first-class primitive, **boundary workflow `auto.ts` with sub-actor pattern**, **router as a pre-node**, **ML features per run** for meta-agent learning. Replaces v2 (which had not yet established the boundary pattern, router, or ML features framing).

---

## Status legend

Callouts throughout this doc use one of:

- ⚠️ **OPEN —** decision not yet made; needs discussion before the relevant phase. **These are the points that need attention.**
- ✅ **DECIDED —** settled, included for clarity (mostly in §13 table).
- ⏭️ **DEFERRED —** intentionally postponed to a later phase or post-MVP.
- 🔬 **PROBE —** Phase 0 hands-on validation needed; design depends on result.

A consolidated map of all OPEN/DEFERRED/PROBE items is in §14.

---

## 0. Build status snapshot — 2026-04-23

Quick overview of what's been built so far against the design. **Updated after each significant epic.**

| Area | Status | Where |
|---|---|---|
| **Phase 0 spike** | ✅ DONE | XState probe at `scripts/probes/xstate/01-snapshot-recursion.ts` (kept as regression) |
| **Engine SDK exports** | 🟡 PARTIAL | See §8 inline markers |
| **Engine dispatchers (§8.4 convention)** | ✅ DONE | `runCommand` + `commandActorLogic` + `commandActor` (idem agent + humanReview); §8.4 |
| **harnyActions effect actions** | 🟡 PARTIAL | `commit/resetTree/cleanUntracked` ✅; `advanceTask/bumpAttempts/stashValidator/stashDevSession` still stubs (Epic D) |
| **defineWorkflow** | 🟡 PARTIAL | Validates + frozen output ✅; full strict generics (D1) ⏳ |
| **runPhaseAdapter (engine ↔ sessionRecorder)** | ✅ DONE | `src/harness/engine/runtime/runPhaseAdapter.ts`, DI seam |
| **First end-to-end engine workflow** | ✅ DONE | `echoCommit.ts` — defineWorkflow + commandActor + commit, probe 06 |
| **Engine wired to orchestrator** | 🚧 IN FLIGHT | Epic A (`wire-engine-orchestrator`) running; routes by `WorkflowDefinition.machine` shape |
| **`auto.ts` boundary workflow** | ❌ NOT STARTED | Phase 1 item per §12; Epic A is a precursor (direct routing without auto.ts boundary yet) |
| **Router (§5)** | ❌ NOT STARTED | Lives inside `auto.ts:routing`, gated on auto.ts |
| **state.json v2 schema** (`features`, `workflow_chosen`, `human_review` events) | ❌ NOT STARTED | Phase 1 item per §9.2 |
| **humanReview production parking** (state.json:pending_question + resume) | ❌ NOT STARTED | Phase 3 in §12; current humanReviewActor uses DI provider only |
| **L1 prompt overlays + variants** (§10.1) | ❌ NOT STARTED | Phase 2 |
| **`.extend()` for L3** (§10.2) | ❌ NOT STARTED | Phase 2 |
| **Stately Studio integration** | ⏭️ DEFERRED | Phase 4 |
| **meta-improve post-node** | ⏭️ DEFERRED | Phase 5 |

**Infrastructure improvements landed alongside engine work** (not in original design but proven valuable):
- `LEARNINGS.md` — architect-emitted observation log with cost reference table
- `.claude/skills/review-run/` — skill that runs post-mortem on harny runs (8-step bottom-up review with parallel sub-agents per phase)
- `RELEASE.md` — methodology + Rule 4 (merge after each run) + step 6.5 (counterfactual test for promoting findings to durable infra)
- `src/harness/coldInstall.ts` + `harny.json:coldWorktreeInstall` — auto bun install on cold worktrees (L4 permanent fix)
- `assertNoSiblingBranchOwnsTouchedPaths` in `src/harness/git.ts` + orchestrator wiring + `harny.json:siblingBranchGuard` — mechanical L6 fix
- `composeCommitMessage` helper — L1 (dup `task=N` trailer) permanent fix
- `harny show <runId> --tail [--since=<dur>]` — live transcript viewer (CLI)
- Viewer "Sibling branches" panel — visual safety net for L6 (with `^(harny|harness)/` filter + O(S) git query)
- Folder-scoped CLAUDE.md pattern — top-level pointer + `src/harness/engine/CLAUDE.md` for subtree-specific conventions
- Planner short-circuit on high-spec prompts — `featureDev/defaults.ts` PLANNER_PROMPT additions

**Remaining for v0.2.0 to be USABLE** (engine actually substituting legacy in production):
1. **Epic A** — wire `WorkflowDefinition.machine` → orchestrator routing (in flight)
2. **Epic D** — implement remaining `harnyActions` XState assigns (advanceTask/bumpAttempts/stash*)
3. **Epic B** — port `feature-dev` to engine as `feature-dev` machine using harnyActions

**For full v0.2.0 per §12 Phase 1:** also need auto.ts + router + state.json v2 schema + humanReview real parking + delete legacy workflows. ~6-10 more harness runs after A/D/B.

---

## 1. The pain

Today's `Workflow.run(ctx)` is unconstrained TS code per workflow. It works, but blocks where harny actually wants to go:

1. **Workflow authoring is locked to harny contributors.** Projects can't ship their own workflow shape without forking the repo.
2. **Workflows are not introspectable.** A future meta-agent that observes runs and proposes setup improvements needs structured workflow definitions to reason about — not arbitrary loops.
3. **Three workflow shapes are already squeezed into one free-form interface.** Future shapes the user explicitly wants (planner-with-approval, dev+lint+validator, dev-only-with-end-gate) become bespoke TS each time.
4. **No lifecycle conventions.** Cleanup, routing, telemetry, meta-loop triggering — all hard-coded in the orchestrator with no extension points.
5. **Reinvention everywhere.** Iteration, retry budgets, signal routing, parking — solved-problems libraries already cover these.
6. **The actual moat is the meta-learning loop**, not the orchestrator. Time spent polishing our own workflow interpreter is time not spent on the meta-agent.

---

## 2. The vision

**Harny is a self-improving development system.** Workflows are necessary infrastructure, not the product. The product is the meta-loop:

1. Run a workflow with prompt X. Capture transcripts, history, **humanReview events with ML features attached**.
2. Read the run. Form hypothesis: "validator forced reset 3× because dev didn't have context Y; missing prompt about Y, or missing tool Z, or missing skill in `.claude/`."
3. Apply the change (edit prompt, add tool, write doc, install lint).
4. Rerun the same prompt. If converges better → commit the change. If not → next hypothesis.
5. Repeat until convergence — autonomous improvement of the dev environment.

The engine choices below are made to **maximize the meta-agent's leverage**: workflows must be structured enough to mutate, runs must capture enough context to slice analytics, humanReview events must be rich enough to detect patterns.

**Critical insight: meta-agent learns by SLICING, not by aggregating.** "% refine on checkpoint X" is a useless number globally. Sliced by features (Python vs TS repo, big feature vs bug fix, simple scope vs cross-cutting), the same data exposes actionable patterns. **Every run captures structured features upfront so every event can be analyzed against them.**

### 2.1 Supreme design principle: humans don't touch code

The intended user is **a senior dev OR another developer's AI agent** — neither of whom should be hand-editing TS to customize harny's behavior. **Customization happens through file conventions (markdown overlays, named variants), not code edits.**

This principle reorders every downstream decision:
- **TS files** (workflow shape definitions) become write-once-by-meta-agent artifacts. Humans review them in PRs, don't edit them daily.
- **Markdown files** (prompts) are the daily editable surface — for both human and meta-agent.
- **Viewer** is the human's primary interface (read-only inspection of runs, configs, traces).
- **Every design choice** asks: "does this make it easier for the meta-agent to mutate setup safely?"

The §10 customization model (3 layers) is a direct consequence of this principle.

---

## 3. Engine choice: XState v5

After researching alternatives (LangGraph.js, Mastra, Inngest, Pydantic AI, Effect-TS, Genkit, VoltAgent, BAML, custom interpreter):

| | LangGraph.js | XState v5 | Custom |
|---|---|---|---|
| Footprint | 12 MB + LangChain runtime coupling | **2.3 MB, 0 deps** | 0 deps, ~300-500 LOC ours |
| LLM coupling | Forces `Runnable`/`BaseMessage` everywhere | None | None |
| Iteration sequencial | Self-loop with cursor (recursionLimit footgun) | Hierarchical states with `always` transitions | Whatever we write |
| Pause/resume | Pluggable checkpointer (heavy semantics) | `getPersistedSnapshot()` / `createActor({snapshot})` | Whatever we write |
| Sub-workflows (actor-of-actor) | Subgraphs (extra concept) | **Native via `invoke: { src: childMachine }`** | Whatever we write |
| Visualizer | LangSmith (cloud) | **Stately Studio** (free, public or local) | Build ourselves |
| Maturity | Active, but coupled to LangChain | 8+ years, production-tested everywhere | Day 0 |
| Type safety | Reasonable | **End-to-end via `setup()` — types enforce action names, guard names, actor names** | Whatever we build |

XState wins because it gives us LangGraph-class primitives without the LangChain ecosystem weight, and it's the only mature option that's truly LLM-agnostic and lightweight enough for a CLI install.

The verbosity cost (XState files are 100-200 lines vs. a hypothetical YAML's 60) is real but acceptable: combated by a good viewer (Stately Studio integration) and by harny itself helping the user author workflows via the meta-agent over time.

---

## 4. Architecture: boundary workflow + leaf workflows

The biggest structural decision in v3. Every harny invocation runs through a **boundary workflow** (`auto.ts`) that wraps the **leaf workflow** the user actually wants.

### 4.1 The pattern

```
[harny CLI invocation]
  │
  ▼
auto.ts (boundary)
  ├── routing            ← pre-node: router agent (or skip if --workflow given)
  ├── invokeWorkflow     ← state that invokes the leaf workflow as XState sub-actor
  └── finalize           ← post-nodes: cleanup, telemetry, meta-loop trigger, etc.
  │
  ▼
[CLI exits]
```

`auto.ts` is itself a normal harny workflow. It uses XState v5's actor-of-actor primitive (`invoke: { src: chosenLeafMachine }`) to run the leaf workflow as a child whose state is independent of the parent.

**Why a boundary workflow instead of declarative lifecycle hooks (`harny.json: { lifecycle: { pre, post } }`)?**

A declarative hooks system would be a NEW concept with limited capabilities. A boundary workflow IS a workflow — it gets every primitive for free (signals, retry, parking, humanReview, observability, type safety, snapshot/restore). Pre and post are just states. Author who wants to add a step adds a state.

### 4.2 Pre-nodes (run before the leaf)

Common pre-nodes the built-in `auto.ts` will ship:
- **Router** — picks the leaf workflow (see §5).
- **Setup verifier** — already in orchestrator today (git clean, etc.); could move into `auto.ts` as a state, but **out of MVP**: orchestrator keeps doing git/branch/worktree setup AROUND `auto.ts` for now.

Pre-nodes a project might add:
- **Cost estimator** — LLM reads prompt + estimates token spend. If above threshold, parks as humanReview ("this looks expensive, approve?").
- **Custom feature extractor** — repo inspection beyond what the router does (test coverage, recent activity, etc.).
- **Pre-flight check** — runs project-specific lint/test before the leaf even starts.

### 4.3 Post-nodes (run after the leaf finishes)

The killer use case is **`meta-improve` as a post-node**. After every leaf workflow completes, `auto.ts` triggers (synchronously or async) a meta-improve workflow that reads the just-finished run + proposes setup improvements + opens a PR. **Self-improving system with plumbing already existing.**

Other common post-nodes:
- **Cleanup** — `git worktree remove`, normalize state. Today hard-coded in orchestrator.
- **Telemetry / webhook** — push run summary to dashboard or Slack.
- **Auto-clean state.json** after N hours in "done".
- **Notification** — "your run is done".

### 4.4 Failure semantics (critical)

| Position | If it throws | Why |
|---|---|---|
| **Pre-node (router)** | Graceful degradation — fall back to default workflow + log warning. | Failing the run because routing failed is over-strict; user wanted to do work. |
| **Pre-node (setup verifier)** | ABORT before leaf runs. | Setup violations are real — proceeding makes it worse. |
| **Leaf workflow** | Standard run failure (status: failed). | Authoritative. |
| **Post-node** | Warning only. Run status stays as the leaf's outcome. | Post-nodes are advisory; cleanup/telemetry failure shouldn't undo a successful leaf. |

To make post-nodes consistently advisory, harny SDK introduces a flag on actor wrappers:

```ts
commandActor({ cmd: ["bun", "run", "post-hook"], advisory: true })
```

When `advisory: true`, the actor's `onError` is internally caught, logged to history, and `onDone` is fired with a warning payload. The state machine continues.

✅ **DECIDED — `auto.ts` cleanup-on-failure: hybrid (graph + safety net).** When the leaf workflow terminates (any outcome other than `waiting_human`), cleanup runs via TWO complementary mechanisms:

- **Primary path:** `auto.ts` has a `finalize` hierarchical state with `cleanup → telemetry → done` children. Both leaf `onDone` and `onError` transition to `finalize`, so the graph models cleanup explicitly. Visible in viewer, customizable per workflow (add Slack notification, custom telemetry, etc.), observable by meta-agent (timing, failures).
- **Safety net:** runtime wraps the boundary actor in `try/finally`. The finally block re-invokes the same `cleanupActor` (idempotent — checks `if (worktreeExists) removeWorktree()`), so if XState misbehaves or the process is interrupted, cleanup still happens.

Cleanup actor is **idempotent by contract** — running it twice is safe. This is the foundation for the hybrid model.

### 4.5 CLI semantics

- `harny "..."` — runs `auto.ts` with no `--workflow`, router decides BOTH leaf workflow AND prompt variant.
- `harny --workflow X "..."` — workflow is forced to X; router still decides variant.
- `harny --workflow X:variantName "..."` — both workflow and variant explicit; router skipped entirely. Colon syntax (e.g., `feature-dev:just-bugs`).
- `harny --input '{"features": {...}}' "..."` — features pre-supplied; router can use them or skip classification.
- `harny --feature key.path=value "..."` — repeatable shorthand for setting individual features. Dot notation for nested paths. Example: `harny --feature request.type=bugfix --feature repo.language=python "fix login crash"`.

`auto.ts` is **always** the entry point. There is no "bypass auto" mode. This keeps lifecycle uniform. See §10 for variant semantics.

### 4.6 Project override of `auto.ts`

`<cwd>/.harny/workflows/auto.ts` overrides the built-in. Most projects won't touch it. Those that do (custom telemetry, custom routing logic, custom pre-flight) follow the standard plugin convention.

---

## 5. The router

### 5.1 Shape

A single agent node that runs as the first state of `auto.ts`'s `routing` phase. Receives:
- The user's free-text prompt.
- The list of available workflows + their variants (built-in + project-shipped) with brief descriptions.
- A repo snapshot (basic features: language, package files present, etc.).

Emits structured output:
```ts
{
  workflow_id: string;          // chosen leaf workflow
  variant: string;              // chosen prompt variant (defaults to "default" if no specific variant fits)
  features: { ... };            // populated where it can; nullable per field
  rationale: string;            // for the meta-agent later
  confidence: "high" | "medium" | "low";
}
```

LLM-only at MVP. Heuristic optimization deferred until measured benefit.

The variant choice is the most powerful router output: same workflow shape, different prompts tuned for different request types. See §10 for the variant pattern.

### 5.2 When the router can't decide

Confidence "low" → router parks as **`humanReviewActor`** asking "I'm not sure which workflow fits — pick one:" with options being the available workflow ids.

This is intentional: **a router that says "I don't know" is the FIRST humanReview the meta-agent should learn from.** Pattern detection: "router hesitates on prompts containing X → improve router prompt to recognize X."

### 5.3 Bypassing the router

- `--workflow X` flag → router state immediately picks X without invoking the agent. Features still get extracted by whatever follows (if anything).
- `--input '{...}'` features can be supplied → router can use them as starting hints.

### 5.4 Router as a normal workflow node

The router is just an `agentActor` with a specific prompt + output schema. No new primitive. Lives in `src/harness/workflows/auto/router.md` (prompt) + a small Zod schema. Project-overrideable via the file convention (the router prompt is itself a `.md` file under `.harny/prompts/auto/default/router.md` — meta-agent can improve it like any other prompt).

> ⚠️ **OPEN — router output schema details:** the shape sketched in §5.1 (`{workflow_id, variant, features, rationale, confidence}`) needs final Zod definition. Specifically: `features` is `Record<string, unknown>` free-form (we can't know all features in advance, the schema in §6.1 is a suggestion). Final Zod definition during Phase 1 SDK work.

---

## 6. ML features per run

`state.json:origin.features` carries structured features captured at run start. Every history event can be sliced by these.

### 6.1 Schema sketch

```jsonc
{
  "origin": {
    "prompt": "build me a calculator",
    "started_at": "...",
    "host": "...",
    "user": "...",
    "workflow_chosen": "feature-dev",
    "variant_chosen": "default",            // NEW: which prompt variant the router selected
    "workflow_file_hash": "sha256:...",     // for correlating analytics across workflow versions
    "features": {
      "repo": {
        "language": "python",
        "loc": 1200,
        "test_infra": "pytest",
        "package_manager": "uv",
        "has_ci": true
      },
      "request": {
        "type": "feature",                  // feature | bugfix | refactor | doc | exploration
        "scope": "single_file",             // single_file | cross_cutting | architectural
        "ambiguity": "low",                 // low | medium | high
        "estimated_complexity": "small"     // small | medium | large
      },
      "router": {
        "confidence": "high",
        "rationale": "..."
      }
    }
  }
}
```

### 6.2 How features get populated

**Required:** `workflow_chosen`, `workflow_file_hash`. Always set by the runtime.

**Optional:** everything under `features`. Multiple sources contribute, with explicit precedence:

1. **Router extraction** (lowest priority) — the LLM's classification fills what it can detect from prompt + repo inspection. This is the base layer.
2. **`--input '{"features": {...}}'` JSON** (medium priority) — user supplies a structured object; deep-merges over router output.
3. **`--feature key.path=value` CLI flags** (highest priority) — repeatable shorthand for individual fields; merges last and wins on conflict.

```sh
# Pure router-driven
harny "fix the login bug"

# Force one feature, let router fill the rest
harny --feature request.type=bugfix "fix the login bug"

# Pre-supply a chunk
harny --input '{"features":{"request":{"type":"bugfix","scope":"single_file"}}}' "fix login bug"

# CLI flags win over --input
harny --input '{"features":{"request":{"type":"feature"}}}' \
      --feature request.type=bugfix "fix login bug"
# → final: request.type = "bugfix"
```

**Validation is intentionally loose.** Feature keys/values are free-form strings (CLI flags don't coerce types — `loc=1200` is the string `"1200"`, not the number). The meta-agent learns from whatever features exist, including ones we didn't anticipate. A schema reference exists in docs (§6.1) for common conventions but isn't enforced.

**Not forced.** A workflow without any extractor and no CLI flags still works — `features` is mostly empty. The meta-agent has less to slice on, but nothing breaks.

### 6.3 What the meta-agent does with features

Slice every aggregation:
- "% refine on `feature-dev:planning.review` **where features.request.scope = single_file**" → 5%
- "% refine on `feature-dev:planning.review` **where features.request.scope = cross_cutting**" → 75%
- "Avg validator resets **where features.repo.language = python**" → 1.2
- "Avg validator resets **where features.repo.language = typescript**" → 0.3

Differences across slices are the actionable signals.

### 6.4 Workflow file hash

`workflow_file_hash` is SHA256 of the workflow's `.ts` file at run time. When user edits the planner prompt, hash changes. Meta-agent groups runs by `(workflow_id, workflow_file_hash)` to correlate "this checkpoint's behavior changed when I changed the workflow on date X".

This replaces the per-event `message_hash` idea from earlier drafts. State path identifies the checkpoint structurally; `workflow_file_hash` identifies the workflow version. Together they give all the grouping power needed.

---

## 7. humanReview — the most important primitive

Quote that anchored the design: **"humanReview is the moment the agent has to raise its hand for help. Knowing it asked for help and someone had to answer is where all the learning of this system lives."**

This means: **don't optimize for fewer reviews.** Optimize for cheap-to-author reviews and rich data capture per review. Reduction is the meta-loop's job.

### 7.1 Two interruption sources, one snapshot infra

Both pause types coexist in the same workflow run:

| Type | Origin | Captured via |
|---|---|---|
| **Agent-level** (`AskUserQuestion` tool, mid-phase) | Agent decides dynamically it needs to ask | SDK session_id + tool_use_id + question batch |
| **Workflow-level** (`humanReviewActor`, between states) | Author placed deliberate checkpoint | XState snapshot + message + options |

Both write `state.json:workflow_state.xstate_snapshot` on park. `pending_question.kind` discriminates how to inject the answer:

- `agent_ask_user_batch` → resume re-invokes phase via `runPhase` with `resumeSessionId` + new user message.
- `workflow_human_review` → loader restores XState snapshot, re-invokes the parked `humanReviewActor` with `previousAnswer` input — it resolves immediately, machine continues.

**Taxonomically separate in metadata** because they signal different things to the meta-agent:
- Agent-level = "agent didn't have enough context → improve prompt/tool/doc upstream."
- Workflow-level = "author designed checkpoint → if always approved, remove; if always refined, fix what comes before."

### 7.2 API (intentionally minimal)

```ts
humanReviewActor({
  // Just a string. Author composes everything: context, files to look at,
  // commands to run, what to decide.
  message: ({ context }) => `
Plan draft from this run:

${formatPlan(context.draft)}

Things to verify before approving:
- Open src/runner.ts and check the flag added in t1
- Run: bun run typecheck

Decide:
  `,
  
  // Optional. If omitted, free-text answer required.
  options: [
    { value: "approve", label: "Looks good" },
    { value: "refine",  label: "Send back with feedback", needsText: true },
  ],
})
```

Output: `{ value: string, text?: string }`. No `show + render` separation, no custom output schema, no payload introspection. Author writes a clear string, gets a minimal answer.

Multi-question is **agent-level only** (via existing `AskUserQuestion` tool, 1-4 per batch). `humanReviewActor` is 1-decision-per-invocation — multiple decision points = multiple `humanReviewActor` invocations at different states. The meta-agent learns from each one independently.

### 7.3 Three modes (consistent with existing `RunMode`)

| Mode | Behavior |
|---|---|
| `interactive` | TTY readline. Render message → list options → read answer → validate. Loop until valid. |
| `silent` | Throws `SilentModeError` immediately. Workflow shouldn't have reached here in CI. |
| `async` | Persist `pending_question` + XState snapshot in state.json. Set `lifecycle.status = waiting_human`. Exit cleanly. |

### 7.4 Resume UX

`harny show <runId>` for a parked review prints the message + ready-to-paste commands:

```
$ harny show abc12345

[planning.review — workflow_human_review]

Plan draft from this run:
...

Things to verify before approving:
- Open src/runner.ts and check the flag added in t1
- Run: bun run typecheck

Decide:

To answer:
  harny answer abc12345 approve
  harny answer abc12345 --json '{"value":"refine","text":"add tests for X"}'
```

Copy-paste workflow. Viewer-driven approve UI is post-MVP.

### 7.5 Per-review event in history

Each humanReview (both levels) emits a structured history event:

```jsonc
{
  "at": "...",
  "kind": "human_review",
  "level": "agent" | "workflow",
  "state_path": "planning.review",         // for workflow level
  "phase_name": "planner",                  // for agent level
  "message": "...",                         // raw text shown to human
  "options_offered": [{ "value": "...", "label": "...", "needsText": true }],
  "answer": { "value": "refine", "text": "..." },
  "context_snapshot": { /* small relevant fields from XState context */ }
}
```

Combined with `state.json:origin.features` (per-run) and `workflow_file_hash`, the meta-agent has every dimension it needs to slice analytics.

---

## 8. harny SDK (what authors import)

```ts
import {
  defineWorkflow,        // ✅ DONE — validates id + machine, returns frozen WorkflowDefinition. Strict generics (D1) ⏳ pending.
  agentActor,            // ✅ DONE — fromPromise wrapping runAgent (DI runPhase callback); production wiring via runPhaseAdapter
  commandActor,          // ✅ DONE — fromPromise factory; runCommand is the canonical async fn (§8.4)
  humanReviewActor,      // 🟡 PARTIAL — DI askProvider works in probes; production parking via state.json:pending_question NOT yet
  harnyActions,          // 🟡 PARTIAL — commit/resetTree/cleanUntracked ✅; advanceTask/bumpAttempts/stashValidator/stashDevSession still throw stubs (Epic D)
  commandActorLogic,     // ✅ DONE — actor logic for setup({ actors }) composition
  agentActorLogic,       // ✅ DONE — idem
  humanReviewActorLogic, // ✅ DONE — idem
  commitLogic,           // ✅ DONE — fromPromise wrapper around gitCommit
  resetTreeLogic,        // ✅ DONE — idem
  cleanUntrackedLogic,   // ✅ DONE — idem
  // re-exports from xstate for convenience:
  setup, assign, fromPromise,
} from "@lfnovo/harny";
```

### 8.1 `defineWorkflow` is strict (compile-time enforcement)

User decision: "falhar em compile é muito mais aderente à filosofia de harness." `defineWorkflow` types are strict — invalid action references, missing required machine structure, undeclared actor names all fail at TS compile. Runtime errors are reserved for things types can't catch (file not found, schema mismatch with external input).

> ⚠️ **OPEN — exact TS signature of `defineWorkflow`:** strictness is decided as principle, but the precise type generics (how to enforce that `actions` referenced in `createMachine()` exist in `setup({ actions })`, how to enforce `final` states for terminal cases, how to type the `extend()` method from §10.1) is hands-on design during Phase 1 SDK work. Likely involves XState's own type inference + our wrapper generics.

### 8.2 `harnyActions` — effect actions via `provide()` pattern

Effect actions (`commit`, `resetTree`, `cleanUntracked`, `advanceTask`, etc.) need access to `WorkflowContext` (git, worktree). They're declared as **placeholders in `harnyActions`** and overridden by the runtime at instantiation time via `machine.provide({ actions: ... })`.

```ts
import { harnyActions } from "@lfnovo/harny";

defineWorkflow({
  id: "feature-dev",
  machine: setup({
    actions: {
      ...harnyActions,                    // ← spreads placeholders for commit/resetTree/etc
      setPlan: assign({...}),             // author's pure assigns
      bumpAttempts: assign({...}),
    },
    // ...
  }).createMachine({
    states: {
      validator: {
        invoke: {
          src: "validator",
          onDone: [{
            guard: ({event}) => event.output.verdict === "pass",
            target: "next",
            actions: ["commit", "advanceTask"],   // ← TS validates these names
          }],
        },
      },
    },
  }),
});
```

**Why `harnyActions` spread instead of `@harny/*` namespace strings:**
- Standard XState idiom (provide pattern is documented).
- TS autocomplete works (typo `"comit"` fails compile).
- Override trivial: `{...harnyActions, commit: customCommit}`.
- One-line cost in `setup()` is negligible.

Runtime substitution:
```ts
const actor = createActor(
  workflow.machine.provide({
    actions: {
      commit: () => ctx.commit(...),
      resetTree: () => ctx.resetHard(...),
      // ...
    },
  }),
);
```

**Registry implementation = a plain object literal exported from the SDK.** No registration mechanism, no plugin layer, no runtime lookup. Adding a new action = adding a key:

```ts
// in @lfnovo/harny SDK
export const harnyActions = {
  commit:         () => { throw new Error("harny runtime not provided") },
  resetTree:      () => { throw new Error("harny runtime not provided") },
  cleanUntracked: () => { throw new Error("harny runtime not provided") },
  advanceTask:    assign({ currentTaskIdx: ({context}) => context.currentTaskIdx + 1 }),
  bumpAttempts:   assign({ attempts: ({context}) => context.attempts + 1 }),
  // ... grow as needed
};
```

Two categories of entries:
- **Effect actions** (need `WorkflowContext`): placeholder that throws. Runtime overrides via `provide()`. Examples: `commit`, `resetTree`, `cleanUntracked`.
- **Pure-state actions** (just XState assigns): the placeholder IS the implementation. Examples: `advanceTask`, `bumpAttempts`, `bumpResets`.

> ⚠️ **OPEN — canonical list evolves with use:** start with what feature-dev actually needs (`commit`, `resetTree`, `cleanUntracked`, `advanceTask`, `bumpAttempts`, `stashValidator`, `stashDevSession`). Add as new workflow shapes surface needs. No big-design-up-front for the registry — it grows organically. Document new entries in CHANGELOG when added.

### 8.3 Default `onError` per actor

`agentActor`, `commandActor`, `humanReviewActor` all ship with a default `onError` that routes to `#failed` and logs the infra error. Author overrides only when custom recovery is needed.

```ts
validator: {
  invoke: {
    src: "validator",
    onDone: [...],
    // onError not declared → harny default applies: { target: "#failed", actions: "@harny/recordInfraError" }
  },
},
```

Domain failures (e.g., `verdict.status === "blocked"`) come through `onDone` and are guard-routed by the author explicitly.

### 8.4 Dispatcher convention

Every engine dispatcher must export two surfaces:

1. **A plain async function** `fn(opts, signal: AbortSignal)` — the canonical implementation and the testing surface for probes.
2. **A thin `fromPromise(fn)` actor wrapper** — the XState integration adapter.

Example (`commandActor`):
```ts
// Plain async — canonical implementation, probe surface
export async function runCommand(opts: CommandOpts, signal: AbortSignal): Promise<CommandResult> { ... }

// Actor logic — for setup({ actors }) composition in workflows
export const commandActorLogic = fromPromise<CommandResult, CommandOpts>(
  ({ input, signal }) => runCommand(input, signal)
);

// Factory — for direct createActor / probe use
export function commandActor(options: CommandOpts) {
  return fromPromise<CommandResult, CommandOpts>(({ signal }) => runCommand(options, signal));
}
```

For workflow composition: `setup({ actors: { commandActor: commandActorLogic } })`. For direct invocation in tests/probes: `createActor(commandActor({ cmd: ["echo", "hi"] }))`.

**Rationale:** XState's `fromPromise` routes abort and timeout rejections through `observer.error()`. Plain `.subscribe(nextCb)` subscribers never receive these — the rejection is invisible at the subscriber level. As a result, probes that need to exercise abort/timeout paths **must call the plain async function directly** with an `AbortController`, not via `createActor(commandActor) + .stop()`. Without this convention, abort and timeout failures are effectively untestable from outside XState.

This convention applies to all dispatchers: `commandActor`, `agentActor`, `humanReviewActor`, and any future dispatcher added to `src/harness/engine/dispatchers/`. Each dispatcher file carries a one-line top-of-file comment referencing this section.

When implementing a new dispatcher OR a new probe, read the two most recent siblings (under `src/harness/engine/dispatchers/` and `scripts/probes/engine/0N-*.ts` respectively) as templates — convention propagates by mimicry. Probes should follow the shape of the highest-numbered existing probe in their directory.

---

## 9. Engine runtime + persistence

### 9.1 Runtime

- Loads workflow module via dynamic `import()`. Resolution: `<cwd>/.harny/workflows/<id>.ts` first, fallback to built-in `src/harness/workflows/<id>/<id>.ts`.
- Always loads `auto.ts` first, then resolves the leaf workflow either from the router's output or from `--workflow X`.
- Instantiates XState actor with `provide({ actions: {...} })` — effect implementations come from `WorkflowContext`.
- Subscribes to actor's `inspect` to mirror state transitions into `state.json:phases[]` + `history[]`.
- Wraps the run in a Phoenix span (`withRunSpan`) — all actor invocations inherit the trace context.
- Captures `actor.getPersistedSnapshot()` on park signal; writes to `state.json:workflow_state.xstate_snapshot`. Snapshot includes child actor states recursively (✅ confirmed by Phase 0 probe — see §14 P1).

The current orchestrator's git/branch/worktree setup, idempotent rerun, and Phoenix wiring stay intact for MVP. Only the per-workflow loop is replaced with `runYamlWorkflow` → `runXStateWorkflow(autoMachine, ctx)`.

### 9.1.1 Actor idempotency requirement (critical, from P1 finding)

**XState v5 restarts `fromPromise` actors on snapshot restore — it does not resume mid-promise.** The probe (§14 P1) confirmed this empirically: a `fromPromise` 200ms into a 1000ms call, when snapshotted and restored, re-invokes from `t=0`.

For harny, the implication is concrete: actors that wrap expensive operations (SDK calls, shell commands) **must** be idempotent OR session-resumable on re-invoke. Implementation pattern:

**`agentActor` wrapper:**
```ts
const developerActor = fromPromise(async ({ input, signal }) => {
  // Read state.json for prior session of this phase
  const prior = await store.getLatestPhaseSession(input.phase);
  return runPhase({
    ...input,
    resumeSessionId: prior?.sessionId,   // SDK resumes session if available
    signal,                              // AbortSignal threading (mandatory)
  });
});
```

On re-invoke after restore, the SDK picks up the prior session and processes only the new user message (e.g., the answer from a parked `AskUserQuestion`). No token re-burn, no work redo.

**`commandActor` wrapper:** most commands are naturally idempotent (lint, test, build re-run safely). For commands with side effects (deploy, publish), authors must declare `idempotent: false` and the runtime refuses to invoke them after restore — instead routes to a recovery state.

**`humanReviewActor` wrapper:** on re-invoke with `previousAnswer` input, resolves immediately. No special handling needed — the design already accounts for this.

**`AbortSignal` threading is mandatory** for ALL actors. Without it, `actor.stop()` leaves the underlying SDK call / shell process running, burning resources after a snapshot+restart. XState's `fromPromise` provides `signal` in its callback — pass it through to the SDK / `Bun.spawn`.

### 9.1.2 What snapshots actually capture

| Captured ✅ | Not captured ❌ |
|---|---|
| Recursive `value` (state) for parent + all children | In-flight promises (the function is re-invoked) |
| Recursive `context` for parent + all children | External I/O state (open file handles, sockets) |
| Pending invocations (with `src` name) | The actual JS Promise object |
| Spawned actor IDs (auto-generated from state path) | Anything in module-level closures |

The auto-generated spawn IDs (e.g., `"0.grandchild.fetching"`) leak from state path. **Implication**: renaming a workflow's states across versions invalidates old snapshots. This is acceptable because `state.json:schema_version` already refuses incompatible runs and `workflow_file_hash` (per-run) makes it traceable. Document the rule: "renaming workflow states is a breaking change for in-flight runs."

### 9.2 Persistence (state.json schema additions)

```jsonc
{
  "schema_version": 2,                // bumped from 1; loader refuses to resume v1 runs
  "run_id": "...",
  "origin": {
    "prompt": "...",
    "workflow_chosen": "feature-dev",       // NEW
    "workflow_file_hash": "sha256:...",     // NEW
    "features": { /* see §6.1 */ }          // NEW
  },
  "lifecycle": { /* unchanged */ },
  "phases": [ /* unchanged shape; emitted from XState inspect */ ],
  "history": [
    // existing event types +
    {
      "at": "...",
      "kind": "human_review",
      "level": "agent" | "workflow",
      "state_path": "...",
      "message": "...",
      "options_offered": [...],
      "answer": {...},
      "context_snapshot": {...}
    }
  ],
  "pending_question": {
    "id": "...",
    "kind": "agent_ask_user_batch" | "workflow_human_review",   // NEW: discriminator
    // for workflow_human_review:
    "message": "...",
    "options": [...]
    // for agent_ask_user_batch (existing):
    // questions, phase_session_id, tool_use_id, phase_name
  },
  "workflow_state": {
    "xstate_snapshot": null | { /* XState v5 persisted snapshot, recursive */ }
  },
  "phoenix": { /* unchanged */ }
}
```

### 9.3 Resume routing

`harny answer <runId>` reads `pending_question.kind` and routes:

- `agent_ask_user_batch` → existing path (re-invokes phase via `runPhase` with `resumeSessionId`).
- `workflow_human_review` → loads workflow module(s), restores XState snapshot via `createActor(machine, { snapshot })`, re-invokes the parked `humanReviewActor` with `input: { previousAnswer }` — actor resolves immediately, machine continues.

---

## 10. Customization model — 3 layers

Customization is layered by frequency-of-use and minimum-cognitive-load. **Pick the lightest tool that fits:**

| Layer | Mechanism | What it changes | Who edits |
|---|---|---|---|
| **L1 — Prompts** | `.md` file convention with **variants** | The text of a phase prompt | Human OR meta-agent (most common change) |
| **L2 — Per-actor config** | (DEFERRED — not in MVP) | model, effort, maxTurns | — |
| **L3 — Workflow shape** | TS file via `.extend()` or full re-export | New nodes, topology, tool whitelists, actor swaps | Human OR meta-agent (rare) |

L2 is intentionally absent from MVP — see §10.4. Practical experience will tell us if/when JSON config is worth adding.

### 10.1 Layer 1 — Prompts via file convention (with variants)

The dominant mechanism. Zero TS, zero JSON, just markdown files in a conventional location.

```
<cwd>/.harny/prompts/
└── feature-dev/
    ├── default/                 ← THE variant when none specified
    │   ├── planner.md
    │   ├── developer.md
    │   ├── developer-resume.md
    │   └── validator.md
    ├── just-bugs/               ← variant for bug-fix-shaped requests
    │   ├── planner.md           ← override: enxuto, foco em causa-raiz
    │   └── developer.md         ← override: idem
    │   # validator.md absent → falls back to default/validator.md
    └── python-projects/         ← variant for Python repos
        ├── planner.md           ← override: knows uv/pytest conventions
        └── developer.md
```

**Resolution chain for any prompt request `(workflow_id, variant, actor)`:**

1. `<cwd>/.harny/prompts/<workflow_id>/<variant>/<actor>.md` — project override for this variant
2. `<cwd>/.harny/prompts/<workflow_id>/default/<actor>.md` — project override for default variant (variant inheritance)
3. Built-in workflow's bundled `prompts/<variant>/<actor>.md`
4. Built-in workflow's bundled `prompts/default/<actor>.md`

**Always REPLACE semantics, never append.** If meta-agent wants "base + addendum", it reads the base + writes the full composed file. One mode, no merge surprises.

**CLI selection:**
- `harny "..."` → router decides variant.
- `harny --workflow feature-dev "..."` → router still decides variant (workflow forced, variant free).
- `harny --workflow feature-dev:just-bugs "..."` → both forced; router skipped.

**Variants tie back to the meta-agent in a powerful way:** the meta-agent can detect "Python repos always need different planner prompt" → automatically create `python-projects/` variant + train the router to recognize Python → A/B confirm → commit. **A growing library of variants per workflow IS the core learning artifact of harny.**

### 10.2 Layer 3 — Workflow shape via TS

For non-prompt changes (new actors, topology changes, tool whitelists, model/effort overrides until L2 lands), edit a TS file.

```
<cwd>/.harny/workflows/
├── auto.ts                  # optional override of boundary workflow
├── feature-dev.ts           # extends or fully overrides built-in leaf
└── ship-it-fast.ts          # new project-specific leaf
```

Two ways to author:

**Full re-export (for fundamentally different shape):**
```ts
import { defineWorkflow, agentActor, harnyActions } from "@lfnovo/harny";

export default defineWorkflow({
  id: "ship-it-fast",
  needsBranch: true, needsWorktree: true,
  machine: setup({ /* completely custom */ }).createMachine({ /* ... */ }),
});
```

**`.extend()` for incremental tweaks:**
```ts
import { featureDev } from "@lfnovo/harny/workflows";

export default featureDev.extend({
  actors: {
    developer: { 
      model: "opus",                   // override model
      maxTurns: 300,
      // NOTE: do NOT set instructionsFile here — use the L1 file convention instead
    },
  },
});
```

**Important:** `.extend()` does NOT support `instructionsFile`. Prompts are owned exclusively by L1 (file convention). This is a deliberate constraint — prevents two sources of truth for the same prompt.

### 10.3 Precedence rules

When a project has BOTH a TS workflow file (`.harny/workflows/feature-dev.ts`) AND prompt overrides (`.harny/prompts/feature-dev/*/`):

- For PROMPTS: L1 file convention wins, always. L3 cannot override prompts.
- For everything else (model, tools, topology): L3 TS extend wins.
- Both layers can coexist on the same workflow without conflict.

When the resolved variant is `just-bugs` and a prompt is missing in `just-bugs/`, fall back to `default/` (variant inheritance), then to built-in. See §10.1 resolution chain.

### 10.4 Why no Layer 2 in MVP

A JSON config layer for per-actor knobs (`model`, `maxTurns`, `effort`) was considered and deferred. Reasoning:

- 90% of the meta-agent's expected edits are PROMPT changes (L1) — model/tool tweaks are rarer.
- L3 TS extend covers L2's use cases adequately, just more verbose.
- Adding L2 later is non-breaking; removing it would be breaking. Conservative path: don't add until measured need.
- **Trigger to add L2:** when meta-agent's first concrete need to A/B model selection (e.g., sonnet vs opus per phase) appears, revisit. Likely scope at that point: tiny JSON files at `.harny/config/<workflow>/<variant>/<actor>.json` containing only `{model, maxTurns, effort}`.

### 10.5 `harny init` for scaffolding (DEFERRED to Phase 2)

A `harny init` CLI command would scaffold `<cwd>/.harny/{prompts,workflows}/` with READMEs and starter files. Discoverability matters — without scaffolding, users don't know the convention exists. Out of MVP, on roadmap.

### 10.6 Hard requirements

- **Custom workflows (L3) require `bun add @lfnovo/harny` at project root.** Confirmed by Bun probe (P2 in §14): Bun does Node-style upward walk from the importing file's dir; CLI's bunx-installed copy doesn't satisfy. Runtime catches resolution failure and prints actionable error.
- **L1 prompt overrides have NO install requirement.** They're plain markdown read by the runtime — no module resolution involved.
- File watching / hot reload not required: each `harny "..."` invocation is a fresh process (Bun probe P3).

---

## 11. Workflow shape examples (silhouettes)

Four shapes already validated against the design (full XState code in chat history):

1. **`feature-dev`** — planner → loop[dev → validator] with retry-resume + retry-reset budget. Hierarchical state `loop > {developer, validator, next}`.
2. **`feature-dev` + lint** — adds `commandActor` between dev and validator. Lint-fail and val-fail share the same `attempts` counter back to dev.
3. **`feature-dev-with-approval`** — adds `humanReviewActor` for plan approval. Sub-states `planning > {draft, review, refine}` model the approve/refine loop.
4. **`feature-dev-fast`** — dev-only loop, then `endGate` with lint + tests + reviewer. No per-task validator.

All four use the same SDK (`defineWorkflow`, `agentActor`, `commandActor`, `humanReviewActor`, `harnyActions`) — no engine changes between shapes.

**Each shape can have multiple variants** via §10.1 file convention. E.g., `feature-dev:default`, `feature-dev:just-bugs`, `feature-dev:python-projects` are three variants of the SAME shape, differing only in prompts. Same XState graph, different prompt files.

`auto.ts` wraps every shape (any variant) via sub-actor invocation.

---

## 12. Implementation order

### Phase 0 — Spike ✅ DONE

Validate XState v5 fits before committing. Specifically:

- Convert `feature-dev` (Shape 1) to XState + harny SDK (`agentActor`, `harnyActions`).
- **Probe sub-actor snapshot semantics**: does `actor.getPersistedSnapshot()` capture children recursively? (XState v5 docs say yes — verify with a 2-level nested machine.)
- **Probe Bun dynamic import**: does `await import("/abs/path/to/foo.ts")` resolve `@lfnovo/harny` correctly when the file lives in `<cwd>/.harny/workflows/`?
- Wire `agentActor` to existing `runPhase`. Verify state.json still authoritative, Phoenix one-trace-per-run still works, guards still enforced.
- Run end-to-end against external test repo.
- **Decision gate:** continue with Phase 1, or pivot. If integration surprises with hidden friction, recover without dívida.

### Phase 1 — Engine foundation + `auto.ts` 🚧 IN PROGRESS

- ✅ harny SDK exports finalized: `defineWorkflow`, `agentActor`, `commandActor`, `humanReviewActor`, `harnyActions` (effect actions partial — Epic D pending).
- 🚧 Orchestrator loads and runs XState machines — Epic A in flight; routes by `WorkflowDefinition.machine` shape directly. `auto.ts` boundary NOT yet shipped.
- ❌ Built-in `auto.ts` shipped with router (LLM-only) + invoke leaf + cleanup post-node.
- ❌ state.json schema bumped to v2 (additions per §9.2).
- 🟡 `humanReviewActor` ALPHA — DI provider works in probes; interactive mode (TTY) NOT yet wired in production.
- ❌ Delete `docs.ts` and `issueTriage.ts`.
- ❌ Bump to **0.2.0** — breaking change. Schema_version refusal for older runs.

**Foundation is solid; the production-replacement work (Epic B — port feature-dev to engine, plus auto.ts + router + v2 schema) is the remaining bulk of Phase 1.**

### Phase 2 — Plugin loading + project workflows ❌ NOT STARTED

- `<cwd>/.harny/workflows/<id>.ts` resolver (including `auto.ts` override).
- `harny --workflow <id>` honors project-first lookup.
- Document the SDK contract for workflow authors.
- (Optional) `harny workflows ls`.

### Phase 3 — Async park for humanReview ❌ NOT STARTED

- XState snapshot persistence on park signal (recursive — captures child actor states).
- Restore on resume (parent + child snapshots).
- `harny answer <runId>` routes by `pending_question.kind`.
- `harny show <runId>` renders friendly review prompt + copy-paste commands.
- Rich `human_review` history events.

### Phase 4 — Stately Studio + viewer integration ⏭️ DEFERRED

- `harny ui` adds per-run graph visualization (current state highlighted, transitions traced from history).
- Workflow file → graph rendering at "load time" so authors see their workflow before running.
- Toggle "show only leaf workflow" (hide auto.ts boundary states) for cognitive load reduction.

### Phase 5 — Meta-improve as post-node ⏭️ DEFERRED

- New built-in workflow: `meta-improve.ts`.
- `auto.ts` post-node optionally triggers `meta-improve` after successful runs.
- `meta-improve` reads the just-finished run + transcripts + history → forms hypothesis → opens PR with proposed prompt/tool/doc improvement.
- Cross-run aggregation by `state_path` + `workflow_file_hash` + features slicing.
- This is the actual product moat — separate epic, but foundations laid here.

---

## 13. Decisions consolidated (resolved during design)

| # | Decision | Resolution |
|---|---|---|
| 1 | Workflow engine | XState v5 (vs LangGraph, custom, others). |
| 2 | Authoring format | TypeScript files for SHAPE; markdown files (file convention) for PROMPTS. |
| 3 | Workflow distribution | `<cwd>/.harny/workflows/<id>.ts`, project-first lookup. |
| 4 | Effect actions | `harnyActions` spread + `machine.provide()` pattern. NOT `@harny/*` namespace strings. |
| 5 | TS strictness | Strict at compile time. `defineWorkflow` types enforce structure. |
| 6 | Default `onError` | Invisible default per actor → `#failed`. Author overrides for custom recovery. |
| 7 | humanReview API | Just `message: string` + optional `options[]`. No `show + render` separation. |
| 8 | humanReview multi-question | Workflow level: 1 decision per invocation. Multi-question is agent-level (existing tool). |
| 9 | Per-review identifier | `state_path` (structural) + `workflow_file_hash` + `variant_chosen` per run. NO `message_hash`. |
| 10 | Backwards compatibility | None. 0.2.0 breaking. Schema_version refuses v1 runs. |
| 11 | Bun dynamic import | Project must `bun add @lfnovo/harny` for L3 (workflow TS files). L1 prompts have no install requirement. Confirmed by P2 probe. |
| 12 | Built-in workflows | Just `feature-dev` + `auto.ts` after cleanup. Delete `docs.ts`, `issueTriage.ts`. |
| 13 | Boundary workflow | `auto.ts` always wraps leaf via sub-actor. Pre-nodes (router) + post-nodes (cleanup, telemetry, meta-improve). |
| 14 | Router | LLM-only at MVP. Single agent node in `auto.ts:routing`. Decides workflow id AND variant. Parks as humanReview if confidence low. |
| 15 | Failure semantics | Pre-node failure = graceful degradation (router) or abort (setup). Post-node failure = warning only (`advisory: true` flag). |
| 16 | ML features per run | Captured in `state.json:origin.features` + `variant_chosen` + `workflow_file_hash`. Optional fields. Used by meta-agent for slicing analytics. |
| 17 | **Supreme principle: humans don't touch code.** | Customizations happen via file conventions (L1 markdown, L3 TS rarely) — not daily code edits. TS files are write-once-by-meta-agent. Drives §10. |
| 18 | **Customization layers (3-tier model)** | L1 prompts (file convention with variants), L2 per-actor config (DEFERRED), L3 workflow shape (TS extend). Pick lightest tool that fits. |
| 19 | **Variants as first-class concept** | `prompts/<workflow>/<variant>/<actor>.md` with inheritance (variant → default → built-in). CLI: `--workflow <id>:<variant>`. Library of variants per workflow grows as meta-agent learns. |
| 20 | **Prompt override semantics: REPLACE only** | No append mode. File convention always replaces. Meta-agent synthesizes "base + addendum" by writing the full file. One mode, no merge surprises. |
| 21 | **`harny.json` removed in 0.2.0** | File convention (L1) covers prompt overrides; L3 covers everything else. `harny.json` becomes redundant. |
| 22 | **Precedence**: L1 (file convention) > L3 (TS extend) for prompts; L3 wins for non-prompt changes. | Documented in §10.3. |
| 23 | **`auto.ts` cleanup-on-failure model** | Hybrid: graph states for visibility/customization (`finalize > {cleanup, telemetry}`) + runtime `try/finally` safety net. Cleanup actor must be idempotent. Documented in §4.4. |
| 24 | **Actor idempotency on snapshot restore (P1 finding)** | XState restarts `fromPromise` actors on restore — does NOT resume mid-promise. `agentActor` MUST read prior session_id from state.json + pass `resumeSessionId` to SDK. `commandActor` requires explicit `idempotent: true` (default) or `false` (refused after restore). `AbortSignal` threading mandatory for all actors. Documented in §9.1.1. |

---

## 14. Open items — consolidated map

### ⚠️ Strategic — decide before Phase 1

These are forks that shape Phase 1 work materially. Need explicit resolution.

| # | Topic | Where in doc | Lean (if any) |
|---|---|---|---|
| ~~S1~~ | ~~Workflow inheritance/extension model.~~ | §10 | ✅ RESOLVED — file convention (L1) for prompts + `.extend()` (L3) for shape. |
| ~~S2~~ | ~~Prompts: replace-only vs append.~~ | §10.1 | ✅ RESOLVED — replace only. Meta-agent synthesizes full file when needed. |
| ~~S3~~ | ~~`harny.json` post-engine.~~ | §10 | ✅ RESOLVED — removed in 0.2.0. |
| ~~S4~~ | ~~`auto.ts` failure path — graph (a) vs try/finally (b).~~ | §4.4 | ✅ RESOLVED — **hybrid (c)**: graph states for visibility/customization + `try/finally` runtime safety net + idempotent cleanup actor. |

### 🔬 Phase 0 probes (hands-on, blocks Phase 1)

| # | Probe | Status | Finding |
|---|---|---|---|
| P1 | XState v5 sub-actor snapshot recursion + typing + `provide()` semantics. | ✅ RESOLVED — probe at `scripts/probes/xstate/01-snapshot-recursion.ts` (kept as regression test). | **Structural OK** (3-level recursive snapshot/restore works, `provide()` returns new machine + preserves un-overridden actions, `defineWorkflow<TMachine extends AnyStateMachine>` typing flows). **Critical semantic gotcha**: `fromPromise` actors RESTART on restore — see §9.1.1. Requires `agentActor` to thread `resumeSessionId` from state.json + `AbortSignal` to SDK. Already aligned with our `runPhase` resume design. **Path-derived spawn IDs** in snapshot are version-fragile — accepted, `schema_version` covers it. |
| P2 | Bun dynamic import of `<cwd>/.harny/workflows/foo.ts` resolving `@lfnovo/harny`. | ✅ RESOLVED | Bun does Node-style upward walk from importing file's dir. `<cwd>/node_modules/@lfnovo/harny` is the natural install point. CLI's own bunx-installed copy does NOT satisfy custom-workflow imports. **Action:** runtime must catch `Cannot find module "@lfnovo/harny"` and print clear "run `bun add @lfnovo/harny` in your project root" error. |
| P3 | Bun import cache freshness when workflow file is edited between runs. | ✅ RESOLVED (downgraded) | Bun caches imports indefinitely per-process (issue [#12371](https://github.com/oven-sh/bun/issues/12371), no `Bun.clearImportCache()` API). **Non-issue for current design**: viewer is read-only (reads state.json, doesn't execute workflows); each `harny "..."` is a fresh process. **Action for future Phase 4 graph rendering:** parse workflow files as AST/text or shell out to subprocess, NOT in-process dynamic import. |
| P4 | Concurrent runs in same project: state.json atomic writes don't race when XState snapshot is large. | ✅ RESOLVED | Different `.harny/<slug>/state.json` paths = zero contention (POSIX `rename()` is per-path atomic). **Action:** keep existing `writeJsonAtomic` using Node `fs.promises.rename`. Do NOT switch to `Bun.write()` — it has no atomicity guarantee. macOS APFS `rename(2)` is atomic on same volume. |

### 📐 Phase 1 design details (resolved during SDK build)

| # | Topic | Where |
|---|---|---|
| D1 | Exact TS signature of `defineWorkflow` (strict generics for action names, actor names, state structure). | §8.1 |
| D2 | Router output Zod schema (typed features vs free-form). | §5.4 |
| D3 | `harnyActions` registry list — start small, grow organically. Document additions in CHANGELOG. | §8.2 |
| D4 | Sub-workflow context passing convention (input-only, no parent context access). | §4.1 |
| D5 | `--feature key.path=value` parser (lodash.set vs ~10 LOC custom). | §4.5 |

### ⏭️ Deferred (post-MVP, intentional)

| # | Topic | When |
|---|---|---|
| F1 | `auto.ts` cognitive load in viewer (toggle "show only leaf"). | Phase 4 |
| F2 | `meta-improve` triggering policy (sync vs async). | Phase 5 |
| F3 | Cost estimator pre-node (block runs above $ threshold). | On demand |
| F4 | Router prompt A/B versioning by meta-agent. | Post-MVP |
| F5 | Repo inspection helpers shared lib (`@lfnovo/harny/repo-inspect`). | Phase 1+ ergonomia |
| F6 | `harny test <workflow>` dry-run mechanism. | Phase 2+ |
| F7 | Viewer-driven approve UI for humanReview. | Phase 4+ |
| F8 | `harny --workflow auto` semantics — equivalent to no flag, document. | Phase 1 docs |

### 📝 Notes that emerged but don't need decision

- **Audit log for meta-agent mutations** — git commits are sufficient; no separate log needed.
- **Multiple humanReviews per run** — no cap. Each one is a learning signal. Already aligned with vision.
- **`harny.json` migration path for existing user (you)** — single-user reality, just document in CHANGELOG when 0.2.0 ships. Migration guide: any prompt overrides in `harny.json` move to `<cwd>/.harny/prompts/feature-dev/default/<actor>.md`.
- **Variant inheritance fallback chain** — `<workflow>:<variant>:<actor>` → `<workflow>:default:<actor>` → built-in. Documented in §10.1, no further design needed.
- **`harny.json` schema removal** — 0.2.0 deletes `loadHarnessConfig` and the `phases` map merging. Loader in `src/harness/config.ts` becomes a no-op or is removed entirely.

---

## 15. What this is NOT

- Not a new orchestration product. We're using XState as engine; harny SDK is a thin layer.
- Not a competitor to LangGraph. Different audience (TS-Bun-Anthropic-direct, no LangChain).
- Not a workflow marketplace. Workflows live per-project; no central registry planned.
- Not a UI-driven workflow builder. Authors write TS files. The viewer renders; it doesn't author.
- Not a generic state machine framework. We're constraining the API to agent + command + humanReview node types — anything else escapes to raw XState.
- Not a workflow router optimization tool. Router exists to make UX nice and feed analytics; it's not the value prop.
- Not a hosted service or SaaS. Single-process CLI. The viewer is local. State is local.

The actual value prop: **harny observes its own runs and improves itself.** Everything in this doc is plumbing toward that.
