# Operate human review

## Start a parkable run

Use `--mode async` with a workflow containing a `human` node or an interactive-capable agent:

```bash
harny --mode async --workflow approval --name approval-run "prepare for review"
```

Inspect the pending question:

```bash
harny show approval-run
```

## Answer

Free text:

```bash
harny answer approval-run "approve"
```

JSON:

```bash
harny answer approval-run --json '{"approved":true,"note":"ship it"}'
```

With neither argument, Harny prompts in the terminal.

If an agent session caused the pause, Harny resumes that session only when the provider supports resume and the logical connection fingerprint still matches. Usage from the pre-pause call remains attached to the paused attempt.

## Expiry

There is no background timer. Accessing the run materializes expiry according to the operation. Discovery can finalize an expired question without fallback; invoking `answer` after a configured fallback resumes using an expired/fallback output. Otherwise expiry fails and releases its workspace reservation.

## Cancel or force cleanup

A paused run owns its workspace. If it will never resume:

```bash
harny clean <slug>
```

For an active process, normal cleanup refuses. Use `--force` to send `SIGTERM`, and add `--kill` only when escalation to `SIGKILL` is acceptable.
