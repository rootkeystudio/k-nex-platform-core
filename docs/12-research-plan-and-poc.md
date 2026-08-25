# Research Plan and Proof of Concept

## Objective

The research phase must prove that K-Nex can generate independently deployed Payload applications from a declarative specification and compose:

```text
Payload + Postgres
K-Nex modules/providers/themes/builder
plugin-owned authenticated data sources
style-agnostic reusable UI blocks
CMS/workspace visual composition
secure realtime invalidation
customer-owned migrations and deployment
```

The goal is not to finish a production CRM, logistics suite, restaurant ERP, analytics platform, or visual query builder. The goal is to validate the architecture's riskiest assumptions through narrow vertical slices.

# Required POC repositories

```text
k-nex platform monorepo/POC
client-acme-cargo-poc
client-mamma-restaurant-poc
```

Customer repositories must be generated through the CLI and consume released/workspace packages. They must not copy platform core source.

# Core hypotheses

## H-001 — Manifest-driven generation is deterministic

Same manifest, catalog, CLI version, customer config, and lockfile constraints produce the same scaffold and generated registries.

## H-002 — Payload Postgres scaffold is sufficient

K-Nex does not need a database provider abstraction. The generator installs/configures `@payloadcms/db-postgres`; modules use authenticated Payload APIs/request context; Docker and external Postgres work without module changes.

## H-003 — Plugin/capability graph is understandable

Missing/incompatible module dependencies, duplicate replaceable providers, conflicts, cycles, and contribution collisions fail before application boot with owner/remediation details.

## H-004 — Payload hosts module composition without deep forks

Collections, globals, services, access, endpoints, jobs, sources, and admin contributions compose deterministically.

## H-005 — Modules expose deliberate authenticated data sources

A Sales module exposes:

```text
sales.total-opportunities
sales.tasks
sales.opportunities-by-stage
```

without exposing raw collections or database access.

## H-006 — Generic components consume module sources

Counter, DataTable, PieChart, and BarChart bind to output contracts and field metadata without importing Sales implementation code.

## H-007 — Source authorization survives client manipulation

Payload session, permission, record policy, and field policy are enforced server-side for discovery, execution, and realtime subscription.

## H-008 — Realtime invalidation/refetch is reliable

After a committed mutation, authorized active source queries are invalidated and refetched. Missed messages/reconnect recover through the source endpoint.

## H-009 — One UI contract supports CMS and workspace profiles

Same canonical block/layout/binding model supports public pages and authenticated dashboards with different palettes, security, and publication rules.

## H-010 — Puck remains an adapter

Puck round-trips canonical K-Nex documents without leaking types into domain modules or requiring a deep fork.

## H-011 — Style-agnostic module UI renders through different themes

Same components render accessibly under Minimal, Neobrutalism, and one materially different public theme/profile.

## H-012 — Customer-owned migrations remain manageable

Two customer compositions have separate Payload migrations, lockfiles, releases, and upgrade paths.

# Key research questions

## Packaging and CLI

- first-party monorepo topology;
- GitHub Packages/private registry auth;
- final npm scope;
- static manifest reading without runtime execution;
- deterministic generated registries;
- interactive/non-interactive parity;
- plan/apply rollback;
- secret-safe environment generation.

## Payload scaffold

- exact Payload/Next project template;
- generated Postgres adapter code;
- Docker Postgres startup and external URL operation;
- request/transaction context propagation;
- type generation and migration commands;
- framework upgrade boundaries.

## Module composition

- explicit contribution phases;
- collision ownership for collection slugs, routes, permissions, events, jobs, sources, actions, blocks;
- disabled schema-owning module behavior;
- server/client export separation.

## Data sources

- exact `defineDataSource` API;
- descriptor/handler separation;
- standard source gateway path/method;
- Payload auth and record/field policy;
- source output contract library;
- field metadata for tables;
- pagination/sort/filter allowlists;
- source versioning/migrations;
- discovery behavior by surface/audience/permission;
- public versus internal source isolation;
- cache/query-key policy.

## Realtime

- authenticated socket handshake;
- per-source/topic/scope subscription authorization;
- invalidation message format;
- query-key matching;
- reconnect and permission refresh;
- local versus Redis-backed provider;
- when snapshot + typed stream is required.

## UI and builder

- fixed shell plus editable canvas;
- semantic primitive foundation;
- Counter/DataTable/chart source picker;
- source field/column picker;
- shared page filters/state;
- canonical document round-trip;
- profile-specific palette/security;
- missing/disabled source fallback;
- layout inheritance/storage.

## Themes

- safe server/client token generation;
- primitive recipes/overrides;
- draft/preview/publish/rollback;
- accessibility validation;
- schema migrations without auto-publish.

## Migrations and lifecycle

- plugin addition and customer migration generation;
- disable/uninstall/purge boundaries;
- stored layout/source reference scans;
- clean and previous-release upgrades;
- independent customer rollout.

# POC package scope

Minimum packages:

```text
@k-nex/contracts
@k-nex/core
@k-nex/cli
@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-shell
@k-nex/ui-design-system-contracts
@k-nex/builder-puck
@k-nex/theme-minimal
@k-nex/theme-neobrutalism
@k-nex/module-cms
@k-nex/module-sales
@k-nex/module-visualization
@k-nex/module-logistics-core
@k-nex/module-driver
@k-nex/module-restaurant-core
@k-nex/module-qr-menu
@k-nex/provider-websocket
```

Framework dependency:

```text
Payload
@payloadcms/db-postgres
```

There is no `@k-nex/database-postgres` package.

# Sales source POC

## Minimal Sales data model

```text
Companies
Contacts
Opportunities
SalesTasks
```

Opportunity fields:

```text
name
stage
potentialRevenue
currency
owner
company
expectedCloseAt
status
```

Task fields:

```text
title
status
dueAt
assignee
relatedOpportunity
```

## `sales.total-opportunities`

Output contract:

```text
metric.money@1
```

Example:

```json
{
  "value": 325000,
  "currency": "TRY"
}
```

Inputs may include date range, stage IDs, owner, and branch context.

## `sales.tasks`

Output contract:

```text
table.records@1
```

Fields:

```text
title             text      selectable/sortable/filterable
status            enum      selectable/sortable/filterable
dueAt             datetime  selectable/sortable/filterable
assignee.name     text      selectable
opportunity.name  text      selectable
potentialRevenue  money     separately permission-protected when projected
```

Supports bounded pagination and allowlisted sorting/filtering.

## `sales.opportunities-by-stage`

Output contract:

```text
series.category@1
```

Used by PieChart/BarChart.

# Customer POC A — Acme Cargo

## Composition

```text
Payload + Postgres
module.cms
module.sales
module.visualization
module.logistics-core
module.driver
provider.realtime-websocket-local
builder.puck
CMS + workspace profiles
theme.minimal (admin)
theme.neobrutalism (public)
```

## Workspace journey

1. Admin logs in.
2. Module navigation appears in fixed shell.
3. Admin creates opportunities and tasks.
4. Admin opens workspace builder.
5. Adds date-range filter.
6. Adds Counter bound to `sales.total-opportunities`.
7. Adds PieChart bound to `sales.opportunities-by-stage`.
8. Adds DataTable bound to `sales.tasks`.
9. Selects title, status, due date, and assignee columns.
10. Publishes role layout.
11. Opportunity/task changes invalidate active queries.
12. Counter/chart/table refetch and rerender.

## Security journey

1. Sales manager sees revenue source/field.
2. Staff role can see tasks but lacks revenue permission.
3. Revenue source/field is absent from discovery.
4. Manual request is denied server-side.
5. Manual WebSocket subscription to unauthorized scope is denied.
6. Another branch's records remain inaccessible.

## CMS journey

1. Editor composes cargo landing page.
2. Adds public content blocks and explicit public tracking form/source.
3. Internal Sales sources do not appear.
4. Draft preview requires editor authentication.
5. Public publish uses Neobrutalism theme.

## Realtime/driver journey

1. Assignment/task commits.
2. Authorized driver receives invalidation/update.
3. Driver fetches authoritative projection.
4. Another driver cannot subscribe/fetch.
5. Reconnect recovers current state.

# Customer POC B — Mamma Restaurant

## Composition

```text
Payload + Postgres
module.cms
module.restaurant-core
module.qr-menu
module.visualization
builder.puck
CMS profile
theme.minimal (admin)
theme.glassmorphism (public)
```

## Journey

1. Admin creates dishes/categories/branches.
2. Restaurant module exposes explicit public menu source.
3. Editor composes public page with shared and restaurant blocks.
4. Cargo/Sales internal sources are unavailable.
5. Public menu projection excludes costs/internal data.
6. Same builder/runtime/theme contracts remain unchanged.

# CLI scenarios

## Interactive creation

```bash
pnpm create k-nex-app client-acme-cargo-poc
```

Verify Payload Postgres adapter package/config and selected K-Nex packages.

## Non-interactive creation

Generate equivalent app from flags/spec and compare normalized output.

## Add Sales

```bash
k-nex add module.sales
```

Expected:

```text
package and schema additions
Sales permissions/events/sources/blocks
customer migration required
no database provider plugin
```

## Add driver

```bash
k-nex add module.logistics-driver
```

Expected: logistics core and realtime provider proposed.

## Realtime provider replacement

```text
websocket-local → websocket-redis
```

Driver/domain code unchanged; infrastructure impact reported.

## Disable/remove/purge

Different package/schema/source/layout behavior; purge refuses without readiness/backup/confirmation.

## Stale generation

Manifest edit without generate makes CI fail.

## Secret safety

External `DATABASE_URL` is written only to ignored local file and redacted.

# Data-source scenarios

## Counter

- authorized source discovery;
- scalar output binding;
- loading/empty/error/forbidden states;
- realtime invalidation/refetch.

## DataTable

- source field metadata;
- selected columns persisted;
- allowlisted pagination/sort/filter;
- field-level permission;
- task mutation invalidation;
- reconnect recovery.

## Shared filters

- date filter writes page state;
- counter/chart/table bind source params to state;
- state changes create validated query keys;
- invalid/cyclic bindings fail.

## Source disable/version migration

- disabled source gives safe unavailable state;
- layout remains stored;
- source field/version migration updates fixtures;
- publication/readiness detects incompatible references.

# Deliberate failure tests

## Database abstraction regression

Attempt to add `provider.database-postgres` or `@k-nex/database-postgres`.

Expected: manifest/contracts reject; scaffold uses `@payloadcms/db-postgres`.

## Duplicate source

Two plugins register `sales.tasks`.

Expected: generation fails naming both owners.

## Unauthorized source

Actor requests revenue source without permission.

Expected: forbidden, no leakage.

## Unauthorized field

Actor requests protected revenue column.

Expected: discovery omits and execution rejects/omits according to contract.

## Unauthorized realtime subscription

Actor subscribes to another branch/user scope.

Expected: denial and no data-bearing event.

## Transaction rollback

Mutation fails after preparing invalidation/event.

Expected: no external invalidation/event before commit.

## Public/private boundary

Public CMS document binds `sales.tasks`.

Expected: builder/publication validation and server denial.

## Arbitrary query/code

Inject SQL, raw Payload where object, arbitrary URL, JS/import/secret.

Expected: schema validation failure.

## Unbounded table

Request unsupported page size/sort/filter.

Expected: input/cost limit failure.

## Missed WebSocket message

Disconnect during mutation, reconnect.

Expected: endpoint refetch recovers current data.

# Acceptance criteria

## Architecture/packaging

- separate customer repositories consume packages;
- no copied core;
- no K-Nex database provider package;
- deterministic Payload Postgres scaffold;
- versions/registries match lockfile.

## Backend

- final Payload config boots;
- authenticated source handlers use `req.payload`/domain services;
- collisions identify owners;
- clean/upgrade migrations pass;
- transactions/access policies are testable.

## Sources/UI

- Counter binds scalar source;
- DataTable binds task source and selected columns;
- chart binds category-series source;
- generic blocks import no Sales implementation;
- permission/field/pagination/sort/filter server enforcement;
- missing/disabled/versioned sources fail safely.

## Realtime

- invalidation only after commit;
- authorization-scoped delivery;
- authenticated endpoint refetch;
- reconnect recovery;
- streams not required for ordinary widgets.

## Builder/themes

- fixed shell and profile restrictions;
- internal sources blocked from public publish;
- same block renders across themes;
- no executable query/code in documents;
- canonical Puck round-trip.

## Operations

- Cargo upgrades independently of Restaurant;
- package/source/theme/migration inventory visible;
- backup/restore proof;
- no secrets in source/logs.

# Rejection criteria

## Reject Payload if

- deterministic composition requires deep fork;
- authenticated source handlers cannot preserve access/transactions;
- migrations/types are unreliable;
- required topology is unreasonable;
- upgrades impose unacceptable coupling.

## Reject Puck if

- canonical document cannot round-trip;
- fixed-shell/profile/source restrictions cannot be enforced;
- source/field binding requires unstable deep fork;
- domain modules leak Puck types;
- realistic layouts fail accessibility/performance.

Fallback: Craft.js through same K-Nex contracts.

# Research phases

## Phase 0 — Tooling/package spike

```text
monorepo decision
registry/scope proof
pnpm/Changesets/test conventions
minimal CI
hello-world publish/install
```

## Phase 1 — Manifest, CLI, graph, Payload scaffold

```text
schemas/catalog/resolver
create-k-nex-app
plan/sync/generate/doctor
Payload Postgres generator
Docker Postgres scaffold
static registries/inventory
failure fixtures
```

Exit: two manifests generate bootable independent Payload/Postgres repos.

## Phase 2 — Payload composition, access, migrations

```text
contribution phases
collision diagnostics
actor/permission foundations
domain service conventions
clean/upgrade migrations
```

## Phase 3 — Sales sources and generic components

```text
defineDataSource
standard authenticated source gateway
Sales scalar/table/category sources
source permissions/fields
Counter/DataTable/PieChart
query cache/invalidation abstraction
```

## Phase 4 — Shell, themes, builder profiles

```text
semantic primitives
fixed shell/navigation
Minimal/Neobrutalism themes
canonical document
Puck adapter
CMS/workspace profiles
source/column picker
```

## Phase 5 — Realtime and driver

```text
local realtime provider
authenticated subscriptions
post-commit invalidation
Redis experiment
minimal driver client
```

## Phase 6 — Lifecycle/operations

```text
disable/uninstall/purge
source/block/theme migrations
provider replacement
reusable deployment
release inventory
backup/restore
independent upgrade
```

# Implementation order

```text
contracts/schemas
  → catalog/resolver
  → CLI + Payload Postgres scaffold
  → customer fixtures
  → Payload composition/access/migrations
  → Sales + source gateway
  → Counter/DataTable/chart bindings
  → realtime invalidation
  → shell/primitives/themes
  → canonical document/Puck profiles
  → logistics driver and restaurant slices
  → lifecycle/operations
```

Do not begin with full CRM, dispatch optimization, inventory accounting, budgeting, production GPS history, visual SQL, broad database portability, or marketplace work.

# Research output

- working platform and two customer repositories;
- ADR updates;
- measured Payload/Puck/source/realtime results;
- plugin/source authoring guide;
- theme/builder guide;
- CLI/customer application guide;
- compatibility/migration/security report;
- deployment runbooks;
- known limitations;
- explicit go/no-go decisions for Payload, Puck, source gateway, committed registries, layout inheritance, and realtime topology.
