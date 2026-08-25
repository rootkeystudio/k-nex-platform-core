# Architecture Decision Records

Architecture Decision Records (ADRs) capture consequential decisions that shape multiple packages, customer applications, or operational processes.

## Status values

```text
proposed
accepted
deprecated
superseded
rejected
```

## Records

| ID | Decision | Status |
|---|---|---|
| [0001](./0001-independent-customer-applications.md) | Independently deployed customer applications | Accepted |
| [0002](./0002-package-composition-not-core-forks.md) | Package composition instead of copied/forked core source | Accepted |
| [0003](./0003-plugin-taxonomy-and-capabilities.md) | Unified plugin taxonomy and capability-based dependencies | Accepted |
| [0004](./0004-manifest-driven-cli.md) | Manifest-driven CLI as application compiler | Accepted |
| [0005](./0005-unified-builder-fixed-shell.md) | Unified builder contracts with fixed shell and editable canvas | Accepted |
| [0006](./0006-theme-package-runtime-profile.md) | Theme package plus runtime theme profile | Accepted |
| [0007](./0007-payload-and-puck-initial-candidates.md) | Payload and Puck as provisional initial implementation candidates | Proposed |
| [0008](./0008-postgres-and-customer-owned-migrations.md) | Postgres default and customer-owned final migrations | Accepted |
| [0009](./0009-database-adapter-and-target-plugins.md) | Database adapters and connection targets as provider plugins | Superseded by 0011 |
| [0010](./0010-typed-data-source-state-binding-graph.md) | Typed data sources, UI state, and declarative binding graph | Accepted |
| [0011](./0011-payload-database-adapter-selected-at-scaffold.md) | Select Payload database adapter at scaffold time | Accepted |

## ADR template

```md
# ADR-NNNN: Decision title

- Status: proposed | accepted | deprecated | superseded | rejected
- Date: YYYY-MM-DD
- Decision owners: names or team
- Related: documents/issues/ADRs

## Context

What forces and constraints require a decision?

## Decision

What is the chosen direction?

## Consequences

What becomes easier, harder, required, or intentionally unsupported?

## Alternatives considered

What credible alternatives were considered and why were they not selected?

## Validation or revisit trigger

What evidence can confirm, invalidate, or require revisiting the decision?
```

The broader [decision register](../21-decision-register.md) contains smaller decisions and unresolved questions. Create a dedicated ADR when a decision has meaningful architectural consequences, significant alternatives, or a difficult reversal cost.
