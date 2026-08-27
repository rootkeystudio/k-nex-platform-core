# K-Nex Architecture Documentation

K-Nex is a Payload-based, manifest-driven application factory that composes trusted backend/UI plugins, authenticated data sources, output contracts, agent-tool capabilities, realtime infrastructure, visual CMS/workspace composition, and runtime-configurable installed themes into independently deployed customer products.

The foundation program deliberately uses `module.sales` as its sole first-party reference domain plugin. New logistics, restaurant, inventory, budgeting, and similar modules are deferred until the plugin platform, component system, lifecycle, and customer-application factory gates pass.

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

## Composition, plugins, and lifecycle

1. [Plugin authoring quick start and tested examples](./plugin-authoring.md)
2. [Plugin taxonomy and capabilities](./13-plugin-taxonomy-and-capabilities.md)
3. [Plugin platform hardening and Sales reference](./33-plugin-platform-hardening-and-reference-sales.md)
4. [Official Payload plugin adoption plan](./32-payload-official-plugin-adoption-plan.md)
5. [Application manifest](./14-application-manifest.md)
6. [CLI and project generation](./15-cli-and-project-generation.md)
7. [Plugin lifecycle](./19-plugin-lifecycle-and-package-management.md)
8. [Data, migrations, and versioning](./10-data-migrations-and-versioning.md)
9. [Payload database selection](./23-database-adapters-and-runtime-providers.md)

## UI, components, builder, themes, and dynamic data

1. [Headless component system and data experience](./34-headless-component-system.md)
2. [CMS and page builder](./07-cms-and-page-builder.md)
3. [UI composition runtime](./16-ui-composition-runtime.md)
4. [Builder engine and profiles](./17-builder-engine-and-profiles.md)
5. [Theme and design system](./18-theme-and-design-system.md)
6. [Plugin data sources and bindings](./24-data-sources-state-and-binding-graph.md)
7. [Data-source output contracts](./25-output-contracts.md)

## Runtime, agents, security, and operations

1. [Permissions, events, actions, and jobs](./09-permissions-events-and-jobs.md)
2. [Agent tools and AI control plane](./31-agent-tools-and-ai-control-plane.md)
3. [Realtime capability](./05-websocket-and-realtime.md)
4. [Security and trust boundaries](./20-security-and-trust-boundaries.md)
5. [Deployment and operations](./11-deployment-and-operations.md)
6. [Domain blueprints](./08-domain-blueprints.md)
7. [Technology and package baseline](./26-technology-package-baseline.md)

Domain blueprints are deferred product context. They do not authorize implementation before Gate 8.

## Review remediation and executable proof

1. [Architecture review disposition](./27-architecture-review-remediation.md)
2. [Contract governance, resolution, and determinism](./28-contract-governance-and-determinism.md)
3. [Runtime security, reliability, and quality gates](./29-runtime-security-reliability-and-quality-gates.md)
4. [Executable gates](./30-executable-poc-gates.md)
5. [Research plan](./12-research-plan-and-poc.md)
6. [Decision register](./21-decision-register.md)
7. [Architecture Decision Records](./adr/README.md)
8. [Glossary](./22-glossary.md)
9. [External references](./references.md)

## Implementation plans

1. [Codex master execution plan](./implementation/codex-master-plan.md)
2. [Phase 0 — Contract freeze and repository readiness](./implementation/phase-0.md)
3. [Phase 2A — Agent tool contracts and safe execution](./implementation/phase-2a-agent-tools.md)
4. [Historical Gates 1–5 task catalog](./implementation/phase-details-gates-1-7.md)
5. [Authoritative future Gates 6–8 task catalog](./implementation/phase-details-gates-6-8.md)

The old future Gate 6–7 sections in `phase-details-gates-1-7.md` are superseded. Future execution uses `phase-details-gates-6-8.md`.

Implementation plans are execution specifications. A phase plan does not prove completion; completion is recorded separately in a phase result document.

## Current accepted direction

| Area | Direction | Evidence |
|---|---|---|
| Product | Separate customer repositories, databases, deployments, and release cadences | design-only |
| Framework | Payload is the strategic V1 application framework | executable foundation |
| Database | Payload Postgres adapter; Docker Postgres locally or external `DATABASE_URL` | executable foundation |
| Composition | Exact packages, canonical manifest, deterministic resolved graph/registries | executable-poc |
| IDs | Hierarchical dot namespace, optional hyphen inside one segment | executable-poc for current pre-v1 grammar |
| Reference plugin | `module.sales` is the only first-party domain module until Gate 8 | design-only |
| Plugin authoring | Sales exercises every supported contribution category and passes one conformance suite | executable-poc |
| Official Payload plugins | Gate-scoped bounded adapters; no automatic catalog install or contract ownership | bounded MCP subset executable; broader policy design-only |
| Plugin lifecycle | Schema-owning V1 plugins prove disable/re-enable now; upgrade, archive/export, purge, backup, and restore remain Gate 8 | partial executable evidence |
| Registration | `manifest → contracts → providers → schema → behavior → jobs → data-handlers → ui → admin → validate → freeze` | executable-poc |
| Data sources | Plugin-owned bounded projections behind authenticated gateway | executable-poc |
| Agent tools | Explicit source/action-backed tools; MCP is an adapter | executable-poc |
| Realtime | Transactional outbox plus supported Socket.IO memory topology and convergence | executable-poc |
| Builder | Puck behind canonical engine adapter; runtime/storage remain separate | executable-poc |
| Themes | Small stable primitive ABI plus strict runtime profiles | executable-poc |
| Atomic CMS publication | Revisioned page/document pairs, rollback, idempotency, and current-policy validation | executable-poc |
| Components | Comprehensive platform-owned headless component system; themes style, not reimplement behavior | design-only |
| Accessibility | WCAG 2.2 AA target for supported surfaces | partial executable evidence |
| Application factory | `create-knex-app`, lifecycle, release/fleet proof in Gate 8 | design-only |
| Supply chain | Exact integrity, SBOM, signed provenance, deployment receipt before production distribution | evidence pending |

## Canonical examples

```text
module.sales
provider.realtime.socketio
builder.puck
theme.minimal
theme.neobrutalism
sales.tasks
sales.tools.create-task
sales.page.overview
sales.table.tasks
metric.scalar@1
table.records@1
```

Persisted IDs never use package paths. Package names may remain kebab-case.

## Immediate sequence

```text
Gate 0   contract freeze and docs-as-code                         complete
Gate 1   deterministic minimal Payload composition               complete
Gate 2   source authorization and output contracts               complete
Gate 2A  agent tools and safe MCP execution                      complete
Gate 3   outbox and realtime convergence                         complete
Gate 4   builder kill-spike                                      complete
Gate 5   themes, accessibility, atomic publication               complete
Gate 6   plugin platform hardening + complete Sales reference    complete
Gate 7   comprehensive headless component/data/form/page system active
Gate 8   lifecycle + create-knex-app + release/fleet safety
```

Do not implement another first-party domain module before Gate 8. Missing capabilities are solved in the platform and exercised through Sales.
