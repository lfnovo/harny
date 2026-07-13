# Human review as persisted control flow

Human review is a node state, not a blocking terminal prompt. In interactive mode it can be answered immediately; in async mode the run parks and the process exits.

Parking persists enough information to resume safely: question, options, node identity, timestamps, expiry, workspace reservation, and provider session when applicable.

This design avoids requiring a daemon. The trade-off is logical expiry: time passing alone does not rewrite disk. A later discovery or answer operation materializes the appropriate failure or fallback continuation.

The worktree remains reserved because it can contain the exact context an agent session must resume against. Completion, failure, cancellation, expiry, or explicit cleanup ends that reservation.

Workflows should use human nodes for consequential choices, missing information, or approval boundaries—not for details an agent can resolve through repository evidence.
