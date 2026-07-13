# Pull-request delivery as a privileged effect

Pull requests are deliverables created after validated commits, not open-ended agent tool calls.

The workflow can carry title, body, base, head, draft policy, and existing-PR policy. The executor owns repository inference, push, remote verification, idempotent create/update, and persisted artifact identity.

Harny deliberately excludes force-push, merge, and deploy. A run has a finite outcome; later review feedback or CI failure creates a related run rather than reopening an old lifecycle indefinitely.

`review-fix` demonstrates this model. It starts from a pinned observed PR head, carries `parentRunId` when possible, obtains a per-PR lease, and requires an existing PR. Remote divergence fails without overwriting external work.

This separation keeps agent reasoning flexible while making external mutation narrow, testable, and auditable.
