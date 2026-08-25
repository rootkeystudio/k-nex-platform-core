# Architecture Decision Register

## Purpose

This document is the authoritative summary of decisions made during the research phase and the remaining questions that must be resolved by proof of concept, implementation evidence, licensing review, or deployment constraints.

Detailed contracts and rationale live in the linked architecture documents and ADRs. This register answers: **what is currently accepted, what is provisional, what remains open, and what has been rejected?**

Statuses:

```text
accepted      current architecture; implementation should follow it
provisional   preferred direction, but a named POC must confirm it
open          no final implementation decision; options and trigger recorded
rejected      considered and intentionally not selected
superseded    replaced by a later decision
```

Accepted decisions can still change, but the change must update this register, affected documents, tests, and ideally an ADR.

# Accepted decisions

## D-001 — Independent customer applications, not shared multi-tenant SaaS

**Status:** accepted

Each customer receives a separate repository, database, storage boundary, secret set, deployment, migration history, and release cadence.

Rationale:

- matches the intended service/agency delivery model;
- lowers cross-customer data-leak blast radius;
- makes backup, restore, export, offboarding, and custom code easier;
- allows customer-specific infrastructure and plugin versions;
- avoids spending early effort on a central tenancy/control plane.

Consequence: shared code is distributed through packages and reusable workflows rather than one shared runtime.

## D-002 — Customer repositories consume packages; they do not copy or patch core source

**Status:** accepted

The customer shell is generated. Core and reusable plugins remain exact versioned dependencies.

Customer differences remain visible as:

```text
application manifest
exact package versions
customer theme/assets
builder documents
runtime settings
customer extensions/overrides
customer-owned migrations and deployment
```

A customer repository can contain genuine customer extensions, but not an editable copy of platform core.

## D-003 — Separate repository per customer, not long-lived customer branches

**Status:** accepted

This enables independent CI/CD, access, tags, issues, secrets, release history, dependency versions, archive/transfer, and customer-specific infrastructure while avoiding accidental cross-customer merges.

## D-004 — Payload is the initial application/backend foundation

**Status:** provisional

Payload is the leading foundation for authentication integration, admin, APIs, schema, access controls, jobs, migrations, versions/drafts, and plugin/config composition.

It remains provisional until the POC proves:

- deterministic contribution composition and collision ownership;
- database-provider composition;
- customer-owned migration workflow;
- CMS/workspace builder integration without deep framework forks;
- realtime/runtime hosting constraints;
- acceptable framework upgrade path.

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

A K-Nex plugin is broader than a Payload plugin and carries side-effect-free static manifest metadata, compatibility, capabilities, lifecycle, data ownership, surfaces, environment requirements, migrations, and operational semantics.

## D-006 — Dependencies use versioned capabilities where substitution matters

**Status:** accepted

Example:

```text
module.logistics-driver requires realtime.gateway@^1
provider.realtime-websocket-local provides realtime.gateway@1
```

Specific plugin-ID dependencies remain allowed when the dependency is a real domain module rather than a replaceable provider.

Database, realtime, storage, queue, email, maps, and builder implementations should generally be consumed through capabilities.

## D-007 — Plugin selection is build-time; runtime settings are database data

**Status:** accepted

Build-time/source-control concerns:

```text
install/remove package
select database/realtime/storage/builder/theme packages
schema-owning plugin composition
routes/imports/infrastructure
```

Runtime concerns:

```text
active installed theme
palette/token values
published layouts
page/filter/user preferences
CRM currency
tracking retention
feature settings that do not alter executable composition
```

The runtime admin panel does not install executable packages.

## D-008 — Declarative JSON manifest plus TypeScript extension config

**Status:** accepted

```text
k-nex.app.json   machine-editable desired composition
k-nex.config.ts  executable customer-specific extension code
```

`package.json` and `pnpm-lock.yaml` remain authoritative for installed artifacts. Customer migrations remain authoritative for database evolution.

## D-009 — CLI is an application compiler, not only a scaffolder

**Status:** accepted

The CLI creates projects and manages composition through plan/apply, dependency resolution, package installation, registry generation, diagnostics, upgrade planning, infrastructure generation, and migration checks.

Names:

```text
create-k-nex-app
@k-nex/cli
k-nex
```

Avoid `create-knex-app` and `knex` executable/config names because of ecosystem collision.

## D-010 — Generated registries are static and committed in V1

**Status:** accepted for V1

Generated plugin/provider/UI/data-source/state/action/theme registries and build inventory live under `.k-nex/generated/` and are committed. CI runs `k-nex generate --check`.

Rationale:

- composition diffs are reviewable;
- no runtime package-name evaluation;
- bundlers can statically discover imports;
- deployments are reproducible;
- security and operations can inventory exact capabilities.

## D-011 — One UI composition contract, multiple explicit surfaces

**Status:** accepted

Plugins can contribute style-agnostic navigation, screens, blocks, data sources, state/context definitions, actions, and extension slots for explicit surfaces:

```text
workspace
cms
public
driver
system
```

Surface declaration never bypasses audience, permission, record, data-sensitivity, or publication policy.

## D-012 — Fixed application shell, editable content canvas

**Status:** accepted for V1

Fixed/platform-controlled:

```text
sidebar host
top bar
router
authentication boundary
notification/dialog hosts
system/security screens
```

Composable:

```text
dashboards
module overviews
reports
role workspaces
personal dashboards
CMS/public pages
```

Operational transaction screens remain module-owned and can expose controlled extension slots; they are not fully rebuilt from arbitrary blocks in V1.

## D-013 — Same builder architecture for CMS and workspace

**Status:** accepted

One canonical K-Nex block/layout/binding model is used with separate profiles:

```text
CMS profile
  public content, SEO, draft/preview/publish,
  public-safe sources/actions/state and public theme

Workspace profile
  authenticated data/actions, scoped layouts,
  UI state, realtime, admin theme
```

The profiles do not share the same palette or security policy automatically.

## D-014 — Puck is the first builder adapter, behind K-Nex contracts

**Status:** provisional

`@k-nex/builder-puck` is the first implementation. Domain modules do not import Puck types.

Fallback: Craft.js if Puck fails the documented POC/rejection criteria.

Builder.io and GrapesJS can remain optional integrations for appropriate customer use cases but are not the mandatory K-Nex application editor.

## D-015 — Builder documents cannot contain arbitrary code or unrestricted styling

**Status:** accepted

Allowed:

```text
registered IDs and versions
validated serializable properties
source/state/context/action bindings
safe field mappings
layout/state defaults within policy
```

Forbidden:

```text
arbitrary JavaScript/TypeScript
SQL
package/module imports
secrets
raw server functions
unrestricted CSS/global selectors
unrestricted server-fetch URLs
live result snapshots
```

## D-016 — Style-agnostic module UI uses semantic design-system contracts

**Status:** accepted

Modules may include structural styling required for behavior, but not customer brand styling.

Rendering layers:

```text
headless/browser-safe logic
semantic domain component
design-system primitive adapter
runtime theme tokens
customer code overrides
```

## D-017 — Theme package plus runtime theme profile

**Status:** accepted

Theme package contains code, schema, palettes, primitives, component variants, structural CSS, validation, and migrations. It is installed at build time.

Theme profile contains selected installed theme, adjustable tokens, variants, revision, and publication state. It is stored in the customer database.

The panel can configure/activate installed themes but cannot download new theme packages.

## D-018 — Separate admin and public themes

**Status:** accepted

A customer may use a calm/dense admin theme and a highly expressive public theme.

Initial theme surfaces:

```text
admin
public
```

Future driver/mobile/email/print surfaces require separate contracts.

## D-019 — Theme profiles are versioned collection records

**Status:** accepted for V1

Use a versioned collection with draft/publish/rollback rather than one mutable global. Enforce exactly one published default profile per surface.

## D-020 — Postgres is the only officially supported V1 database

**Status:** accepted

```text
production support      Postgres
local default           Postgres in Docker Compose
external target         Postgres URL through environment
SQLite                   experimental/demo only after explicit opt-in
other adapters           no K-Nex support claim until test matrix passes
```

Using a different local database by default is rejected because dialect, migration, transaction, and concurrency differences can appear too late.

## D-021 — Customer application owns final migration history

**Status:** accepted

Plugins provide schema contributions, capability requirements, notes, readiness checks, and reusable data migration helpers. The customer repository owns final generated migrations and cross-plugin ordering.

No production auto-push and no automatic destructive cleanup when a package is removed.

## D-022 — Disable, uninstall, and purge are distinct

**Status:** accepted

```text
disable
  package/data retained; declared behavior gated

uninstall
  package removed; data and stored references retained unless explicitly migrated

purge
  destructive reviewed data/schema/reference deletion with backup/readiness
```

## D-023 — Domain services own business transactions; hooks are adapters

**Status:** accepted

Payload hooks can validate, maintain local invariants, enqueue jobs, or emit after-commit facts. Authoritative multi-step business behavior belongs in testable domain/application services and commands.

## D-024 — WebSocket/realtime is a provider capability, not core domain logic

**Status:** accepted

Driver requires `realtime.gateway`. Domain plugins define channel/message/authorization contracts. WebSocket remains transport; authoritative state remains recoverable through API/data sources.

Ordinary dashboard sources should prefer realtime invalidation/refetch. Streams are reserved for genuine live projections such as maps.

## D-025 — Customer-specific behavior starts locally and is promoted after reuse is proven

**Status:** accepted

```text
first customer need
  → customer extension

second similar need
  → compare policy and extract stable common behavior

remaining customer-specific differences
  → stay local
```

## D-026 — Database adapters and connection targets are provider plugins

**Status:** accepted

Related: [ADR-0009](./adr/0009-database-adapter-and-target-plugins.md) and [database provider architecture](./23-database-adapters-and-runtime-providers.md).

K-Nex distinguishes:

```text
database-adapter provider
  database family/dialect, framework adapter, capabilities,
  migration integration, health, contract tests

database-target provider/profile
  local/hosted/external connection, environment,
  infrastructure generation, pooling/TLS/operational diagnostics
```

Initial adapter:

```text
provider.database-postgres
@k-nex/database-postgres
```

A future Neon selection should reuse the Postgres adapter and add a Neon target/profile rather than duplicating Postgres module/migration compatibility.

Exactly one enabled provider supplies singleton `database.primary` in V1. Specialized stores use separate capabilities.

## D-027 — Plugins expose typed data sources and UI state through a declarative binding graph

**Status:** accepted

Related: [ADR-0010](./adr/0010-typed-data-source-state-binding-graph.md) and [binding architecture](./24-data-sources-state-and-binding-graph.md).

Plugins can register:

```text
data-source definitions
runtime-context definitions
UI state definitions
block input/output ports
registered actions
versioned data contracts
migrations
```

Builder documents connect these contracts with serializable bindings. Generic visualization components can consume compatible sources from CRM, logistics, restaurant, inventory, budget, or customer extensions.

Core distinctions:

```text
data source
  authorized query/projection, normally server-executed

UI state
  typed coordination value with explicit scope/persistence

runtime context
  read-only application/session/route/editor value

binding
  validated connection among state/context/source/block/action contracts
```

V1 supports plugin-defined projections, page state, static/context/state source parameters, field mapping, event-to-state/action binding, and selected realtime behavior.

V1 rejects arbitrary query/code/expression execution and unbounded browser aggregation.

# Provisional decisions requiring POC evidence

## P-001 — Canonical K-Nex document versus engine-native storage

**Current recommendation:** K-Nex owns canonical `UiDocument`; Puck adapter translates to/from it.

**Accept when:** fixtures remain stable across edit/save/render/migration and no domain plugin leaks Puck types.

**Fallback:** versioned Puck metadata section or reconsider editor engine after documenting trade-offs.

## P-002 — Layout inheritance implementation

**Current recommendation:** immutable base revision plus explicit customer/role/user patch operations.

POC options:

```text
patch operations with rebase/conflict handling
copy-on-write resolved snapshots with lineage
hybrid snapshots for published layouts and patches for personal changes
```

V1 fallback: hybrid/snapshot approach. The requirement is scoped inheritance and safe fallback, not one storage algorithm.

## P-003 — Third-party Payload–Puck integration usage

**Current recommendation:** use as spike/reference and possibly CMS accelerator; K-Nex contracts do not depend on it.

POC decides whether to wrap, reuse selected patterns/code under license, implement direct integration, or reject.

## P-004 — Payload config contribution merger

**Current recommendation:** K-Nex owns deterministic phased composition and collision checks.

POC must identify which fields/functions can be safely merged generically and which need explicit contribution APIs. Do not implement unsafe universal deep merge.

## P-005 — Disabled schema-owning plugin boot behavior

**Current recommendation:** retain enough schema registration for historical data while gating active behavior.

POC patterns:

```text
installed-disabled package
retention stub/schema snapshot
archive/export before uninstall
retain tables outside current framework config
```

## P-006 — WebSocket hosting topology

**Current recommendation:** local adapter in the application process for small single-instance deployments; Redis-backed provider for horizontal scaling.

POC must validate hosting constraints, connection draining, process separation, and deployment behavior.

## P-007 — Event durability level

POC may use measured after-commit behavior. First production recommendation for externally important facts is transactional outbox or equivalent.

## P-008 — Generated registries committed

Current V1 decision: commit and validate freshness. Review after POC using measured merge churn and deterministic generation reliability.

## P-009 — Exact database adapter/target contribution interface

**Accepted direction:** adapter and target are provider plugins; Postgres only in V1.

**POC decisions:**

- exact framework adapter TypeScript contribution;
- target package versus CLI recipe boundary;
- required Postgres extension metadata;
- migration lock strategy;
- worker/web pool configuration;
- safe diagnostics.

## P-010 — Binding graph serialization, runtime, and layout interaction

**Accepted direction:** typed source/state/context/action/port contracts and declarative graph.

**POC decisions:**

- exact canonical JSON shape;
- state store implementation;
- patch/snapshot interaction;
- source preview/sampling;
- graph cost limits;
- field mapping metadata;
- realtime reducer/invalidation model;
- server-render/hydration behavior.

The fallback is narrower composable dashboards and module-owned operational screens, not arbitrary code in documents.

# Open decisions

## O-001 — Repository topology for first-party plugins

Options:

```text
one platform/modules monorepo
core monorepo plus vertical repositories
repository per plugin
```

**Recommendation:** begin with one first-party monorepo for core/contracts/CLI/UI/database provider/early modules while preserving publishable package boundaries.

Trigger: before implementation scaffold.

## O-002 — Private package registry

Options:

```text
GitHub Packages
private npm organization
self-hosted registry
```

**Recommendation:** GitHub Packages initially. Validate developer/CI/deployment auth, visibility across customer repos, scope ownership, provenance, retention, and friction.

Trigger: Phase 0 publish/install spike.

## O-003 — Final npm/package scope

Working scope: `@k-nex/*`.

Trigger: registry ownership and naming setup. Persisted identities must not depend on package location.

## O-004 — License model

Repository currently remains proprietary/no license selected.

Questions include internal-only versus customer source access, open/source-available core, proprietary modules, redistribution, self-host terms, and third-party compatibility.

Trigger: before external distribution; legal review required.

## O-005 — Design-system primitive implementation

The semantic contract is accepted; concrete foundation remains open.

Options:

```text
custom primitives on accessible low-level libraries
Radix-based adapter
React Aria-based adapter
another reviewed accessible headless system
```

Criteria: accessibility, server/client behavior, styling neutrality, complex components, bundle size, maintenance, and theme flexibility.

Trigger: UI runtime POC.

## O-006 — Workspace grid/drag layout implementation

Puck may need an additional controlled responsive grid primitive/library.

Criteria: deterministic serialization, keyboard accessibility, nested layout, no arbitrary CSS, stable render, migrations.

Trigger: realistic operations dashboard POC.

## O-007 — Theme profile data ownership package

Recommendation:

```text
contracts/runtime resolution in ui-runtime
Payload collection/editor UI in standard installable module.theme-manager
```

Trigger: package topology design.

## O-008 — CMS and workspace layout storage collections

Recommendation:

```text
CMS document embedded/related to page versions for atomic publication
separate workspace layout collection for scoped inheritance
shared validation/migration services
```

Trigger: Payload/Puck storage POC.

## O-009 — UI override granularity

Recommendation: allow primitive and block-renderer overrides through typed contracts; route/screen overrides require explicit plugin extension points. Authorization remains server-owned.

Trigger: customer differentiation POC.

## O-010 — Runtime configuration storage API

Options:

```text
central namespaced settings collection
plugin-owned settings collection/global
hybrid central metadata plus plugin-owned data
```

Recommendation: central registry/metadata and plugin-owned validated schemas/storage; avoid one untyped JSON dump.

Trigger: theme manager plus first runtime-configurable domain plugin.

## O-011 — GitHub repository creation from CLI

V1 recommendation: initialize local Git only. Remote creation is a later optional authenticated command.

Trigger: after local scaffold is stable.

## O-012 — Deployment provider targets

Docker artifact is the portable default. First production platform remains open.

Criteria: Postgres/storage/Redis, WebSocket, workers, migration jobs, secrets, observability, cost/isolation, backup/restore.

Trigger: first production customer.

## O-013 — Driver frontend technology

Options include responsive PWA and React Native/Expo. Decision depends on offline behavior, camera/signature, background location, push, and app-store requirements.

Trigger: logistics POC/customer requirements.

## O-014 — High-frequency tracking storage providers

Options:

```text
Postgres only
Postgres + PostGIS
Redis current + Postgres/PostGIS history
specialized time-series/location store
```

Trigger: measured position rate, retention, query, and cost model.

## O-015 — Analytics and telemetry

No external K-Nex CLI/product telemetry by default. Customer application analytics remain optional providers/integrations with consent/privacy policy.

Trigger: explicit customer need.

## O-016 — Database target package shape

Options:

```text
full provider package with runtime contribution
CLI/catalog recipe package only
adapter option preset
hybrid package with generated infra and runtime diagnostics
```

Recommendation: start with local/external target behavior inside the Postgres provider/CLI, then extract a target plugin when the Neon spike demonstrates reusable boundaries.

Trigger: first managed Postgres target spike.

## O-017 — Generic visualization package boundary

Options:

```text
module.visualization
foundational UI package
separate chart/table/map plugins
```

Recommendation: begin with `module.visualization` containing generic metric/pie/bar/line/table blocks and shared data contracts; keep complex map/data-grid adapters separately replaceable if needed.

Trigger: binding POC package topology.

## O-018 — UI state store and persistence adapters

Open details:

- custom small store versus existing headless library;
- page/workspace/session/user-preference boundaries;
- server persistence collection ownership;
- URL synchronization;
- batching/equality/cycle behavior;
- SSR/hydration.

Trigger: dynamic dashboard POC.

## O-019 — Safe transformation registry

V1 decision: plugin-defined pre-aggregated sources plus field mapping; no generic visual query builder.

Open later design: allowlisted server-side transforms such as select, rename, filter, sort, limit, group, aggregate, and date bucket with cost/sensitivity/version policy.

Trigger: repeated customer need not covered by plugin-defined sources.

# Rejected approaches

## R-001 — Shared database/tenant model as initial architecture

Rejected because it is not required by the delivery model and adds tenancy/data-isolation/control-plane complexity.

## R-002 — Long-lived customer branches of the core repository

Rejected because upgrades, CI, access, releases, and merge conflicts become customer-specific source divergence.

## R-003 — Copy/fork core source into every customer repository

Rejected because fixes and upgrades become manual merge work. Generate the shell; consume core as packages.

## R-004 — Make Twenty the platform core

Rejected for current architecture because CRM is only one optional module while K-Nex must host CMS, builder, themes, logistics, restaurant, and other vertical capabilities with full customer UI ownership.

Twenty remains a useful CRM product/UX reference or isolated integration candidate.

## R-005 — Builder.io as mandatory core editor

Rejected because the desired baseline is independently operated customer applications and data/editor infrastructure. It can be optional for customers accepting that service dependency.

## R-006 — Arbitrary CSS/JavaScript/query code in customer-facing builder profiles

Rejected for V1 due to security, supportability, migration, deterministic rendering, and design-system consistency.

## R-007 — Runtime npm/package installation from the admin panel

Rejected for V1 due to supply-chain, migration, deployment, rollback, and executable-code risks.

## R-008 — Put CMS, CRM, database vendor, and every vertical concept inside core

Rejected. Core remains cross-cutting/domain-neutral; capabilities are plugins/providers.

## R-009 — Duplicate one database adapter per hosted Postgres vendor

Rejected as the default. Postgres dialect compatibility belongs to one adapter; hosting-specific connection/operations belong to targets unless genuine semantics differ.

## R-010 — Expose raw records and aggregate arbitrary analytics in the browser

Rejected as the generic builder model because it over-fetches sensitive data, weakens authorization/caching boundaries, and duplicates business calculations. Plugins expose bounded server projections.

# Immediate decision sequence

Before coding begins, resolve/validate in this order:

1. O-001 repository topology.
2. O-002 package registry and O-003 scope.
3. P-009 minimal Postgres adapter contribution and local target spike.
4. O-005 design-system primitive POC choice.
5. P-004 Payload contribution composition spike.
6. P-001/P-003 Puck canonical-document/storage spike.
7. P-010 typed source/state/binding graph spike with generic chart/table.
8. O-008 layout storage and O-018 state persistence shape.
9. P-002 layout inheritance implementation.
10. O-012 first deployment target only when the POC needs production constraints.

Do not wait for every future vertical, managed database, analytics, or deployment decision before implementing the platform foundation. Open decisions have explicit triggers so they are resolved when evidence becomes available.