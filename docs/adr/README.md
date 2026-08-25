# Architecture Decision Records

ADR decision status and evidence maturity are separate dimensions.

## Decision status

```text
proposed
accepted
superseded
rejected
```

## Evidence maturity

```text
design-only          architecture direction, no executable proof
executable-poc       linked fixtures/tests/failure evidence
production-observed  linked deployed artifact and operational evidence
superseded           no longer active
```

Machine-readable evidence lives in [`evidence-registry.json`](./evidence-registry.json). An accepted design-only ADR directs implementation but does not claim production readiness.

## Records

| ID | Decision | Status | Evidence |
|---|---|---|---|
| [0001](./0001-independent-customer-applications.md) | Independent customer applications | accepted | design-only |
| [0002](./0002-package-composition-not-core-forks.md) | Package composition instead of copied core | accepted | design-only |
| [0003](./0003-plugin-taxonomy-and-capabilities.md) | Plugin taxonomy and capability dependencies | accepted | design-only |
| [0004](./0004-manifest-driven-cli.md) | Manifest-driven CLI | accepted | design-only |
| [0005](./0005-unified-builder-fixed-shell.md) | Unified builder contracts and fixed shell | accepted | design-only |
| [0006](./0006-theme-package-runtime-profile.md) | Theme package plus runtime profile | accepted | design-only |
| [0007](./0007-payload-and-puck-initial-candidates.md) | Payload/Puck initial direction | proposed | design-only |
| [0008](./0008-postgres-and-customer-owned-migrations.md) | Postgres and customer migrations | accepted | design-only |
| [0009](./0009-database-adapter-and-target-plugins.md) | Superseded persistence abstraction | superseded | superseded |
| [0010](./0010-typed-data-source-state-binding-graph.md) | Typed sources/state/bindings | accepted | design-only |
| [0011](./0011-payload-database-adapter-selected-at-scaffold.md) | Payload adapter selected at scaffold | accepted | design-only |
| [0012](./0012-hybrid-output-contracts.md) | Hybrid output contracts | accepted | design-only |
| [0013](./0013-conservative-technology-package-baseline.md) | Conservative package baseline | accepted | design-only |
| [0014](./0014-contract-governance-and-evidence.md) | Machine-readable contract governance | accepted | design-only |
| [0015](./0015-runtime-security-reliability-gates.md) | Runtime security/reliability gates | accepted | design-only |

## ADR template

```md
# ADR-NNNN: Decision title

- Status: proposed | accepted | superseded | rejected
- Date: YYYY-MM-DD
- Decision owners: team
- Evidence: design-only | executable-poc | production-observed
- Related: links

## Context
## Decision
## Consequences
## Alternatives considered
## Validation or revisit trigger
```

Consequential changes update the decision register, evidence registry, affected machine-readable contracts, fixtures, and tests.
