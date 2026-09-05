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

Machine-readable evidence lives in [`evidence-registry.json`](./evidence-registry.json).

Evidence maturity is atomic per ADR. A phase may provide task-level evidence without promoting a broader ADR; promotion occurs only when the ADR's complete normative scope is proven.

## Records

| ID | Decision | Status | Evidence |
|---|---|---|---|
| [0001](./0001-independent-customer-applications.md) | Independent customer applications | accepted | design-only |
| [0002](./0002-package-composition-not-core-forks.md) | Package composition instead of copied core | accepted | design-only |
| [0003](./0003-plugin-taxonomy-and-capabilities.md) | Plugin taxonomy and capabilities | accepted | design-only |
| [0004](./0004-manifest-driven-cli.md) | Manifest-driven CLI | accepted | design-only |
| [0005](./0005-unified-builder-fixed-shell.md) | Builder contracts and fixed shell | accepted | design-only |
| [0006](./0006-theme-package-runtime-profile.md) | Theme package plus runtime profile | accepted | design-only |
| [0007](./0007-payload-and-puck-initial-candidates.md) | Earlier Payload/Puck candidate framing | proposed | design-only |
| [0008](./0008-postgres-and-customer-owned-migrations.md) | Postgres and customer migrations | accepted | design-only |
| [0009](./0009-database-adapter-and-target-plugins.md) | Superseded persistence abstraction | superseded | superseded |
| [0010](./0010-typed-data-source-state-binding-graph.md) | Typed sources/state/bindings | accepted | design-only |
| [0011](./0011-payload-database-adapter-selected-at-scaffold.md) | Payload adapter selected at scaffold | accepted | design-only |
| [0012](./0012-hybrid-output-contracts.md) | Hybrid output contracts | accepted | design-only |
| [0013](./0013-conservative-technology-package-baseline.md) | Conservative package baseline | accepted | design-only |
| [0014](./0014-contract-governance-and-evidence.md) | Machine-readable contract governance | accepted | executable-poc |
| [0015](./0015-runtime-security-reliability-gates.md) | Runtime security/reliability gates | accepted | executable-poc |
| [0016](./0016-payload-strategic-v1-framework.md) | Payload as strategic V1 framework | accepted | design-only |
| [0017](./0017-deterministic-composition-and-registration-reconciliation.md) | Deterministic composition and registration reconciliation | accepted | executable-poc |
| [0018](./0018-agent-tool-contracts-and-safe-execution.md) | Agent tool contracts and safe execution gateway | accepted | executable-poc |
| [0019](./0019-official-payload-plugin-adoption-boundaries.md) | Official Payload plugins as bounded implementation adapters | accepted | design-only |
| [0020](./0020-reference-sales-and-headless-component-system.md) | Sales reference plugin and platform-owned headless component system | accepted | design-only |
| [0021](./0021-dynamic-application-runtime-and-zero-downtime-delivery.md) | Dynamic applications and zero-downtime extension delivery | accepted | executable-poc |
| [0022](./0022-rbac-authorization-and-extension-role-templates.md) | Central RBAC and extension role templates | accepted | executable-poc |
| [0023](./0023-phase-9-production-isolation-and-static-delivery-hardening.md) | Phase 9 production isolation and static delivery hardening | accepted | executable-poc |
| [0024](./0024-system-settings-and-extension-operations.md) | System settings and extension operations | accepted | design-only |
| [0025](./0025-runnable-workspace-shell-pages-and-builder.md) | Runnable workspace shell, customer pages, and builder | accepted | design-only |
| [0027](./0027-generated-administration-operator-transport.md) | Generated administration operator transport | accepted | design-only |

An accepted design-only ADR directs implementation but is not a production-readiness claim. Consequential changes update the decision register, evidence registry, machine-readable contracts, fixtures, tests, and lower-authority prose atomically.
