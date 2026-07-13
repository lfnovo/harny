# Pause for human review

A `human` node can ask synchronously in a terminal or persist a question for later. A timeout is mandatory directly or through workflow defaults.

```yaml
version: 2
name: approval
defaults:
  provider: claude
  timeout: 86400000
workspace:
  isolation: inline
outcome:
  type: none
nodes:
  - id: approval
    type: human
    question: Continue with the local command?

  - id: finish
    type: command
    command: [touch, approved.txt]
    depends_on: [approval]
```

Run asynchronously:

```bash
harny --mode async --workflow ./approval.yaml --name approval-demo "request approval"
```

The process exits with a waiting-human result. The snapshot retains the question, node, workspace reservation, timestamps, expiry, and provider session when the pause originated inside an agent.

Inspect and answer:

```bash
harny show approval-demo
harny answer approval-demo "yes"
```

For structured input:

```bash
harny answer approval-demo --json '{"approved":true}'
```

There is no daemon. Expiry is materialized when the run is accessed. Discovery can turn an expired question without fallback into a failure; invoking `answer` after a configured fallback resumes the workflow without requiring an answer value. Without a fallback, expiry fails the run.

While paused, an isolated worktree remains reserved. Completion, cancellation, expiry, or cleanup eventually releases it according to workspace policy.
