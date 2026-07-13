# CLI reference

## Run

```text
harny [global flags] "<prompt>"
```

| Flag | Meaning |
| --- | --- |
| `--workflow <id-or-path>` | Select workflow; default `feature-dev`. Named variants use `id:variant`. |
| `--name <slug>` | Stable run slug, state directory, and optional `harny/<slug>` branch. |
| `--assistant <name>` | Resolve cwd from optional `~/.harny/assistants.json`. |
| `--isolation worktree\|inline` | Override workflow workspace isolation. |
| `--mode interactive\|silent\|async` | Select human-interaction behavior. |
| `--verbose`, `-v` | Verbose logs. |
| `--quiet` | Suppress non-error logs and print a compact result. |
| `--version`, `-V` | Print version. |
| `--help`, `-h` | Print help. |

A prompt is required for every new run. Without `--assistant`, cwd is the current directory.

## Inspect

```text
harny ls [--status <status>] [--cwd <absolute-path>] [--workflow <id>]
harny show <run-id-or-slug>
harny show <run-id> --tail [--since <seconds|Ns|Nm|Nh>]
harny ui [--port <number>] [--no-open]
```

`ls` discovers runs through global pointers and project scans. `show` matches an exact or prefix run ID, or a slug; prefer the full ID when the same slug exists in several repositories. The viewer binds to `127.0.0.1`; default port is 4123 or `HARNY_UI_PORT`.

## Human input

```text
harny answer <run-id-or-slug> [text]
harny answer <run-id-or-slug> --json '<json>'
```

With no answer argument, the CLI prompts interactively.

## Pull-request feedback

```text
harny pr fix <positive-number>
```

Requires an open GitHub PR, trusted origin, authenticated `gh`, and a stable remote head.

## Cleanup and discovery

```text
harny clean <slug> [--force] [--kill]
harny clean --prune
harny scan [<cwd>]
```

`--force` permits terminating a live run with `SIGTERM`; `--kill` permits later `SIGKILL`. `scan` defaults to cwd.

## Exit behavior

Argument and handler errors generally produce nonzero process exits. A completed CLI invocation can still report a terminal workflow status such as `failed`; automation should inspect persisted run status rather than assuming every workflow failure maps to a nonzero CLI exit. A waiting-human run is an intentional persisted outcome rather than a background daemon process.
