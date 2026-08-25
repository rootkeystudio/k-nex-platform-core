# Architecture Decision Register

## Purpose

This document is the authoritative summary of accepted, provisional, open, superseded, and rejected K-Nex architecture decisions.

Statuses:

```text
accepted      implementation should follow this direction
provisional   preferred direction requiring named POC evidence
open          implementation detail or product question with a trigger
superseded    replaced by a later decision
rejected      intentionally not selected
```

Accepted decisions can change, but the change must update this register, affected documents, tests, and where appropriate an ADR.

# Accepted decisions

## D-001 — Independent customer applications, not shared multi-tenant SaaS

**Status:** accepted

Each customer receives a separate repository, database, storage boundary, secrets, deployment, migration history, theme/configuration, and release cadence.

## D-002 — Customer repositories consume packages; they do not copy core source

**Status:** accepted

The generated customer shell owns final composition, assets, extensions, overrides, migrations, tests, and deployment. Core and reusable plugins remain exact-version dependencies.

## D-003 — Separate repository per customer

**Status:** accepted

Long-lived customer branches of one core repository are rejected. Separate repositories provide independent CI/CD, permissions, issues, versions, secrets, and transfer/archive behavior.

## D-004 — Payload is the initial application/backend foundation

**Status:** provisional

Payload is the leading framework for:

```text
authentication/admin integration
collections/globals and APIs
access controls
jobs and migrations
versions/drafts
framework plugin/config composition
request-scoped data access
```

The POC must prove safe deterministic module composition, customer migrations, UI/builder integration, realtime hosting, and framework upgrades without deep forks.

## D-005 — Plugin is the umbrella installable concept

**Status:** accepted

Plugin kinds:

```text
module
provider
builder
theme
integration
preset
```

Examples of providers include realtime, object storage, email, queue, maps, and other genuinely replaceable infrastructure. Payload's primary database adapter is not a K-Nex provider plugin.

## D-006 — Dependencies use versioned capabilities where substitution matters

**Status:** accepted

Example:

```text
module.logistics-driver requires realtime.gateway@^1
provider.realtime-websocket-local provides realtime.gateway@1
```

Specific plugin-ID dependencies remain valid for real domain dependencies. Capability abstraction is not required merely to wrap functionality Payload already owns.

## D-007 — Executable composition is build-time; runtime settings are database data

**Status:** accepted

Build-time/source-controlled:

```text
module/provider/builder/theme package installation
Payload database adapter selection
routes and generated registries
schema-owning module composition
Docker and infrastructure files
```

Runtime/database-backed:

```text
active installed theme and tokens
published pages/layouts
module settings that do not alter executable composition
user preferences and allowed UI state
```

The admin panel does not install executable packages or replace the Payload database adapter.

## D-008 — Declarative JSON manifest plus TypeScript extension config

**Status:** accepted

```text
k-nex.app.json   machine-editable desired composition and scaffold choices
k-nex.config.ts  executable customer-specific extensions and overrides
```

`package.json`, the lockfile, generated registries, and customer migrations remain complementary sources of truth.

## D-009 — CLI is an application compiler, not only a template copier

**Status:** accepted

Names:

```text
create-k-nex-app
@k-nex/cli
k-nex
```

The CLI plans and applies package, manifest, generated-file, framework, environment, infrastructure, UI, and migration changes.

## D-010 — Generated registries are static and committed in V1

**Status:** accepted for V1

`.k-nex/generated/` contains deterministic plugin, provider, UI, source, action, state, theme, and framework composition artifacts. CI validates them with `k-nex generate --check`.

## D-011 — One UI composition contract, multiple explicit surfaces

**Status:** accepted

```text
workspace
cms
public
driver
system
```

Navigation, screens, blocks, data sources, actions, contexts, and state declare allowed surfaces and audiences. Surface metadata never bypasses server authorization.

## D-012 — Fixed application shell, editable content canvas

**Status:** accepted for V1

Fixed:

```text
sidebar host
top bar
router
authentication boundary
notification/dialog hosts
security/system screens
```

Composable:

```text
CMS/public pages
dashboards
module overviews
reports
role workspaces
personal dashboards
```

Operational transaction screens remain module-owned with controlled extension slots.

## D-013 — Same builder architecture for CMS and workspace

**Status:** accepted

One canonical K-Nex block/layout/binding model supports different profiles:

```text
CMS profile
  public content, SEO, locale, draft/preview/publish,
  public-safe data/actions, public theme

Workspace profile
  authenticated module data/actions, role/user layouts,
  realtime invalidation, admin theme
```

## D-014 — Puck is the first builder adapter behind K-Nex contracts

**Status:** provisional

Domain plugins do not import Puck types. Craft.js is the fallback if Puck cannot support canonical round-trip, profile restrictions, fixed-shell integration, responsive dashboard layouts, accessibility, or typed source binding without deep forks.

## D-015 — Builder documents contain only validated declarative data

**Status:** accepted

Allowed:

```text
registered IDs and versions
validated props
source/state/context/action bindings
selected source fields and columns
safe layout data
```

Forbidden:

```text
arbitrary JavaScript/TypeScript
SQL or Payload queries
package imports
secret values
unrestricted URLs
raw server functions
unrestricted global CSS
live result snapshots
```

## D-016 — Module UI is style-agnostic and uses semantic design-system contracts

**Status:** accepted

```text
headless/browser-safe behavior
semantic domain component
design-system primitives
theme tokens/recipes
customer overrides
```

Structural/accessibility styling is allowed; customer brand decisions are not embedded in reusable module UI.

## D-017 — Theme package plus runtime theme profile

**Status:** accepted

Theme package: executable code, token schema, palettes, primitive/variant recipes, structural CSS, validation, migrations.

Theme profile: versioned database record selecting an installed theme and adjustable validated values.

## D-018 — Separate admin and public themes

**Status:** accepted

Admin and public surfaces may use different installed themes and profiles. Future driver/mobile/email/print surfaces require separate contracts.

## D-019 — Theme profiles are versioned draft/published records

**Status:** accepted for V1

Exactly one published default per theme surface. Preview, publish, rollback, and schema migration are audited.

## D-020 — Postgres is the only officially supported V1 database

**Status:** accepted

```text
Payload adapter       Postgres
local default         Docker Postgres
external/managed      DATABASE_URL
SQLite/other          unsupported until full compatibility work
```

## D-021 — Customer application owns final migration history

**Status:** accepted

Plugins provide schema contributions, notes, helpers, readiness checks, and fixtures. The final customer composition owns generated/authored migrations and production execution.

## D-022 — Disable, uninstall, and purge are distinct

**Status:** accepted

```text
disable    code/package retained; declared behavior gated; data retained
uninstall  package removed where safe; data/references retained unless migrated
purge      explicit destructive data/schema/reference deletion
```

Schema-owning plugin removal semantics remain subject to POC restrictions.

## D-023 — Domain services own business transactions; Payload hooks are adapters

**Status:** accepted

Authoritative multi-step behavior lives in testable domain/application services. Hooks/endpoints adapt requests, maintain local invariants, enqueue work, or publish after-commit facts.

## D-024 — WebSocket/realtime is a provider capability

**Status:** accepted

Domain plugins define message/topic authorization and invalidation meaning; the realtime provider owns transport. Authoritative state remains recoverable through authenticated APIs/data sources.

Ordinary counters/tables/charts use invalidation and refetch. Typed streams are reserved for genuine live projections.

## D-025 — Customer-specific behavior starts locally

**Status:** accepted

First unique requirement becomes a customer extension. Repeated requirements are compared and only stable shared behavior is promoted into reusable plugins.

## D-026 — Database adapters and targets as K-Nex provider plugins

**Status:** superseded

Superseded by D-028 and [ADR-0011](./adr/0011-payload-database-adapter-selected-at-scaffold.md).

The previous `@k-nex/database-postgres` / `provider.database-postgres` abstraction is no longer part of the architecture.

## D-027 — Plugins expose typed data sources and UI bindings

**Status:** accepted

Related: [ADR-0010](./adr/0010-typed-data-source-state-binding-graph.md) and [plugin data-source architecture](./24-data-sources-state-and-binding-graph.md).

A module can register:

```text
authenticated data-source descriptors and handlers
runtime-context definitions
page/session/user UI-state definitions
registered actions
block input/output contracts
source/field/version migrations
realtime invalidation metadata
```

Examples:

```text
sales.total-opportunities
sales.tasks
sales.opportunities-by-stage
```

Generic blocks such as counters, tables, and charts bind to these stable contracts. Plugins do not expose raw database access, raw internal React stores, arbitrary URLs, or browser query code.

## D-028 — Payload database adapter is selected during scaffold generation

**Status:** accepted

Related: [ADR-0011](./adr/0011-payload-database-adapter-selected-at-scaffold.md) and [database scaffold documentation](./23-database-adapters-and-runtime-providers.md).

```text
create-k-nex-app
  → select Payload adapter
  → install selected @payloadcms/db-* package
  → generate Payload db configuration
  → generate local Docker infrastructure when requested
```

V1 installs Payload's Postgres adapter. Neon and other hosted Postgres services are connection/deployment choices using the same adapter, not K-Nex persistence plugins.

Modules query through `req.payload` and domain services while preserving Payload access and transaction context.

## D-029 — Plugin data sources execute through a standard authenticated gateway

**Status:** accepted direction; exact route API provisional

Logical ownership and server handlers remain in the plugin. K-Nex provides a consistent execution/discovery transport for authentication, schemas, permission checks, rate/cost limits, logging, and errors.

Recommended V1 shape:

```text
GET  /api/k-nex/data-sources
POST /api/k-nex/data-sources/:sourceId/query
```

Workspace/admin sources require a valid Payload actor plus source permission, record policy, and field policy. Public sources use separate explicit IDs and policies.

## D-030 — Realtime normally invalidates data-source queries

**Status:** accepted

After an authorized module mutation commits:

```text
module emits invalidation topic/scope
  → realtime provider authorizes delivery
  → connected query is marked stale
  → client refetches source endpoint
  → component rerenders
```

WebSocket messages normally do not carry full business records. Snapshot + typed stream is reserved for high-frequency live projections such as vehicle positions.

# Provisional decisions requiring POC evidence

## P-001 — Canonical K-Nex document versus engine-native storage

**Recommendation:** K-Nex owns canonical `UiDocument`; Puck translates to/from it.

Accept when nested layouts, props, bindings, IDs, constraints, and migrations round-trip without loss and domain plugins leak no Puck types.

## P-002 — Layout inheritance implementation

Candidate V1 approach:

```text
platform template
customer/role published snapshots with lineage
constrained user personalization patch
```

Compare against full patch and copy-on-write alternatives.

## P-003 — Existing Payload–Puck integration usage

Use as a spike/reference or CMS accelerator only. Decide whether to wrap, reuse patterns under license, implement direct integration, or reject.

## P-004 — Payload contribution composition

K-Nex owns deterministic phased composition and collision ownership. POC determines which framework fields/functions require explicit contribution contracts rather than generic merge.

## P-005 — Disabled schema-owning plugin behavior

POC must determine whether V1 supports only installed-disabled modules or also retained-data uninstall through schema stubs/archive strategies.

## P-006 — WebSocket hosting topology

Validate local single-process and Redis-backed/multi-instance providers, connection draining, authorization refresh, and deployment constraints.

## P-007 — Event durability

POC can use measured after-commit behavior. External business integrations should move to transactional outbox or equivalent durability.

## P-008 — Committed generated registries

Measure churn and deterministic reliability after the POC.

## P-009 — Payload Postgres scaffold and request context

POC must prove:

```text
generated @payloadcms/db-postgres config
Docker and external Postgres
authenticated req.payload source handlers
transaction commit/rollback
customer-owned migrations
no K-Nex database provider package
```

## P-010 — Data-source contracts, transport, and binding runtime

POC must select/validate:

```text
exact defineDataSource API
standard gateway route shape
source descriptor delivery
output contract library
field and column metadata
actor-scoped cache/query keys
realtime invalidation scope
source version migrations
client query/cache implementation
SSR/hydration policy
```

# Open decisions

## O-001 — First-party repository topology

**Recommendation:** one monorepo for core/contracts/CLI/UI/early plugins while contracts stabilize; split later only for ownership, permission, release, or build reasons.

## O-002 — Private package registry

**Recommendation:** GitHub Packages initially. Validate developer/CI/deployment auth, package visibility, provenance, retention, and scope ownership.

## O-003 — Final package scope

Working scope: `@k-nex/*`. Persisted IDs remain independent from package names.

## O-004 — License model

Proprietary/no license currently. Decide internal/customer access, open/source-available core, proprietary modules, redistribution, and third-party compatibility before external distribution.

## O-005 — Accessible semantic primitive foundation

Candidates include Radix-based, React Aria-based, custom reviewed primitives, or another accessible headless foundation.

## O-006 — Workspace grid/resizing implementation

Puck may require a controlled responsive grid primitive/library. Validate deterministic serialization, keyboard access, nesting, rendering, and migrations.

## O-007 — Theme profile ownership package

Recommendation: contracts/resolution in UI runtime; Payload collection/editor in a standard installable theme-manager module.

## O-008 — CMS and workspace document storage

Recommendation:

```text
CMS document with page revision/publication
workspace layouts in separate versioned collection
shared validation/renderer/migration services
```

## O-009 — UI override granularity

Recommendation: typed primitive and block-renderer overrides; full route/screen replacement only through explicit module extension points.

## O-010 — Runtime configuration storage

Recommendation: central registry/metadata plus plugin-owned validated settings schemas/storage; avoid one untyped JSON dump.

## O-011 — GitHub repository creation from CLI

V1 initializes local Git. Remote creation is a later optional authenticated command.

## O-012 — First deployment targets

Docker image is portable default. Choose production platform when first customer constraints are known.

## O-013 — Driver frontend technology

PWA versus React Native/Expo depends on offline, camera/signature, background location, push, and app-store requirements.

## O-014 — High-frequency tracking storage

Options include Postgres/PostGIS, Redis current position plus history store, or specialized storage after measured load/retention requirements.

## O-015 — Analytics and telemetry

No K-Nex external telemetry by default. Customer analytics remains optional with explicit privacy/consent policy.

## O-016 — Hosted Postgres scaffold recipes

Neon/other hosted services may need pooling, TLS, preview, migration, and deployment guidance. Decide whether these remain CLI templates/docs or become optional integration packages only after a real target spike.

## O-017 — Generic visualization package boundary

Recommendation: shared dataset/metric contracts in UI contracts and optional `module.visualization` for counter/pie/bar/line/table blocks. Complex map/data-grid adapters may split later.

## O-018 — UI state store and persistence

Choose custom versus existing store, URL/session/user persistence, equality/batching, SSR/hydration, and cycle prevention during dynamic dashboard POC.

## O-019 — Safe transformation registry

V1 uses purpose-built plugin sources plus safe field selection. Add allowlisted server transformations only after repeated need; no arbitrary visual SQL/query builder.

## O-020 — Per-source route versus standard gateway

Recommendation: standard gateway with plugin-owned handlers. Revisit only if dedicated streaming, public caching, file delivery, or external-client semantics cannot fit cleanly.

# Rejected approaches

## R-001 — Shared tenant database/runtime as the initial product

Rejected because it does not match the independently deployed customer delivery model.

## R-002 — Long-lived customer branches

Rejected due to upgrade, CI, access, release, and merge divergence.

## R-003 — Copy/fork platform core into customer repositories

Rejected. Generate the shell and consume packages.

## R-004 — Twenty as platform core

Rejected because CRM is one optional capability among CMS, builder, themes, and vertical operations. Twenty remains a UX/reference/integration candidate.

## R-005 — Builder.io as mandatory editor infrastructure

Rejected due to desired independent customer operation. It can remain optional where explicitly accepted.

## R-006 — Arbitrary code/query/style input in builder documents

Rejected for security, supportability, migration, and deterministic rendering.

## R-007 — Runtime package installation from admin UI

Rejected for supply-chain, deployment, migration, rollback, and executable-code risk.

## R-008 — Put all business concepts inside core

Rejected. Core remains cross-cutting and domain-neutral.

## R-009 — K-Nex database provider/ORM abstraction above Payload

Rejected and supersedes the previous database-provider proposal. Payload owns the primary database adapter and persistence APIs.

## R-010 — Automatically expose Payload collections as builder data sources

Rejected. Modules expose deliberate bounded projections with explicit permissions, fields, limits, and versioning.

## R-011 — Treat WebSocket messages as the only source of truth

Rejected. Normal components refetch authenticated source endpoints; live streams include snapshot/resync behavior.

# Immediate decision and POC sequence

1. Choose first-party monorepo topology.
2. Prove private package publish/install and finalize scope.
3. Generate a minimal Payload Postgres application.
4. Prove explicit Payload module contribution composition.
5. Implement actor/permission-aware module data-source registry and gateway.
6. Implement one scalar source and one table source from a Sales stub.
7. Add Counter and DataTable bindings, selected columns, pagination, sorting, and filters.
8. Add authenticated WebSocket invalidation/refetch.
9. Build fixed shell, semantic primitives, and two themes.
10. Run Puck CMS/workspace canonical document POC.
11. Test two independent customer repositories and migrations.

Do not begin with full CRM, production dispatch optimization, broad database portability, visual SQL, or a plugin marketplace before these foundations are proven.
