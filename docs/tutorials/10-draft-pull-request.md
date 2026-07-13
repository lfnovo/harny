# Deliver a draft pull request

The bundled `feature-pr` workflow extends feature development with a privileged GitHub pull-request node.

Prerequisites:

- a trusted `github.com` origin;
- `gh auth status` succeeds;
- permission to push the run branch and create pull requests;
- a base branch named `main` for the bundled definition.

Run:

```bash
harny --workflow feature-pr --name json-export-pr \
  "Add JSON export to the CLI with tests and documentation"
```

After all tasks validate and commit, Harny:

1. reads and validates the GitHub remote;
2. observes the remote branch head;
3. pushes without force;
4. confirms the remote head equals the expected local commit;
5. finds an existing pull request for the head;
6. creates a draft or updates the existing pull request idempotently;
7. reads back and persists its number, URL, base, head, and SHA.

Agents do not receive permission to publish directly. A failed verification preserves the worktree for diagnosis.

To address feedback on an open PR later:

```bash
harny pr fix 123
```

The command pins the observed remote head, acquires a repository/PR lease, starts a related `review-fix` run, validates and commits changes, then updates the same PR with `existing: require`. If the remote head changes during the run, Harny fails instead of overwriting it.
