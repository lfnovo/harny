# Deliver and update pull requests

## Create or update a draft

Authenticate GitHub CLI and verify the remote:

```bash
gh auth status
git remote get-url origin
```

Then run:

```bash
harny --workflow feature-pr --name feature-pr "implement the feature"
```

The bundled workflow uses `existing: allow`: it creates a draft when no PR exists for the head, otherwise updates the existing one.

## Existing policies

- `allow`: create or update.
- `require`: fail when no matching PR exists.
- `forbid`: fail when one already exists.

## Safety checks

The executor accepts trusted `github.com` SSH or HTTPS remotes, pushes without force, reads the remote SHA, and verifies the final PR head. Authentication tokens never appear in YAML.

## Fix review feedback

```bash
harny pr fix 123
```

The PR must be open. Harny fetches and pins its head, captures comments and reviews as a bounded task, leases the repository/PR pair, links the new run to a prior related run when found, and updates the same PR only after validation.

Concurrent review-fix runs for the same PR are refused. A changed remote head fails safely rather than overwriting somebody else's work.
