# K-Nex Architecture Documentation

This directory records the current K-Nex product architecture, plugin/application contracts, operational model, proof-of-concept plan, accepted decisions, and unresolved questions.

The documents are implementation-oriented: each major concept should eventually map to packages, schemas, generated artifacts, contract tests, customer fixtures, or an Architecture Decision Record.

## Product in one sentence

> K-Nex is a Payload-based, manifest-driven application factory that composes versioned backend/UI plugins, plugin-owned authenticated data sources, canonical output contracts, realtime capabilities, a visual CMS/workspace builder, and installable runtime-configurable themes into independently deployed customer products.

## Reading paths

### Product and architecture overview

1. [Product vision and boundaries](./01-product-vision.md)
2. [System architecture](./02-system-architecture.md)
3. [Platform core](./03-platform-core.md)
4. [Technology and package baseline](./26-technology-package-baseline.md)
5. [Decision register](./21-decision-register.md)
6. [Glossary](./22-glossary.md)

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
6. [Data-source output contracts](./25-output-contracts.md)
7. [Technology and package baseline](./26-technology-package-baseline.md)

### Payload data, backend, and operations

1. [Payload database selection and scaffold configuration](./23-database-adapters-and-runtime-providers.md)
2. [Data, migrations, and versioning](./10-data-migrations-and-versioning.md)
3. [WebSocket and realtime](./05-websocket-and-realtime.md)
4. [Domain blueprints](./08-domain-blueprints.md)
5. [Permissions, events, actions, and jobs](./09-permissions-events-and-jobs.md)
6. [Deployment and operations](./11-deployment-and-operations.md)
7. [Security and trust boundaries](./20-security-and-trust-boundaries.md)
8. [Technology and package baseline](./26-technology-package-baseline.md)

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
| [24 — Plugin data sources and bindings](./24-data-sources-state-and-binding-graph.md) | Authenticated source endpoints, bindings, stable fields, auth, realtime invalidation |
| [25 — Data-source output contracts](./25-output-contracts.md) | Canonical/plugin-owned contracts, metric/table/series shapes, envelopes, versions, migrations |
| [26 — Technology and package baseline](./26-technology-package-baseline.md) | Conservative runtime, validation, UI, data, realtime, testing, CLI, and package-tool choices |
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
| Runtime | Node.js 24 LTS with an exact tested release pinned |
| Framework tuple | Exact Payload + Next.js + React versions from Payload-supported compatibility |
| Workspace/release | pnpm workspaces + Turborepo + Changesets |
| Backend foundation | Payload is the provisional first and intended framework foundation |
| Database integration | Select/install Payload database adapter during scaffold; no K-Nex DB provider abstraction |
| Production database | Payload Postgres adapter only in V1 |
| Local database | Docker Postgres by default; external `DATABASE_URL` also supported |
| Hosted Postgres | Neon/Supabase/RDS/etc. use the same Payload Postgres adapter and deployment guidance |
| Schema authoring | Zod 4 is the first-party TypeScript/runtime source of truth |
| Static JSON validation | JSON Schema generated from Zod and compiled with Ajv 8; no dual schema authoring |
| UI shell | Fixed shell; module-generated permission-aware navigation |
| Composable surfaces | CMS pages, dashboards, overviews, reports, scoped workspaces |
| Operational screens | Module-owned with controlled extension slots in V1 |
| Builder model | One canonical K-Nex document model; separate CMS/workspace profiles |
| Builder engine | Puck provisional first adapter; Craft.js fallback if POC fails |
| Accessible primitives | React Aria Components behind K-Nex semantic primitives; not React Spectrum styling |
| Theme model | Installed theme package plus DB-backed validated draft/published profile |
| Theme surfaces | Separate admin and public themes |
| Styling | Style-agnostic module UI + semantic primitives + CSS variables/themes + customer overrides |
| Module data | Plugins expose deliberate authenticated data-source descriptors and handlers |
| Source transport | Standard K-Nex query gateway dispatching to plugin-owned handlers |
| Payload access | Handlers use authenticated `req.payload`/domain services and preserve access controls |
| Server data/cache | TanStack Query 5 behind K-Nex source client and actor-scoped query-key policy |
| Ephemeral UI state | Scoped Zustand 5 vanilla stores; never Payload/business/server data |
| Forms | React Hook Form with Zod resolver; server always revalidates |
| Contract model | Hybrid canonical K-Nex contracts plus namespaced plugin-owned contracts |
| Source projection | One source exposes one primary output contract |
| Initial contracts | `metric.scalar@1`, `table.records@1`, `series.category@1`, `series.time@1`, `options.list@1`, `record.summary@1` |
| Contract conformance | Exact source schema must validate against declared output contract |
| Table fields | Stable opaque source field IDs; no raw nested Payload paths |
| Data-table engine | TanStack Table 8 initially behind adapter; v9 requires soak/compatibility gate |
| Virtualization | TanStack Virtual for measured large-list/table needs |
| Visualization | Apache ECharts 6 behind K-Nex adapter; raw ECharts options never enter builder documents |
| Descriptor transport | Actor-filtered descriptors separate from query responses; deterministic descriptor hash |
| Versioning | Source, output contract, descriptor hash, and package version evolve independently |
| Transformations | V1 uses purpose-built sources; future transforms are registered/versioned adapters, not expressions |
| Generic components | Counter/table/chart blocks bind by contract ID/version and descriptor constraints |
| Table customization | Builder stores selected authorized field IDs and source-declared sort/filter defaults |
| UI state | Filters/selections only; module business data remains in source endpoints |
| Realtime implementation | Socket.IO 4 is the first `realtime.gateway` provider behind K-Nex contracts |
| Realtime consistency | Authenticated invalidation/refetch by default; typed snapshot/streams only where needed |
| Jobs | Payload Jobs Queue first; external workflow/queue framework requires measured need |
| Logging | Pino structured JSON logs; pretty formatting development-only |
| Telemetry | OpenTelemetry API hooks for server traces/metrics; deployment selects SDK/exporter |
| Tests | Vitest + Testing Library + Playwright + Testcontainers PostgreSQL |
| CLI libraries | Commander + `@inquirer/prompts` + Execa + semver; native Node APIs elsewhere |
| Architecture enforcement | dependency-cruiser import/cycle rules in CI |
| Package correctness | publint + Are the Types Wrong + packed install fixtures |
| Security | Source discovery, execution, output, fields, and subscriptions are server-authorized |
| Builder code policy | No arbitrary JS, SQL, Payload query, imports, secrets, unrestricted URL/CSS |
| Runtime code install | Not allowed from admin panel |
| Plugin states | Installed, enabled/disabled, configured, uninstalled, purged are distinct |
| Migrations | Final migration history belongs to each customer repository |
| Upgrade policy | Exact customer versions; new majors require soak, compatibility, migration, and rollback proof |

## Architecture at a glance

```text
trusted plugin catalog
        │
        ▼
create-k-nex-app / k-nex CLI
        │
        ├── validates k-nex.app.json with generated schema/Ajv
        ├── selects exact Payload/Next/React/Postgres tuple
        ├── resolves K-Nex modules/providers/themes/builder
        ├── generates static plugin/UI/source/contract/theme registries
        ├── prepares Docker/environment/deployment files
        └── reports migration, UI, source, contract, theme, and security impact
                │
                ▼
customer application repository
        │
        ├── Node 24 + Payload + Next + Postgres
        ├── fixed React Aria-based semantic shell
        ├── module routes/screens/blocks
        ├── plugin-owned authenticated data-source handlers
        ├── Zod source/runtime schemas + generated JSON Schema
        ├── canonical and plugin-owned output contracts
        ├── TanStack Query source cache + scoped Zustand UI state
        ├── TanStack Table and ECharts adapters
        ├── Socket.IO realtime provider and invalidation bridge
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
  sales.total-potential-revenue → metric.scalar@1
  sales.tasks                   → table.records@1
  sales.opportunities-by-stage  → series.category@1

Builder adds Metric:
  source = sales.total-potential-revenue

Builder adds DataTable:
  source  = sales.tasks
  columns = title, status, dueAt, assignee

Builder adds PieChart:
  source = sales.opportunities-by-stage

Authenticated runtime:
  executes plugin handlers through K-Nex gateway
  validates exact Zod source schema + canonical output contract
  enforces permission/record/field policy
  caches through actor-scoped TanStack Query keys

Sales mutation commits:
  Socket.IO provider sends authorized invalidation
  active components refetch through authenticated endpoint
  selected theme renders updated results
```

The stored layout contains source/contract IDs, major versions, validated parameters, selected stable field IDs, and bindings—not live records or executable query/library configuration.

## Documentation conventions

The package scope `@k-nex/*` is conceptual until registry ownership is finalized.

Stable persisted identities use product IDs rather than package paths:

```text
module.sales
provider.realtime.socketio
realtime.gateway
sales.total-potential-revenue
sales.tasks
metric.scalar@1
table.records@1
core.data-table
page.filters.date-range
```

Important distinctions:

- **K-Nex plugin:** installable K-Nex package participating in composition;
- **module:** business/horizontal plugin such as Sales, CMS, or Dispatch;
- **provider:** genuinely replaceable infrastructure capability such as realtime or storage;
- **Payload database adapter:** framework dependency selected at scaffold time, not a K-Nex provider;
- **data source:** plugin-owned authenticated query/projection;
- **output contract:** reusable versioned semantic result shape;
- **source-specific output schema:** exact schema for one source implementing its declared contract;
- **UI state:** typed filter/selection/coordination value, not module data;
- **implementation adapter:** package hiding TanStack, ECharts, Socket.IO, Puck, or React Aria details behind K-Nex contracts;
- **Payload plugin:** framework-level Payload config transformer that a K-Nex plugin may contribute internally.

## Decision discipline

- Check the [decision register](./21-decision-register.md), [technology baseline](./26-technology-package-baseline.md), and [ADRs](./adr/README.md) before treating a direction as final.
- Accepted decisions should be implemented unless explicitly changed.
- Provisional decisions require the named POC evidence.
- Open decisions include a recommendation and trigger.
- Consequential changes should add or supersede an ADR.

## Immediate next proof

```text
exact Node/Payload/Next/React/Postgres scaffold
  → pnpm/Turbo workspace and package checks
  → Zod schemas + generated JSON Schema + Ajv validation
  → static module/UI/source/contract/theme registries
  → Payload boot and customer migration
  → React Aria semantic shell + Sales navigation
  → metric.scalar Counter
  → table.records DataTable through TanStack Table adapter
  → category/time-series charts through ECharts adapter
  → Payload-authenticated source execution
  → actor-scoped TanStack Query cache
  → scoped Zustand page filters
  → Socket.IO invalidation and authoritative refetch
  → one CMS page + one workspace dashboard
  → two installed themes
  → Vitest/Playwright/Testcontainers/dependency-boundary proof
  → two independent customer repositories
```
