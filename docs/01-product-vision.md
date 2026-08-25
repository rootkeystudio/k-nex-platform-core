# Product Vision and Boundaries

## Vision

K-Nex is a software product line and application factory for repeatedly delivering customer-specific business applications without repeatedly rebuilding authentication, content management, modular backend behavior, UI composition, themes, operations, and project scaffolding.

Customer products may combine:

```text
CMS + Sales/CRM
logistics + dispatch + driver + tracking
restaurant + QR menu + inventory + budgeting
agency + CMS + forms + proposals + reporting
future vertical modules and customer extensions
```

Every customer receives an independent product with its own repository, Payload/Postgres data, object storage, secrets, deployment, migrations, visual language, content, extensions, and release schedule.

## Product equation

```text
Payload application foundation
+ versioned K-Nex contracts and trusted plugins
+ deterministic manifest/CLI composition
+ customer-owned design, data, extensions, and infrastructure
= independently deployable customer product
```

## What K-Nex is

- a conservative set of contracts and composition rules on top of Payload;
- publishable modules, providers, builders, themes, integrations, and presets;
- a CLI that creates and upgrades reviewable customer repositories;
- style-agnostic module UI and semantic design contracts;
- one canonical visual document architecture with separate CMS/workspace policies;
- plugin-owned authenticated data sources for generic and domain-specific blocks;
- a repeatable deployment and fleet-upgrade discipline without a shared runtime tenancy requirement.

## What K-Nex is not

- a shared multi-tenant database/runtime in V1;
- a copied or patched platform core in every customer repository;
- a generic ORM or database portability layer above Payload;
- a runtime package marketplace;
- arbitrary visual JavaScript, SQL, Payload queries, global CSS, or server URL composition;
- a claim that every operational workflow belongs in drag-and-drop UI;
- a promise that schema-owning plugins can be removed while their schema remains available;
- an untrusted plugin sandbox.

## Payload commitment

Payload is the strategic V1 application framework. K-Nex uses Payload collections, access controls, request context, jobs, migrations, versions/drafts, admin integration, and the Postgres adapter.

The POC evaluates whether K-Nex can maintain deterministic plugin composition, source authorization, migrations, visual composition, and upgrades **on Payload** without deep framework forks. Replacing Payload would be a platform migration, not a provider switch.

## Customer ownership

A customer application owns:

```text
k-nex.app.json and exact lockfile
hermetic k-nex.config.ts customer registrations
brand assets and approved fonts
customer UI blocks/overrides and true custom policies
final migrations and previous-release fixtures
CMS content, workspace layouts, theme profiles, runtime settings
deployment resources, secrets, backups, logs, alerts
artifact release and migration cadence
```

Shared packages own reusable behavior and public contracts.

## Core boundary

The platform is physically separated into low-dependency contracts, composition/resolver logic, runtime services, a Payload adapter, testing support, UI subsystems, and the CLI. A convenience `@k-nex/core` facade must not collapse these boundaries into ambient authority.

Core-family packages do not contain Sales, logistics, restaurant, customer branding, Puck internals, ECharts options, Socket.IO types, or one customer’s conditionals.

## Plugin ecosystem

### Module

Reusable horizontal or domain behavior, for example:

```text
module.cms
module.sales
module.logistics.core
module.logistics.dispatch
module.logistics.driver
module.restaurant.core
module.restaurant.qr-menu
module.inventory
module.budgeting
```

### Provider

A genuinely replaceable infrastructure implementation, for example:

```text
provider.realtime.socketio
provider.storage.s3
provider.email.smtp
```

The Payload database adapter is scaffold/framework configuration, not a K-Nex provider.

### Builder, theme, integration, preset

```text
builder.puck
theme.minimal
theme.neobrutalism
integration.sales-logistics
preset.logistics
```

## UI and data vision

Enabled modules can contribute:

```text
permission-aware navigation
fixed operational screens
composable style-agnostic blocks
authenticated data-source descriptors and handlers
registered actions and UI state definitions
realtime invalidation metadata
explicit extension slots
```

Generic components consume stable contracts:

```text
Metric     ← metric.scalar@1
DataTable  ← table.records@1
Pie/Bar    ← series.category@1
Line/Area  ← series.time@1
```

Raw Payload collections are not automatically builder sources.

## Fixed shell and composable surfaces

The application shell owns authentication, router, sidebar host, top bar, global dialogs/notifications, and security/system screens. Module navigation fills explicit slots.

Initial composable surfaces:

```text
public CMS pages
dashboards
module overviews
reports
role/group workspaces
personal dashboard customizations
```

Operational transaction screens remain module-owned in V1 and can expose controlled extension slots.

## Builder profiles

- **CMS:** explicit public-safe blocks/sources/actions, content metadata, localization, draft/preview/publish, public theme.
- **Workspace:** authenticated data/actions, source filters, scoped layout assignments, realtime, admin theme.

The engine may be shared, but authority-bearing public and workspace IDs are separate. A public action is never converted into an internal action by configuration.

## Themes

Theme packages contain executable schemas, tokens, recipes, structural styles, and migrations. Theme profiles contain validated adjustable values and publication history in the customer database.

V1 exposes a small semantic primitive ABI. Complex table grids, date/calendar, maps, charts, rich text, command menus, and resizable dashboard layouts use separate versioned adapters.

## Build-time and runtime boundary

Build-time:

```text
packages and exact versions
Payload adapter and generated config
plugin/provider/builder/theme availability
schema, routes, static registries, customer code
process and infrastructure topology
```

Runtime:

```text
business records and CMS content
published layouts and theme profiles
validated settings/features that do not alter executable composition
user preferences and page filter state
```

Runtime values cannot choose package paths or modify schema composition.

## Success criteria

K-Nex succeeds when it can:

- generate two different customer repositories from explicit manifests;
- release one shared fix and upgrade customers independently;
- compose one plugin graph deterministically and reject invalid graphs before boot;
- enforce source/record/field authorization even under direct client manipulation;
- render the same canonical block under materially different themes;
- recover clients after lost realtime messages through authoritative source fetches;
- migrate, disable, re-enable, and explicitly purge without silent data loss;
- identify every deployed customer affected by a package/security range through verifiable release evidence.

## Constraints

- TypeScript-first, exact dependencies, pnpm lockfiles.
- Payload + Postgres in V1.
- Trusted first-party/reviewed private packages only.
- No runtime package installation.
- WCAG 2.2 AA target for supported web surfaces.
- Customer repositories own final migrations and deployments.
- Public decisions remain design-only until the relevant executable POC gate passes.
