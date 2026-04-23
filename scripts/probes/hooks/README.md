# Hook probes

Unit probes for `src/harness/guardHooks.ts` — exercise `buildGuardHooks()`
callbacks with fabricated `PreToolUse` inputs and verify allow/deny for
every matcher + escape hatch.

Run when editing `guardHooks.ts` (and before committing):

```
bun scripts/probes/hooks/01-guardhooks.ts
```

Exit 0 on all-pass; exit 1 on any failure.

These probes validate the **logic** of the deny rules. SDK integration
(that `PreToolUse` hooks actually fire) is validated separately by
`scripts/probes/hook-probe.ts`.
