# K-Nex Architecture Documentation

K-Nex is a Payload-based, manifest-driven application factory that composes trusted backend/UI plugins, authenticated data sources, output contracts, realtime capabilities, visual CMS/workspace composition, and runtime-configurable installed themes into independently deployed customer products.

## Normative order

When prose and an example conflict, resolve in this order:

1. `contracts/architecture-contracts.v1.json`
2. versioned JSON Schemas under `schemas/`
3. canonical fixtures under `fixtures/`
4. accepted ADR plus evidence registry
5. architecture documents
6. illustrative snippets

Run `python3 scripts/validate_repository_contracts.py` before merging architecture changes.

## Product and architecture

1. [Product vision and boundaries](./01-product-vision.md)
2. [System architecture](./02-system-architecture.md)
3. [Platform package and runtime boundary](./03-platform-core.md)
4. [Module system](./04-module-system.md)
5. [Customer applications](./06-customer-applications.md)

## Composition and lifecycle

1. [Plugin taxonomy and capabilities](./13-plugin-taxonomy-and-capabilities.md)
2. [Application manifest](./14-application-manifest.md)
3. [CLI and project generation](./15-cli-and-project-generation.md)
4. [Plugin lifecycle](./19-plugin-lifecycle-and-package-management.md)
5. [Data, migrations, and versioning](./10-data-migrations-and-versioning.md)
6. [Payload database selection](./23-database-adapters-and-runtime-providers.md)

## UI, builder, themes, and dynamic data

1. [CMS and page builder](./07-cms-and-page-builder.md)
2. [UI composition runtime](./16-ui-composition-runtime.md)
3. [Builder engine and profiles](./17-builder-engine-and-profiles.md)
4. [Theme and design system](./18-theme-and-design-system.md)
5. [Plugin data sources and bindings](./24-data-sources-state-and-binding-graph.md)
6. [Data-source output contracts](./25-output-contracts.md)

## Runtime, security, and operations

1. [Permissions, events, actions, and jobs](./09-permissions-events-and-jobs.md)
2. [Realtime capability](./05-websocket-and-realtime.md)
3. [Security and trust boundaries](./20-security-and-trust-boundaries.md)
4. [Deployment and operations](./11-deployment-and-operations.md)
5. [Domain blueprints](./08-domain-blueprints.md)
6. [Technology and package baseline](./26-technology-package-baseline.md)

## Review remediation and executable proof

1. [Architecture review disposition](./27-architecture-review-remediation.md)
2. [Contract governance, resolution, and determinism](./28-contract-governance-and-determinism.md)
3. [Runtime security, reliability, and quality gates](./29-runtime-security-reliability-and-quality-gates.md)
4. [Executable POC gates](./30-executable-poc-gates.md)
5. [Research plan](./12-research-plan-and-poc.md)
6. [Decision register](./21-decision-register.md)
7. [Architecture Decision Records](./adr/README.md)
8. [Glossary](./22-glossary.md)
9. [External references](./references.md)

## Implementation plans

1. [Phase 0 — Contract freeze and repository readiness](./implementation/phase-0.md)

Implementation plans are execution specifications. They translate architecture gates into bounded work packages, acceptance commands, evidence requirements, and agentic-coding constraints. A phase plan does not prove completion; completion is recorded separately in a phase result document.

## Current accepted direction

| Area | Direction | Evidence |
|---|---|---|
| Product | Separate customer repositories, databases, deployments, and release cadences | design-only |
| Framework | Payload is the strategic V1 application framework | design-only |
| Database | Payload Postgres adapter; Docker Postgres locally or external `DATABASE_URL` | design-only |
| Composition | Exact packages, canonical manifest, hermetic customer config, deterministic resolved graph | schemas/fixtures added; executable gate pending |
| IDs | Hierarchical dot namespace, optional hyphen inside one segment | validator added |
| Plugin lifecycle | Schema-owning V1 plugins support disable/re-enable and explicit purge; retained-schema uninstall is not promised | design-only |
| Registration | `manifest → contracts → providers → schema → behavior → jobs → data-handlers → ui → admin → validate → freeze` | validator added |
| Data sources | Plugin-owned bounded projections behind authenticated standard gateway | design-only |
| Output contracts | Hybrid canonical/plugin-owned contracts; one source has one primary projection | design-only |
| Realtime | Socket.IO provider candidate; invalidation/refetch; outbox for durable event classes | design-only |
| Builder | Puck candidate behind engine adapter; runtime and storage remain separate | design-only |
| Themes | Small primitive ABI plus versioned complex adapters; separate admin/public profiles | design-only |
| Accessibility | WCAG 2.2 AA target for supported web surfaces | evidence pending |
| Supply chain | Exact integrity, SBOM, signed provenance, deployment receipt before production distribution | evidence pending |

## Canonical examples

```text
module.sales
module.logistics.core
module.logistics.driver
provider.realtime.socketio
builder.puck
theme.neobrutalism
sales.tasks
metric.scalar@1
```

Persisted IDs never use package paths. Package names may remain kebab-case.

## Immediate sequence

```text
Gate 0  contract freeze and docs-as-code
Gate 1  deterministic minimal Payload composition
Gate 2  source authorization and output contracts
Gate 3  outbox and realtime convergence
Gate 4  builder kill-spike
Gate 5  themes, accessibility, atomic publication
Gate 6  lifecycle and migration safety
Gate 7  second customer and verifiable fleet operations
```

Do not implement full CRM, logistics optimization, broad theme catalogs, marketplace work, or visual query languages before the relevant gate passes.
