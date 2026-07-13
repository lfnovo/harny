# Workspaces, isolation, and ChangeSets

`worktree` isolation creates `harny/<slug>` and runs agents in a dedicated Git worktree. Successful runs remove the worktree; failures preserve it for diagnosis. The primary repository can remain untouched while work proceeds.

`inline` runs in the current checkout and requires a clean tree. It is useful for deterministic workflows or environments where a worktree is unnecessary.

## ChangeSet identity

After a developer call, Harny collects tracked changes and untracked non-`.harny` paths. Each entry records its path and SHA-256 content hash, or null for deletion. The ChangeSet ID hashes the base commit and sorted entries.

Before an agent validator sees the diff, Harny rejects protected generated or credential-like paths and unexpectedly large ChangeSets. `node_modules/` is protected by default. A workflow may declare an intentional prefix under `workspace.allow_paths`, which keeps vendored-dependency repositories possible without weakening the default. Planner and developer prompts also require checking `.gitignore` before dependency installation or generation.

Validation happens against that content, not merely the developer's prose. Before validation, after validation, and before commit, Harny recalculates identity.

The commit executor stages only the registered paths and checks the staged list. This makes commit a privileged effect with a narrow, inspectable input.

Tool guards reduce accidental misuse, but the ChangeSet invariant is the final protection against a different diff being committed.

Each task validator receives the authoritative ChangeSet path manifest and must re-run established repository-wide gates. After all task commits, bundled feature workflows run a final validator against the accumulated clean branch. A failed final gate makes the run fail and preserves its worktree instead of reporting a false success.
