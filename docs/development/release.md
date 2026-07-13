# Release checklist

## Code and contracts

- Review the complete diff for scope and unrelated user changes.
- Confirm workflow and run schema compatibility decisions.
- Verify provider capabilities and session fingerprints remain honest.
- Check privileged effects, ChangeSet equality, remote-head protection, and cleanup paths.
- Search for stale references to removed runtimes, schemas, commands, and adapters.

## Quality gates

```bash
bun run typecheck
bun test
bun run probes
git diff --check
npm pack --dry-run
```

Run targeted integration tests for SDKs and viewer JavaScript. Perform live provider or PR dogfood only with explicit credentials, cost, and external mutation in scope.

## Documentation

- Update README for product-level changes.
- Update exact reference contracts.
- Update tutorials when commands or observed output change.
- Add or supersede an ADR for durable architectural decisions.
- Validate local links and package inclusion.

## Package inspection

Check the dry-run file list, runtime dependencies, version, executable entrypoint, bundled workflows/prompts, examples, and docs. Installation footprint is a product trade-off; note material dependency changes.

## Delivery

Use conventional commits and a reviewable PR. Harny never force-pushes, merges, or deploys as part of its workflow runtime; those remain explicit maintainer actions.
