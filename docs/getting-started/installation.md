# Install Harny

This page installs the CLI and verifies the local runtime. The next tutorial uses only deterministic command nodes, so provider authentication is not required yet.

Estimated time: 5 minutes. Provider cost: none.

## Prerequisites

Harny requires:

- [Bun](https://bun.sh/) 1.3 or newer;
- Git;
- a Git repository with at least one commit when you start a run.

Check the local versions:

```bash
bun --version
git --version
```

If `bun --version` is older than 1.3, update Bun before continuing.

## Install the CLI

For regular use, install Harny globally:

```bash
bun add --global @lfnovo/harny
```

Verify that the executable is available:

```bash
harny --version
harny --help
```

If the shell cannot find `harny`, run `bun pm bin --global` and add the printed directory to your `PATH`, then open a new terminal.

## Run without a global installation

You can also invoke the package with `bunx`:

```bash
bunx @lfnovo/harny --version
```

In the rest of the documentation, commands use `harny`. Substitute `bunx @lfnovo/harny` if you prefer not to install it globally.

## Provider authentication

Command-only workflows do not call a provider. Agent workflows need authentication for every provider they select:

- Claude uses the Claude Agent SDK and its existing authentication environment.
- Codex uses the pinned official Codex SDK and the user's existing Codex authentication and configuration.
- Compatible endpoints can be declared later in the global `~/.harny/providers.json`, with secret values supplied through environment variables.

The default `feature-dev` workflow uses Claude. You can postpone provider setup until the first agent tutorial.

Never put API keys in workflow YAML or commit them to the repository.

## What a run expects from Git

Harny records state relative to a real repository and uses Git for workspace safety. Before invoking it, the target directory must:

1. be a Git repository;
2. contain an initial commit;
3. have a clean working tree when using inline execution.

The first tutorial creates a disposable repository with those properties.

## Next step

Continue to [Build a command-only workflow](../tutorials/01-command-workflow.md). You will create a three-node DAG, execute it without a provider call, and inspect the persisted run.
