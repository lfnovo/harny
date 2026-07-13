# Local transcripts and privacy

Harny records the part of an agent session that each provider SDK exposes and presents it consistently across Claude and Codex. This makes a run explainable without a separate observability service.

Each agent attempt owns one append-only JSONL file under `.harny/<slug>/transcripts/`. Records are normalized into requests, lifecycle transitions, messages, reasoning, tools, file changes, plans, usage, status, and errors. Provider-native details that do not have a richer common type remain status data rather than leaking vendor SDK objects through the codebase.

The viewer reads transcripts incrementally with a sequence cursor and polls active attempts every three seconds. Repeated updates for the same tool, file-change, or plan ID replace the prior visual state. Reasoning and complete tool input/output are collapsed by default, not discarded.

Transcripts are diagnostic evidence, not runtime state. `run.json` remains authoritative and recovery does not replay transcript events. A partial final JSONL line after a process interruption is ignored by readers; a recovered scheduler attempt writes a new attempt file.

## Retention and sensitivity

Transcripts live inside the run directory and may contain source code, prompts, command output, paths, or other sensitive values returned by tools. Harny does not redact or upload them. Repository filesystem permissions are the security boundary.

Terminal runs are not cleaned automatically. `harny clean <slug>` removes the entire run directory and its transcript files together. Preserve any evidence you need before cleaning.
