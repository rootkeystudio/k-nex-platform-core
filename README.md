# K-Nex Platform Core

K-Nex is a modular application platform for repeatedly delivering independently deployed, customer-specific CMS, CRM, operations, analytics, and vertical business products.

It combines:

```text
Payload as the application/backend foundation
+ versioned K-Nex platform contracts and plugins
+ a manifest-driven CLI
+ style-agnostic module UI
+ plugin-owned authenticated data sources
+ canonical and plugin-owned output contracts
+ realtime invalidation and selected live streams
+ visual CMS/workspace composition
+ installed theme packages and runtime theme profiles
+ customer-owned code, migrations, and infrastructure
= an independently deployable customer product
```

K-Nex is **not** initially designed as a shared multi-tenant SaaS. Every customer application has its own repository, database, storage boundary, secrets, deployment, migration history, visual language, and release cadence.

## Core product model

Shared code is delivered as trusted, exact-version packages:

```text
@k-nex/core
@k-nex/module-*
@k-nex/provider-*
@k-nex/builder-*
@k-nex/theme-*
@k-nex/integration-*
```

A customer repository is generated and maintained through:

```text
create-k-nex-app
k-nex.app.json
k-nex.config.ts
k-nex CLI
```

The customer repository owns final composition, brand assets, customer extensions, generated registries, database migrations, tests, deployment, and infrastructure.

## Payload and database model

K-Nex is intentionally built on Payload. It does not wrap Payload with a second database-provider or ORM abstraction.

During scaffold generation:

```text
create-k-nex-app
  → selects a Payload database adapter
  → installs the selected @payloadcms/db-* package
  → generates Payload database configuration
  → optionally generates local Docker infrastructure
```

V1 supports:

```text
Payload Postgres adapter
local Docker Postgres
external/managed Postgres through DATABASE_URL
```

Hosted services such as Neon use the same Payload Postgres adapter and deployment-specific connection guidance. They are not separate K-Nex persistence plugins.

Modules query through authenticated Payload request/application APIs such as `req.payload` and through their domain services. Every customer repository owns its final migration history.

## Plugin model

**Plugin** is the umbrella installable K-Nex concept:

| Kind | Examples |
|---|---|
| Module | CMS, Sales/CRM, visualization, dispatch, driver, inventory, budgeting |
| Provider | WebSocket, Redis-backed realtime, object storage, email, queue, maps |
| Builder | Puck adapter |
| Theme | Minimal, Neobrutalism, Glassmorphism |
| Integration | CRM–logistics, inventory–budgeting, ERP connectors |
| Preset | Logistics, restaurant, corporate CMS+CRM recipes |

Dependencies can target stable plugin IDs or replaceable versioned capabilities such as:

```text
realtime.gateway
storage.objects
email.delivery
builder.engine
```

The primary Payload database adapter is a framework/scaffold choice, not a K-Nex provider capability.

## UI and builder model

Enabled modules can contribute:

```text
navigation
fixed operational screens
composable blocks
data-source descriptors and handlers
canonical or plugin-owned output contracts
UI state definitions
runtime context definitions
actions
realtime invalidation metadata
extension slots
```

Module UI is style-agnostic. Customer appearance is provided through semantic design-system contracts, installed theme packages, runtime theme profiles, and deliberate customer overrides.

The application shell remains fixed and permission-aware. Its navigation is generated from enabled modules. The editable canvas supports two initial profiles using one canonical K-Nex document model:

- **CMS profile:** public content pages, SEO/localization, draft/preview/publish, public-safe blocks and data sources;
- **Workspace profile:** dashboards, module overviews, reports, role/user layouts, authenticated data/actions, filters/state, and realtime blocks.

Puck is the provisional first editor engine behind `@k-nex/builder-puck`. Domain modules do not depend on Puck types.

## Plugin-owned data sources

Modules deliberately expose bounded server projections rather than automatically exposing their Payload collections.

A Sales module can register:

```text
sales.total-potential-revenue → metric.scalar@1
sales.tasks                   → table.records@1
sales.opportunities-by-stage  → series.category@1
sales.revenue-over-time       → series.time@1
```

A source owns:

```text
stable ID and major version
plugin ownership
display metadata
allowed surfaces/audiences
required permission
input schema
one primary output contract
exact source-specific output schema
stable fields and table capabilities
pagination/sort/filter policy
cache and realtime policy
server handler using req.payload/domain services
```

The recommended transport is a standard K-Nex gateway dispatching to plugin-owned handlers:

```text
GET  /api/k-nex/data-sources
POST /api/k-nex/data-sources/:sourceId/query
```

Workspace/admin sources require Payload authentication plus source permission, record policy, and field-level policy. Public pages use separate explicitly public-safe source IDs.

## Output contract model

Generic components consume a small K-Nex-owned catalog:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

Complex domain blocks can use namespaced plugin-owned contracts such as:

```text
sales.pipeline-board@1
logistics.dispatch-board@1
```

Core rules:

```text
one source → one primary output projection
source-specific output schema must validate against its contract
table fields are stable opaque IDs, not nested Payload paths
descriptors are fetched/cached separately from query results
source/contract/package versions evolve independently
canonical payloads have no unrestricted extension bag
future transformations are registered/versioned adapters
```

## Metric, table, and chart example

A page editor can add a Metric and bind the complete semantic result to:

```text
Sales → Total potential revenue
source:   sales.total-potential-revenue@1
contract: metric.scalar@1
```

A DataTable can bind to:

```text
Sales → Tasks
source:   sales.tasks@1
contract: table.records@1
columns:
  title
  status
  dueAt
  assignee
```

The source descriptor declares stable fields, labels/types, nullability, permissions, sorting, filtering, and pagination. The layout stores selected stable field IDs—not `assignee.name` or another raw Payload object path.

Charts bind to purpose-built server aggregates:

```text
PieChart  ← sales.opportunities-by-stage  → series.category@1
LineChart ← sales.revenue-over-time       → series.time@1
```

The layout never stores SQL, Payload queries, arbitrary URLs, executable code, raw data snapshots, or visual group-by expressions.

## Realtime behavior

Ordinary counters, tables, and charts use authenticated invalidation/refetch:

```text
Sales mutation commits
  → Sales invalidates topic sales.tasks or sales.opportunities
  → realtime provider authorizes subscribed clients
  → affected source query becomes stale
  → client refetches through authenticated source endpoint
  → source result is revalidated against its output contract
  → component rerenders
```

WebSocket messages normally do not carry full business records and are not the only source of truth.

Typed snapshot + stream contracts are reserved for genuine live projections such as vehicle positions, dispatch telemetry, or long-running operation progress.

## Theme model

A theme has two layers:

```text
theme package
  code, token schema, palettes, semantic primitives,
  variants, validation, structural CSS, migrations

theme profile
  selected installed theme, adjustable validated tokens,
  revisions, publication state
```

Installing a new theme requires a package/build/deploy change. Switching among installed themes or adjusting palette/token values can happen at runtime after validation and publication.

Admin and public themes are separate.

## Architectural principles

1. **Payload is the foundation.** K-Nex extends Payload rather than pretending to abstract it away.
2. **Core is small, stable, and domain-neutral.** CRM, logistics, restaurant, customer branding, and vertical policy live in plugins/customer code.
3. **Plugins are versioned packages.** Their manifests declare compatibility, dependencies, surfaces, contributions, lifecycle, and capabilities where substitution matters.
4. **Customer applications are separate repositories.** Generate the shell; do not copy or patch platform core source.
5. **Every customer is independently deployable.** Database, storage, secrets, migrations, backups, and release cadence are isolated.
6. **Composition is declarative and reviewable.** Manifest, exact packages, generated registries, customer config, and migrations define the product.
7. **The CLI plans before it mutates.** Package, framework, infrastructure, source, UI, theme, and migration impact is visible before apply.
8. **Payload database selection happens at scaffold time.** V1 uses Postgres; K-Nex does not add a second DB provider abstraction.
9. **Runtime data never selects arbitrary executable packages.** Imports are statically generated.
10. **UI hiding is not authorization.** Data sources, actions, record policy, fields, and realtime subscriptions are enforced server-side.
11. **Modules expose deliberate projections.** Raw Payload collections are not automatically builder data sources.
12. **Generic components consume output contracts.** Counter/table/chart blocks do not import Sales, Logistics, or Restaurant implementations.
13. **Table fields are stable source IDs.** Internal Payload paths do not become persisted builder contracts.
14. **Realtime normally invalidates and refetches.** Live streams require explicit snapshot/resync contracts.
15. **Builder/theme input is structured and validated.** No arbitrary JavaScript, SQL, Payload queries, package imports, secrets, unrestricted URLs, or global CSS.
16. **Customer-specific logic begins locally.** Promote it after reuse proves the abstraction.
17. **Disable, uninstall, and purge differ.** Package removal never implies automatic data deletion.
18. **Customer repositories own final migrations.** Module schema intent is composed into customer-specific production evolution.

## Initial technical direction

```text
TypeScript
pnpm workspaces
Next.js + Payload
Payload Postgres adapter
Docker Postgres for local development
Puck behind a K-Nex builder adapter
private package registry
Docker-compatible customer releases
```

Payload and Puck remain provisional until the documented proof of concept passes its acceptance/rejection criteria.

## Documentation

Start with the [documentation index](./docs/README.md).

Key documents:

- [Product vision](./docs/01-product-vision.md)
- [System architecture](./docs/02-system-architecture.md)
- [Plugin taxonomy and capabilities](./docs/13-plugin-taxonomy-and-capabilities.md)
- [Application manifest](./docs/14-application-manifest.md)
- [CLI and project generation](./docs/15-cli-and-project-generation.md)
- [UI composition runtime](./docs/16-ui-composition-runtime.md)
- [Builder engine and profiles](./docs/17-builder-engine-and-profiles.md)
- [Theme and design system](./docs/18-theme-and-design-system.md)
- [Payload database selection](./docs/23-database-adapters-and-runtime-providers.md)
- [Plugin data sources and realtime invalidation](./docs/24-data-sources-state-and-binding-graph.md)
- [Data-source output contracts](./docs/25-output-contracts.md)
- [Decision register](./docs/21-decision-register.md)
- [Architecture Decision Records](./docs/adr/README.md)

## Repository status

This repository currently contains architecture, research, and decision documentation.

The first vertical POC should prove:

```text
one generated Payload/Postgres customer application
metric.scalar source feeding a Metric block
table.records source feeding a selected-column DataTable
category/time-series sources feeding charts
Payload authentication and field/record authorization
exact source-schema + canonical-contract validation
WebSocket invalidation and endpoint refetch
a CMS page and workspace dashboard
two themes
two independent customer repositories and migrations
```

## Working package names

Examples use conceptual `@k-nex/*` package names. Final registry scope remains open. Persisted plugin, block, source, contract, and state IDs remain independent from package location.

## License

No license has been selected. Until one is added, the repository and contents should be treated as proprietary.
