# K-Nex Architecture Documentation

K-Nex is a Payload/PostgreSQL application factory with two extension-delivery paths:

```text
Platform Plugins  static deep integration, zero-downtime Docker release when eligible
Hot Applications  isolated signed bundles, live generation activation
Theme Skins       data-only visual bundles, live generation activation
```

Gates 0–8 are accepted. Phase 9 builds the dynamic application runtime and no-outage delivery substrate; Phase 10 adds central RBAC and customer-operated extension lifecycle.

## Normative order

1. `contracts/architecture-contracts.v1.json`
2. generated versioned schemas
3. canonical fixtures
4. accepted ADR plus evidence registry
5. architecture documents
6. implementation plans
7. illustrative snippets

A plan or ADR at `design-only` is direction, not executable evidence.

## Start here

- [Product vision and boundaries](./01-product-vision.md)
- [System architecture](./02-system-architecture.md)
- [Platform core and runtime boundary](./03-platform-core.md)
- [Module and extension system](./04-module-system.md)
- [Dynamic applications and zero-downtime delivery](./35-dynamic-applications-and-zero-downtime-delivery.md)
- [Deployment and operations](./11-deployment-and-operations.md)
- [Security and trust boundaries](./20-security-and-trust-boundaries.md)
- [Decision register](./21-decision-register.md)

## Execution

- [Master execution plan](./implementation/codex-master-plan.md)
- [Phase 9 — Dynamic Application Runtime](./implementation/phase-9-dynamic-application-runtime.md)
- [Phase 10 — RBAC and Extension Bootstrap](./implementation/phase-10-rbac-and-authorization-control-plane.md)
- [Executable gates](./30-executable-poc-gates.md)
- [`status.md`](../status.md)
- [`AGENTS.md`](../AGENTS.md)

## Foundation history

- [Phase 0 plan](./implementation/phase-0.md)
- [Historical Gates 1–5 task catalog](./implementation/phase-details-gates-1-7.md)
- [Phase 2A agent tools](./implementation/phase-2a-agent-tools.md)
- [Gates 6–8 task catalog](./implementation/phase-details-gates-6-8.md)
- [Plugin platform and Sales reference](./33-plugin-platform-hardening-and-reference-sales.md)
- [Headless component system](./34-headless-component-system.md)

## Plugins, applications, and lifecycle

- [Plugin taxonomy and capabilities](./13-plugin-taxonomy-and-capabilities.md)
- [Plugin authoring](./plugin-authoring.md)
- [Application manifest](./14-application-manifest.md)
- [CLI and project generation](./15-cli-and-project-generation.md)
- [Plugin lifecycle and package management](./19-plugin-lifecycle-and-package-management.md)
- [Data migrations and versioning](./10-data-migrations-and-versioning.md)
- [Official Payload plugin adoption](./32-payload-official-plugin-adoption-plan.md)

## UI, builder, and themes

- [CMS and page builder](./07-cms-and-page-builder.md)
- [UI composition runtime](./16-ui-composition-runtime.md)
- [Builder engine and profiles](./17-builder-engine-and-profiles.md)
- [Theme and design system](./18-theme-and-design-system.md)
- [Data sources and binding graph](./24-data-sources-state-and-binding-graph.md)
- [Output contracts](./25-output-contracts.md)

## Runtime, agents, and operations

- [Permissions, events, actions, and jobs](./09-permissions-events-and-jobs.md)
- [Agent tools and AI control plane](./31-agent-tools-and-ai-control-plane.md)
- [Realtime](./05-websocket-and-realtime.md)
- [Customer applications](./06-customer-applications.md)
- [Technology baseline](./26-technology-package-baseline.md)
- [Domain blueprints — deferred](./08-domain-blueprints.md)

## ADRs

- [ADR index](./adr/README.md)
- [ADR-0021 Dynamic Applications and Zero-Downtime Delivery](./adr/0021-dynamic-application-runtime-and-zero-downtime-delivery.md)
- [ADR-0022 RBAC and Extension Role Templates](./adr/0022-rbac-authorization-and-extension-role-templates.md)
- [Machine-readable evidence registry](./adr/evidence-registry.json)

## Current sequence

```text
Gate 8   accepted platform foundation
Gate 9   hot applications, theme skins, zero-downtime Platform Plugin delivery
Gate 10  RBAC, role templates, extension administration authority
next     system settings, full catalog/deployment operations productization
then     separately selected CRM/CMS product breadth
```
