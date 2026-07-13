# Harny documentation

Harny is a local-first runtime for auditable AI development workflows. It lets agents plan, implement, and validate changes while the runtime retains control over state, retries, Git commits, human review, usage, and pull-request delivery.

This documentation has two entry paths.

## Use Harny

Start here if you want to run Harny in a repository or create a workflow:

1. [Getting started](getting-started/README.md) — understand the product, install it, and complete a first run.
2. [Tutorials](tutorials/README.md) — learn progressively by building increasingly capable workflows.
3. [Guides](guides/README.md) — complete a specific task when you already know the basics.
4. [Concepts](concepts/README.md) — understand why Harny behaves the way it does.
5. [Reference](reference/README.md) — look up CLI commands, YAML fields, providers, and persisted state.

## Develop Harny

Start with the [development documentation](development/README.md) if you want to fix a bug, add a provider or node, or change the runtime. Architectural choices that should survive individual implementations live in [decision records](decisions/README.md).

## Documentation principles

The sections intentionally serve different needs:

- A **tutorial** teaches through a complete, reproducible experience.
- A **guide** solves one concrete problem without teaching the whole product.
- A **concept** explains the mental model and trade-offs behind the behavior.
- A **reference** describes the exact contract and is optimized for lookup.
- **Development documentation** explains the codebase, its extension points, invariants, and quality gates.
- A **decision record** preserves why a consequential choice was made.

Avoid duplicating the same contract in several places. Reference pages own exact syntax; tutorials and guides link to them when more detail is useful.

This organization follows the [Diátaxis](https://diataxis.fr/) distinction between tutorials, how-to guides, explanation, and reference. Architecture decision records use a compact format inspired by [MADR](https://adr.github.io/madr/).
