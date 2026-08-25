# K-Nex Architecture Documentation

This directory records the current K-Nex product architecture, plugin/application contracts, operational model, proof-of-concept plan, accepted decisions, and unresolved questions.

The documents are implementation-oriented: each major concept should eventually map to packages, schemas, generated artifacts, contract tests, customer fixtures, or an Architecture Decision Record.

## Product in one sentence

> K-Nex is a Payload-based, manifest-driven application factory that composes versioned backend/UI plugins, plugin-owned authenticated data sources, realtime capabilities, a visual CMS/workspace builder, and installable runtime-configurable themes into independently deployed customer products.

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
6. [Plugin lifecycle](./19-plugin-lifecycle-and-package-management.md)

### UI, builder, themes, and dynamic data

1. [CMS and page builder](./07-cms-and-page-builder.md)
2. [UI composition runtime](./16-ui-composition-runtime.md)
3. [Builder engine and profiles](./17-builder-engine-and-profiles.md)
4. [Theme and design system](./18-theme-and-design-system.md)
5. [Plugin data sources, bindings, and realtime invalidation](./24-data-sources-state-and-binding-graph.md)

### Payload data, backend, and operations

1. [Payload database selection and scaffold configuration](./23-database-adapters-and-runtime-providers.md)
2. [Data, migrations, and versioning](./10-data-migrations-and-versioning.md)
3. [WebSocket and realtime](./05-websocket-and-realtime.md)
4. [Domain blueprints](./08-domain-blueprints.md)
5. [Permissions, events, actions, and jobs](./09-permissions-events-and-jobs.md)
6. [Deployment and operations](./11-deployment-and-operations.md)
7. [Security and trust boundaries](./20-security-and-trust-boundaries.md)

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
| [09 — Permissions, events, actions, and jobs](./09-permissions-events-and-jobs.md) | Security, commands/queries, domain events, jobs/workflows |
| [10 — Data, migrations, and versioning](./10-data-migrations-and-versioning.md) | Customer-owned final migrations and package/data evolution |
| [11 — Deployment and operations](./11-deployment-and-operations.md) | Independent customer runtime, CI/CD, backups, fleet inventory |
| [12 — Research plan and POC](./12-research-plan-and-poc.md) | Phases, deliberate failures, acceptance/rejection criteria |
| [13 — Plugin taxonomy and capabilities](./13-plugin-taxonomy-and-capabilities.md) | Plugin kinds, static manifests, capability resolution, catalog |
| [14 — Application manifest](./14-application-manifest.md) | `k-nex.app.json`, `k-nex.config.ts`, framework/scaffold settings, registries |
| [15 — CLI and project generation](./15-cli-and-project-generation.md) | `create-k-nex-app`, plan/apply, Payload setup, Docker, secrets |
| [16 — UI composition runtime](./16-ui-composition-runtime.md) | Fixed shell, UI contributions, blocks, data/actions, scoped layouts |
| [17 — Builder engine and profiles](./17-builder-engine-and-profiles.md) | Shared CMS/workspace builder model and Puck evaluation |
| [18 — Theme and design system](./18-theme-and-design-system.md) | Installable theme packages, runtime profiles, tokens, primitives |
| [19 — Plugin lifecycle](./19-plugin-lifecycle-and-package-management.md) | Install, enable, disable, upgrade, uninstall, purge, panel boundaries |
| [20 — Security and trust boundaries](./20-security-and-trust-boundaries.md) | Package, CLI, builder, theme, public/private, realtime security |
| [21 — Decision register](./21-decision-register.md) | Accepted, provisional, open, superseded, and rejected decisions |
| [22 — Glossary](./22-glossary.md) | Canonical terminology |
| [23 — Payload database selection](./23-database-adapters-and-runtime-providers.md) | Scaffold-time Payload adapter selection, Postgres, environment, migrations |
| [24 — Plugin data sources and bindings](./24-data-sources-state-and-binding-graph.md) | Authenticated source endpoints, counter/table/chart binding, fields, realtime invalidation |
| [ADRs](./adr/README.md) | Consequential architecture decisions and rationale |
| [References](./references.md) | Primary implementation-candidate references |

## Current decision summary

| Area | Current decision |
|---|---|
| Product model | Independently deployed customer products, not shared multi-tenant SaaS |
| Customer source | Generated separate repository; no copied/patched core source |
| Shared code | Exact-version core and plugin packages |
| Installable taxonomy | Module, provider, builder, theme, integration, preset |
| Dependency model | Stable plugin IDs plus capabilities for genuinely replaceable services |
| Composition source | `k-nex.app.json` plus `k-nex.config.ts` |
| Project tooling | `create-k-nex-app` and `k-nex` plan/apply CLI |
| Generated code | Static registries committed in V1 and checked in CI |
| Backend foundation | Payload is the provisional first and intended framework foundation |
| Database integration | Select/install Payload database adapter during scaffold; no K-Nex DB provider abstraction |
| Production database | Payload Postgres adapter only in V1 |
| Local database | Docker Postgres by default; external `DATABASE_URL` also supported |
| Hosted Postgres | Neon/Supabase/RDS/etc. use the same Payload Postgres adapter and deployment guidance |
| UI shell | Fixed shell; module-generated permission-aware navigation |
| Composable surfaces | CMS pages, dashboards, overviews, reports, scoped workspaces |
| Operational screens | Module-owned with controlled extension slots in V1 |
| Builder model | One canonical K-Nex document model; separate CMS/workspace profiles |
| Builder engine | Puck provisional first adapter; Craft.js fallback if POC fails |
| Theme model | Installed theme package plus DB-backed validated draft/published profile |
| Theme surfaces | Separate admin and public themes |
| Styling | Style-agnostic module UI + semantic primitives + themes + customer overrides |
| Module data | Plugins expose deliberate authenticated data-source descriptors and handlers |
| Source transport | Recommended standard K-Nex query gateway dispatching to plugin-owned handlers |
| Payload access | Handlers use authenticated `req.payload`/domain services and preserve access controls |
| Generic components | Counter/table/chart blocks bind to source output contracts and declared fields |
| Table customization | Source declares fields; builder stores selected visible columns/sort/filter defaults |
| UI state | Filters/selections only; module business data remains in source endpoints |
| Realtime | Authenticated WebSocket invalidation/refetch by default; typed streams only where needed |
| Security | Source discovery, execution, fields, and subscriptions are server-authorized |
| Builder code policy | No arbitrary JS, SQL, Payload query, imports, secrets, unrestricted URL/CSS |
| Runtime code install | Not allowed from admin panel |
| Plugin states | Installed, enabled/disabled, configured, uninstalled, purged are distinct |
| Migrations | Final migration history belongs to each customer repository |

## Architecture at a glance

```text
trusted plugin catalog
        │
        ▼
create-k-nex-app / k-nex CLI
        │
        ├── validates k-nex.app.json
        ├── selects and installs Payload Postgres adapter
        ├── resolves K-Nex modules/providers/themes/builder
        ├── generates static registries and Payload composition
        ├── prepares Docker/environment/deployment files
        └── reports migration, UI, source, theme, and security impact
                │
                ▼
customer application repository
        │
        ├── Payload + Postgres configuration
        ├── fixed application shell
        ├── module routes/screens/blocks
        ├── plugin-owned authenticated data-source handlers
        ├── standard source gateway and realtime invalidation bridge
        ├── CMS/workspace builder profiles
        ├── installed theme packages and DB profiles
        ├── customer extensions/overrides
        └── customer-owned migrations/deployment
                │
                ▼
independent customer runtime
```

## Example dynamic UI flow

```text
Sales module registers:
  sales.total-opportunities
  sales.tasks

Builder adds Counter:
  source = sales.total-opportunities
  field  = value

Builder adds DataTable:
  source  = sales.tasks
  columns = title, status, dueAt, assignee.name

Authenticated runtime:
  executes plugin handler through K-Nex gateway
  handler queries with req.payload
  permission/record/field policy is enforced

Sales mutation commits:
  realtime invalidates sales.tasks
  active table refetches through authenticated endpoint
  selected theme renders updated table
```

The stored layout contains source IDs, versions, parameters, field selections, and bindings—not live records or executable query code.

## Documentation conventions

The package scope `@k-nex/*` is conceptual until registry ownership is finalized.

Stable persisted identities use product IDs rather than package paths:

```text
module.sales
provider.realtime-websocket-local
realtime.gateway
sales.total-opportunities
sales.tasks
core.data-table
page.filters.date-range
```

Important distinctions:

- **K-Nex plugin:** installable K-Nex package participating in composition;
- **module:** business/horizontal plugin such as Sales, CMS, or Dispatch;
- **provider:** genuinely replaceable infrastructure capability such as realtime or storage;
- **Payload database adapter:** framework dependency selected at scaffold time, not a K-Nex provider;
- **data source:** plugin-owned authenticated query/projection contract;
- **UI state:** typed filter/selection/coordination value, not module data;
- **Payload plugin:** framework-level Payload config transformer that a K-Nex plugin may contribute internally.

## Decision discipline

- Check the [decision register](./21-decision-register.md) and [ADRs](./adr/README.md) before treating a direction as final.
- Accepted decisions should be implemented unless explicitly changed.
- Provisional decisions require the named POC evidence.
- Open decisions include a recommendation and trigger.
- Consequential changes should add or supersede an ADR.

## Immediate next proof

```text
manifest
  → Payload Postgres scaffold
  → static module/UI/source/theme registries
  → Payload boot and customer migration
  → fixed shell + Sales navigation
  → sales.total-opportunities Counter
  → sales.tasks DataTable with selectable columns
  → Payload-authenticated source execution
  → WebSocket invalidation and refetch
  → one CMS page + one workspace dashboard
  → two installed themes
  → two independent customer repositories
```
