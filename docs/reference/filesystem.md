# Filesystem layout reference

## Repository-local

```text
<repo>/.harny/
├── <slug>/
│   ├── run.json
│   ├── events.jsonl
│   └── transcripts/
│       ├── <node>/attempt-<n>.jsonl
│       └── <foreach>/<index>/<step>/attempt-<n>.jsonl
├── worktrees/<slug>/
├── workflows/<name>.yaml
├── commands/<name>.md
└── prompts/<workflow>/<variant>/<actor>.md
```

Run state, transcripts, and worktrees are generated. Workflows, commands, and prompts are optional versioned project configuration; ignore rules must explicitly retain them if `.harny/*` is ignored.

## User-global

```text
~/.harny/
├── providers.json
├── .env
├── assistants.json
├── runs/<run-id>.json
├── workflows/<name>.yaml
└── commands/<name>.md
```

- `providers.json`: logical provider connections, no secret values.
- `.env`: optional Harny credential environment.
- `assistants.json`: optional named cwd shortcuts.
- `runs/`: rebuildable discovery pointers.
- workflows/commands: global reusable overrides.

## Project root environment

`./harny.env` is an optional Harny-specific environment overlay. Project application `.env*` files are inspected only to prevent unintended Anthropic credential inheritance unless `HARNY_INHERIT_ENV=1`.

## Published package

Bundled workflows and default prompts live under `src/harness/workflow/` in the installed package. User lookup never writes into the package directory.
