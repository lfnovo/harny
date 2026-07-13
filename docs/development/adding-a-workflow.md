# Add a bundled workflow

## Definition

Add YAML under `src/harness/workflow/bundled/`. Prefer composing existing node types and Markdown commands over adding runtime code.

The workflow should declare:

- a stable lowercase name;
- provider and timeout defaults;
- workspace isolation;
- finite outcome;
- bounded retries and `foreach` limits;
- explicit capability requirements;
- guards appropriate to each role.

## Prompts

Long feature role instructions belong under `src/harness/workflow/prompts/default/`. Generic reusable commands belong under the bundled commands lookup root. Keep privileged effects out of agent instructions.

## Acceptance tests

Test that the bundled file loads and statically validates. Add characterization tests for success, retry, blocked output, exhausted attempts, no-op behavior, cleanup, call ordering, and any new outcome.

Provider, Git, state, workspace, and forge fakes should make these tests deterministic. A live dogfood run is valuable after local contracts pass, but is not a substitute for them.

## Documentation

Add the workflow to bundled reference and provide a tutorial or guide if it introduces a new user journey. Project overrides of the same name become maintained forks, so document changes that affect them.
