# K-Nex Architecture Documentation

This directory records the current K-Nex product architecture, plugin/application contracts, operational model, proof-of-concept plan, accepted decisions, and unresolved questions.

The documents are implementation-oriented: each major concept should eventually map to packages, schemas, generated artifacts, contract tests, customer application fixtures, or an Architecture Decision Record.

## Product in one sentence

> K-Nex is a manifest-driven application factory that composes versioned backend/UI plugins, infrastructure providers, a visual CMS/workspace builder, and installable runtime-configurable themes into independently deployed customer products.

## Reading paths

### Product and architecture overview

1. [Product vision and boundaries](./01-product-vision.md)
2. [System architecture](./02-system-architecture.md)
3. [Platform core](./03-platform-core.md)
4. [Decision register](./21-decision-register.md)
5. [Glossary](./22-glossary.md)

### Plugin and customer application model

1. [Module system](./04-module-system.md)
2. [Plugin taxonomy and capabilities](./13-plugin-taxonomy-and-capabilities.md)
3. [Application manifest](./14-application-manifest.md)
4. [CLI and project generation](./15-cli-and-project-generation.md)
5. [Customer applications](./06-customer-applications.md)
6. [Plugin lifecycle and package management](./19-plugin-lifecycle-and-package-management.md)

### UI, builder, and theme model

1. [CMS and page builder](./07-cms-and-page-builder.md)
2. [UI composition runtime](./16-ui-composition-runtime.md)
3. [Builder engine and profiles](./17-builder-engine-and-profiles.md)
4. [Theme and design system](./18-theme-and-design-system.md)

### Backend and operations

1. [WebSocket and realtime](./05-websocket-and-realtime.md)
2. [Domain blueprints](./08-domain-blueprints.md)
3. [Permissions, events, and jobs](./09-permissions-events-and-jobs.md)
4. [Data, migrations, and versioning](./10-data-migrations-and-versioning.md)
5. [Deployment and operations](./11-deployment-and-operations.md)
6. [Security and trust boundaries](./20-security-and-trust-boundaries.md)

### Research and decisions

1. [Research plan and proof of concept](./12-research-plan-and-poc.md)
2. [Decision register](./21-decision-register.md)
3. [Architecture Decision Records](./adr/README.md)
4. [External references](./references.md)

## Complete document index

| Document | Purpose |
|---|---|
| [01 — Product vision](./01-product-vision.md) | Product-line model, boundaries, customer ownership, success criteria |
| [02 — System architecture](./02-system-architecture.md) | Layers, package ecosystem, generated customer applications, runtime topology |
| [03 — Platform core](./03-platform-core.md) | Domain-neutral core responsibilities and APIs |
| [04 — Module system](./04-module-system.md) | Reusable module contract and registration lifecycle |
| [05 — WebSocket and realtime](./05-websocket-and-realtime.md) | Realtime capability, channels, authorization, delivery semantics |
| [06 — Customer applications](./06-customer-applications.md) | Separate repositories, composition root, extensions, customer ownership |
| [07 — CMS and page builder](./07-cms-and-page-builder.md) | CMS lifecycle and visual page composition |
| [08 — Domain blueprints](./08-domain-blueprints.md) | Logistics and restaurant module boundaries/invariants |
| [09 — Permissions, events, and jobs](./09-permissions-events-and-jobs.md) | Cross-module security and asynchronous collaboration contracts |
| [10 — Data, migrations, and versioning](./10-data-migrations-and-versioning.md) | Customer-owned final migrations and package/data evolution |
| [11 — Deployment and operations](./11-deployment-and-operations.md) | Independent customer runtime, CI/CD, backups, fleet inventory |
| [12 — Research plan and POC](./12-research-plan-and-poc.md) | Phases, deliberate failures, and acceptance/rejection criteria |
| [13 — Plugin taxonomy and capabilities](./13-plugin-taxonomy-and-capabilities.md) | Plugin kinds, static manifests, capability resolution, catalog |
| [14 — Application manifest](./14-application-manifest.md) | `k-nex.app.json`, `k-nex.config.ts`, generated registries, validation |
| [15 — CLI and project generation](./15-cli-and-project-generation.md) | `create-k-nex-app`, plan/apply commands, scaffolding, Docker, secrets |
| [16 — UI composition runtime](./16-ui-composition-runtime.md) | Fixed shell, UI contributions, blocks, data/actions, scoped layouts |
| [17 — Builder engine and profiles](./17-builder-engine-and-profiles.md) | Shared CMS/workspace builder model and Puck evaluation |
| [18 — Theme and design system](./18-theme-and-design-system.md) | Installable theme packages, runtime profiles, tokens, primitives |
| [19 — Plugin lifecycle](./19-plugin-lifecycle-and-package-management.md) | Install, enable, disable, upgrade, uninstall, purge, panel boundaries |
| [20 — Security and trust boundaries](./20-security-and-trust-boundaries.md) | Package, CLI, builder, theme, public/private, realtime security model |
| [21 — Decision register](./21-decision-register.md) | Accepted, provisional, open, and rejected decisions |
| [22 — Glossary](./22-glossary.md) | Canonical terminology |
| [ADRs](./adr/README.md) | Consequential architecture decisions and rationale |
| [References](./references.md) | Primary implementation-candidate references |

## Current decision summary

| Area | Current decision |
|---|---|
| Product model | Independently deployed customer products, not shared multi-tenant SaaS |
| Customer source | Generated separate repository; no copied/patched core source |
| Shared code | Exact-version core and plugin packages |
| Installable taxonomy | Module, provider, builder, theme, integration, preset |
| Dependency model | Stable plugin IDs plus versioned replaceable capabilities |
| Composition source | `k-nex.app.json` plus `k-nex.config.ts` |
| Project tooling | `create-k-nex-app` and `k-nex` plan/apply CLI |
| Generated code | Static registries committed in V1 and checked in CI |
| Backend foundation | Payload is the provisional first implementation candidate |
| Production database | Postgres; local default is Docker Postgres |
| UI shell | Fixed shell; module-generated permission-aware navigation |
| Composable surfaces | CMS pages, dashboards, overviews, reports, scoped workspaces |
| Operational screens | Module-owned with controlled extension slots in V1 |
| Builder model | One canonical K-Nex model, separate CMS/workspace profiles |
| Builder engine | Puck provisional first adapter; Craft.js fallback if POC fails |
| Theme model | Installed code package plus DB-backed validated draft/published profile |
| Theme surfaces | Separate admin and public themes |
| Styling | Style-agnostic module UI + semantic primitives + theme + customer overrides |
| Runtime code install | Not allowed from admin panel |
| Plugin states | Installed, enabled/disabled, configured, uninstalled, purged are distinct |
| Migrations | Final migration history belongs to each customer repository |
| Realtime | Capability provider; driver requires `realtime.gateway` |
| Security | Server authorization; no arbitrary builder JS/SQL/imports/secrets/CSS |

## Architecture at a glance

```text
trusted plugin catalog
        │
        ▼
create-k-nex-app / k-nex CLI
        │
        ├── validates k-nex.app.json
        ├── resolves capabilities and providers
        ├── installs exact packages
        ├── generates static registries
        ├── prepares local/production infrastructure files
        └── reports migration, UI, theme, and security impact
                │
                ▼
customer application repository
        │
        ├── Payload/backend composition
        ├── fixed application shell
        ├── module UI contributions
        ├── CMS/workspace builder profiles
        ├── installed theme packages
        ├── DB-backed theme/layout/content revisions
        ├── customer extensions and overrides
        └── customer-owned migrations/deployment
                │
                ▼
independent customer runtime
```

## Documentation conventions

The package scope `@k-nex/*` is conceptual until registry ownership is finalized.

Stable persisted identities use plugin/capability/block IDs rather than package paths:

```text
module.crm
provider.realtime-websocket-local
realtime.gateway
crm.pipeline-summary
```

The terms **plugin**, **module**, and **Payload plugin** are not synonyms:

- a **K-Nex plugin** is any installable K-Nex package participating in composition;
- a **module** is a plugin kind implementing business/horizontal capability;
- a K-Nex plugin may internally contribute one or more **Payload plugins**.

Code examples are architectural drafts until implemented and covered by contract/integration tests.

## Decision discipline

- Check the [decision register](./21-decision-register.md) before treating a direction as final.
- Accepted decisions should be implemented unless explicitly changed.
- Provisional decisions require the named POC evidence.
- Open decisions include a recommendation and trigger; do not block unrelated work indefinitely.
- Consequential changes should add or supersede an [ADR](./adr/README.md).

## Immediate next step

Resolve the Phase 0 open decisions in the decision register—repository topology, private package registry/scope, and initial semantic primitive foundation—then implement the smallest POC proving:

```text
manifest → dependency resolution → static registry → Payload boot
     → fixed shell + module navigation
     → one CMS page + one workspace dashboard
     → two installed themes
     → separate cargo and restaurant customer repositories
```
