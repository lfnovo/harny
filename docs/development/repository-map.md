# Repository map

| Path | Responsibility |
| --- | --- |
| `bin/harny.ts` | Published Bun entrypoint. |
| `src/runner.ts` | Argument parsing and subcommand dispatch. |
| `src/runner/` | CLI handlers, summaries, environment, discovery, viewer launch, PR preflight. |
| `src/harness/orchestrator.ts` | Run identity, validation, workspace preparation, lifecycle completion, cleanup. |
| `src/harness/workflow/schema.ts` | Normalized workflow v2 types and Zod schema. |
| `src/harness/workflow/validate.ts` | Static graph, reference, policy, and capability validation. |
| `src/harness/workflow/runtime.ts` | Sequential persisted scheduler, attempts, retry, foreach, pause/recovery. |
| `src/harness/workflow/declarativeRunner.ts` | Executor composition and special feature roles. |
| `src/harness/workflow/loader.ts` | YAML and command lookup precedence. |
| `src/harness/workflow/bundled/` | Shipped workflow definitions. |
| `src/harness/workflow/prompts/` | Shipped feature actor prompts. |
| `src/harness/providers/` | Provider-neutral contract, Claude/Codex adapters, global config. |
| `src/harness/sessionRecorder.ts` | Claude SDK stream, tools, retries, usage, structured result. |
| `src/harness/state/` | Atomic run store, schema, discovery pointers, views, usage projection, leases. |
| `src/harness/transcripts/` | Provider-neutral event schema and attempt-scoped JSONL storage. |
| `src/harness/git/changeSet.ts` | Diff identity and safe staging/commit. |
| `src/harness/workspace/` | Git worktree/inline lifecycle. |
| `src/harness/forge/` | Trusted GitHub remote and idempotent PR delivery. |
| `src/harness/guardHooks.ts` | Claude tool guard hooks and documented threat model. |
| `src/viewer/` | Read-only HTTP API and single-page UI. |
| `scripts/probes/` | Cross-module and packaging behavior checks. |
| `plugin/` | Separately versioned Claude Code plugin and operational skills. |

Subtree `AGENTS.md` files contain non-obvious implementation constraints. Read the nearest one before editing testing infrastructure; adjacent `CLAUDE.md` files are compatibility redirects.
