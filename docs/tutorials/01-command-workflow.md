# Build a command-only workflow

In this tutorial, you will create and run a workflow that uses only local commands. It introduces the workflow file, dependency ordering, persisted state, inspection, and cleanup without calling Claude or Codex.

Estimated time: 10 minutes. Provider cost: none.

## What you will build

The workflow contains three sequential nodes:

```text
prepare directory → create file → inspect Git status
```

At the end, the repository will contain `tutorial-output/hello.txt`, and Harny will have a completed run named `hello-command`.

## 1. Create a disposable repository

Start outside an existing project so the tutorial cannot affect real work:

```bash
mkdir harny-first-run
cd harny-first-run
git init
printf '# Harny first run\n' > README.md
git add README.md
git commit -m "chore: initialize tutorial repository"
```

Harny requires the initial commit because workspaces and ChangeSets are anchored to Git history.

## 2. Define the workflow

Project workflows live under `.harny/workflows/`. Runtime state lives under the same `.harny/` root, so first add a narrow ignore file that keeps generated state out of Git while allowing workflow definitions to be versioned:

```bash
mkdir -p .harny/workflows
cat > .harny/.gitignore <<'GITIGNORE'
*
!.gitignore
!workflows/
!workflows/**
GITIGNORE

cat > .harny/workflows/hello-command.yaml <<'YAML'
version: 2
name: hello-command
defaults:
  provider: claude
  timeout: 30000
workspace:
  isolation: inline
outcome:
  type: none
nodes:
  - id: prepare
    type: command
    command: [mkdir, -p, tutorial-output]

  - id: create_file
    type: command
    command: [touch, tutorial-output/hello.txt]
    depends_on: [prepare]

  - id: inspect
    type: command
    command: [git, status, --short]
    depends_on: [create_file]
YAML
```

Commit the workflow so the inline workspace starts clean:

```bash
git add .harny/.gitignore .harny/workflows/hello-command.yaml
git commit -m "chore: add first Harny workflow"
```

Notice a few properties:

- `version: 2` selects the current workflow schema.
- `provider` is required as a workflow default, but no provider is invoked because there are no `agent` nodes.
- `isolation: inline` runs commands in the current repository.
- `outcome: none` means the workflow does not promise a branch, commit, or pull request.
- `depends_on` forms a directed graph and makes the intended order explicit.
- `command` is an argv array. Harny launches the executable directly rather than evaluating a shell string.
- `.harny/.gitignore` ignores run state but explicitly keeps project workflow definitions trackable.

## 3. Run it

Execute the workflow with a stable run name:

```bash
harny --quiet \
  --workflow ./.harny/workflows/hello-command.yaml \
  --name hello-command \
  "create the tutorial output"
```

The prompt is required for every run and is preserved as part of its origin, even though these deterministic command nodes do not consume it.

The compact result should end with:

```text
[harny] status=done branch=
```

The empty branch is expected: this workflow declares `outcome: none` and runs inline.

## 4. Verify the observable result

Check the file and Git status:

```bash
test -f tutorial-output/hello.txt
git status --short
```

Git should report only the new `tutorial-output/` path. Harny did not commit it because the workflow contains no privileged `commit` node; generated `.harny/hello-command/` state is hidden by the ignore rules you added.

## 5. Inspect the persisted run

Ask Harny for the run projection:

```bash
harny show hello-command
```

Look for:

```text
Workflow:  hello-command
Status:    done

Nodes:
  prepare (completed, attempt 1)
  create_file (completed, attempt 1)
  inspect (completed, attempt 1)
```

The authoritative snapshot lives at:

```text
.harny/hello-command/run.json
```

An append-only audit stream lives beside it:

```text
.harny/hello-command/events.jsonl
```

Open `run.json` and find `execution.nodes.inspect.output`. It contains the command's captured `stdout`, `stderr`, and exit code. Node output belongs to the node that produced it; Harny does not maintain a second in-memory lifecycle as another source of truth.

You can also launch the read-only viewer:

```bash
harny ui
```

## 6. Experiment

Before moving on, try one safe change:

1. Clean the completed run as shown below.
2. Add another command node that depends on `inspect`.
3. Give the new run a different `--name` or reuse `hello-command` after cleanup.
4. Inspect how the new node appears in `run.json` and `harny show`.

Harny refuses to silently overwrite an existing run name. This makes a slug a stable handle for its state rather than an accidental cache key.

## 7. Clean up

Remove the run state and tutorial output:

```bash
harny clean hello-command
rm -rf tutorial-output
```

To remove the entire disposable repository, leave it first:

```bash
cd ..
rm -rf harny-first-run
```

## What you learned

You have now used the core runtime without an AI model:

- YAML declares the workflow instead of executing it.
- Static validation happens before command execution.
- Dependencies determine readiness; declaration order breaks ties.
- Every node attempt and output is persisted.
- Outcomes describe what the workflow promises.
- Harny performs only the effects represented by node executors.

The next tutorial will replace one deterministic command with an `agent` node and introduce structured provider output.
