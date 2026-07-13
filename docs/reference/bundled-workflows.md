# Bundled workflow reference

## `feature-dev`

- Default provider: Claude.
- Timeout: 30 minutes inherited.
- Workspace: isolated worktree.
- Outcome: branch.
- Shape: planner → bounded sequential tasks → guarded developer → read-only validator → privileged commit.
- Validator failure returns to developer with at most three validator attempts.

## `feature-pr`

Same development loop, followed by a GitHub `pull_request` node:

- base `main`;
- head is the run branch;
- draft true;
- existing policy `allow`;
- bundled title/body are generic and can be overridden by supplying a project workflow of the same name.

## `review-fix`

Used internally by `harny pr fix <number>`:

- starts from the observed remote PR head;
- receives one feedback task through immutable inputs;
- uses developer/validator/commit retry loop;
- requires an existing PR;
- expects the remote SHA observed at preflight;
- associates a parent run when one can be found.

## Override policy

A project or global YAML with the same name wins over the bundled definition. Treat an override as a maintained fork of the workflow contract and review it on Harny upgrades.
