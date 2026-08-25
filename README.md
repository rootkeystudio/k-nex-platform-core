# K-Nex Platform Core

K-Nex is a modular application platform for repeatedly delivering independently deployed, customer-specific CMS, CRM, operations, analytics, and vertical business products.

It combines:

```text
versioned platform contracts
+ versioned plugins
+ database and infrastructure providers
+ a manifest-driven CLI
+ style-agnostic module UI
+ typed data sources, UI state, and declarative bindings
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
@k-nex/database-*
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

## Plugin model

**Plugin** is the umbrella installable concept:

| Kind | Examples |
|---|---|
| Module | CMS, CRM, visualization, dispatch, driver, inventory, budgeting |
| Provider | Postgres adapter, Neon target, WebSocket, Redis-backed realtime, S3, email |
| Builder | Puck adapter |
| Theme | Minimal, Neobrutalism, Glassmorphism |
| Integration | CRM–logistics, inventory–budgeting, ERP connectors |
| Preset | Logistics, restaurant, corporate CMS+CRM recipes |

Dependencies can target stable plugin IDs or replaceable versioned capabilities such as:

```text
database.primary
realtime.gateway
storage.objects
builder.engine
```

## Database provider model

Database integration uses the same plugin/capability system as every other infrastructure concern.

K-Nex distinguishes:

```text
database adapter
  Postgres/SQLite/another database family and framework integration

database target
  local Docker, external URL, Neon, or another hosting/connection profile
```

Current V1 decision:

```text
supported production adapter   Postgres only
local default                  Postgres in Docker Compose
external target                existing Postgres through DATABASE_URL
Neon                           future Postgres target/profile
SQLite                         experimental/demo only after capability tests
```

A future “Neon Postgres” CLI choice can install a Postgres adapter plus Neon target without duplicating the Postgres migration and module-compatibility model.

Modules require database capabilities such as transactions or geospatial support rather than importing a concrete adapter package. Every customer repository still owns its final migration history.

## UI and builder model

Enabled modules can contribute:

```text
navigation
fixed operational screens
composable blocks
data sources
UI state definitions
runtime context definitions
actions
realtime bindings
extension slots
```

Module UI is style-agnostic. Customer appearance is provided through semantic design-system contracts, installed theme packages, runtime theme profiles, and deliberate customer overrides.

The application shell remains fixed and permission-aware. Its navigation is generated from enabled modules. The editable canvas supports two initial profiles using one canonical K-Nex document model:

- **CMS profile:** public content pages, SEO/localization, draft/preview/publish, public-safe blocks and data sources;
- **Workspace profile:** dashboards, module overviews, reports, role/user layouts, authenticated data/actions, state, and realtime blocks.

Puck is the provisional first editor engine behind `@k-nex/builder-puck`. Domain modules do not depend on Puck types.

## Typed data, state, and bindings

Plugins can expose bounded, schema-validated data sources such as:

```text
crm.opportunities.by-stage
logistics.shipments.by-status
restaurant.sales.by-category
inventory.stock-value.by-warehouse
budget.variance.metric
```

Generic style-agnostic components such as pie charts, bar charts, metrics, tables, and maps declare typed input ports. The builder lists only compatible sources from enabled plugins.

A page can connect components without arbitrary code:

```text
DateRangeFilter
  → writes page.filters.date-range

PieChart
  → reads crm.opportunities.by-stage
  → binds period to page.filters.date-range
  → writes page.filters.selected-stage when a slice is selected

OpportunityTable
  → reads crm.opportunities.list
  → binds period and selected stage to the same page state
```

Stored layouts contain registered IDs, versions, parameters, mappings, and bindings. They do not contain SQL, executable JavaScript, package imports, secrets, raw server functions, unrestricted URLs, or live result snapshots.

Data-source execution and action authorization remain server-side. Public CMS pages can bind only to explicitly public-safe sources/actions.

## Theme model

A theme has two layers:

```text
theme package
  code, token schema, palettes, semantic primitives, variants, validation, migrations

theme profile
  selected installed theme, adjustable validated tokens, revisions, publication state
```

Installing a new theme requires a package/build/deploy change. Switching among installed themes or adjusting palette/token values can happen at runtime from the customer database after validation and publication.

Admin and public themes are separate.

## Architectural principles

1. **Core is small, stable, and domain-neutral.** It owns contracts, resolution, registries, cross-cutting infrastructure, and framework composition—not CRM, logistics, customer branding, or vertical policy.
2. **Plugins are versioned packages.** Their manifests declare compatibility, capabilities, dependencies, surfaces, data ownership, and lifecycle semantics.
3. **Customer applications are separate repositories.** Generate the shell; do not copy or patch core source.
4. **Every customer is independently deployable.** Database, storage, secrets, migrations, backups, and release cadence are isolated.
5. **Composition is declarative and reviewable.** `k-nex.app.json`, exact package versions, generated registries, and customer migrations define the product.
6. **The CLI plans before it mutates.** Add/remove/upgrade/provider/theme/database operations produce explicit package, infrastructure, data, and UI impact.
7. **Database adapters and targets are provider plugins.** V1 supports Postgres only; future adapters must earn compatibility through capability and migration tests.
8. **Runtime data never chooses arbitrary executable packages.** Plugin, provider, builder, and theme imports are generated statically.
9. **UI hiding is not authorization.** Server data sources, actions, commands, and realtime subscriptions enforce permission and record policy.
10. **UI data and state are explicit contracts.** Data sources, state scopes, input/output ports, and bindings are typed, versioned, and validated.
11. **Builder/theme input is structured and validated.** No arbitrary JavaScript, SQL, package imports, secrets, unrestricted server URLs, or global CSS.
12. **Generic components consume data contracts, not domain implementations.** A chart can render any compatible plugin source without importing the plugin.
13. **Customer-specific logic begins locally.** Promote it to a reusable module/integration after repeated need proves the abstraction.
14. **Disable, uninstall, and purge are different operations.** Package removal never implies automatic data deletion.
15. **Customer repositories own final migrations.** Plugins provide schema intent and helpers; the final composition owns production evolution.

## Initial technical direction

Current implementation hypotheses:

```text
TypeScript
pnpm workspaces
Next.js + Payload
Postgres through a K-Nex database provider
local Docker Postgres target
Puck behind a K-Nex builder adapter
private package registry
Docker-compatible customer releases
```

Payload and Puck remain provisional until the proof of concept passes the acceptance and rejection criteria documented under [`docs/`](./docs/README.md).

## Documentation

Start with the [documentation index](./docs/README.md).

The most important current documents are:

- [Product vision](./docs/01-product-vision.md)
- [System architecture](./docs/02-system-architecture.md)
- [Plugin taxonomy and capabilities](./docs/13-plugin-taxonomy-and-capabilities.md)
- [Application manifest](./docs/14-application-manifest.md)
- [CLI and project generation](./docs/15-cli-and-project-generation.md)
- [UI composition runtime](./docs/16-ui-composition-runtime.md)
- [Builder engine and profiles](./docs/17-builder-engine-and-profiles.md)
- [Theme and design system](./docs/18-theme-and-design-system.md)
- [Database adapters and runtime providers](./docs/23-database-adapters-and-runtime-providers.md)
- [Data sources, UI state, and binding graph](./docs/24-data-sources-state-and-binding-graph.md)
- [Decision register](./docs/21-decision-register.md)
- [Architecture Decision Records](./docs/adr/README.md)

## Repository status

This repository currently contains architecture, research, and decision documentation. Implementation should begin only after the Phase 0 decisions in the decision register are resolved and the repository/package topology is selected.

The first vertical POC should prove one cargo and one restaurant customer application, a Postgres provider, two themes, one CMS page, one workspace dashboard, and a generic chart/table connected to plugin-exposed data through shared page state.

## Working package names

Examples use the conceptual package scope `@k-nex/*`. The final package scope depends on registry ownership and is still an open decision. The architecture uses stable plugin, capability, block, data-source, and state IDs so package location can change without changing persisted product identity.

## License

No license has been selected. Until one is added, the repository and its contents should be treated as proprietary.