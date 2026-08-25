# Research Plan and Proof of Concept

## Objective

The research phase must prove that K-Nex can generate independently deployed Payload applications from a declarative specification and compose:

```text
Payload + Postgres
K-Nex modules/providers/themes/builder
plugin-owned authenticated data sources
canonical and plugin-owned output contracts
style-agnostic reusable UI blocks
CMS/workspace visual composition
secure realtime invalidation
customer-owned migrations and deployment
```

The goal is not to finish a production CRM, logistics suite, restaurant ERP, analytics platform, visual query builder, or broad universal contract catalog. The goal is to validate the architecture's riskiest assumptions through narrow vertical slices.

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

Collections, globals, services, access, endpoints, jobs, sources, contracts, and admin contributions compose deterministically.

## H-005 — Modules expose deliberate authenticated data sources

A Sales module exposes:

```text
sales.total-potential-revenue
sales.tasks
sales.opportunities-by-stage
sales.revenue-over-time
```

without exposing raw collections or database access.

## H-006 — Generic components consume canonical output contracts

```text
Counter/Metric   ← metric.scalar@1
DataTable        ← table.records@1
Pie/BarChart     ← series.category@1
Line/AreaChart   ← series.time@1
```

Generic blocks do not import Sales implementation code.

## H-007 — Exact source schemas conform to declared contracts

A source result passes both its source-specific schema and canonical/plugin-owned output contract. Declaring a contract ID without conformance fails.

## H-008 — Stable source fields survive storage refactors

DataTable fields use opaque stable IDs such as `assignee`, not nested Payload paths such as `assignee.name`. Builder documents remain valid when internal projections change without semantic field changes.

## H-009 — Source authorization survives client manipulation

Payload session, source permission, record policy, and field policy are enforced server-side for discovery, execution, output, and realtime subscription.

## H-010 — Realtime invalidation/refetch is reliable

After a committed mutation, authorized active source queries are invalidated and refetched. Missed messages/reconnect recover through the source endpoint.

## H-011 — One UI contract supports CMS and workspace profiles

Same canonical block/layout/binding model supports public pages and authenticated dashboards with different palettes, security, and publication rules.

## H-012 — Puck remains an adapter

Puck round-trips canonical K-Nex documents without leaking types into domain modules or requiring a deep fork.

## H-013 — Style-agnostic module UI renders through different themes

Same components render accessibly under Minimal, Neobrutalism, and one materially different public theme/profile.

## H-014 — Customer-owned migrations remain manageable

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
- collision ownership for collection slugs, routes, permissions, events, jobs, sources, contracts, actions, blocks;
- disabled schema-owning module behavior;
- server/client export separation.

## Data sources and output contracts

- exact `defineDataSource` and contract-specific helper APIs;
- descriptor/handler separation;
- standard source gateway path/method;
- Payload auth and record/field policy;
- schema library and JSON-schema generation;
- source-specific plus canonical output validation;
- stable table field metadata;
- pagination/sort/filter allowlists;
- source/contract versioning and migrations;
- actor-filtered descriptor hash;
- discovery behavior by surface/audience/permission;
- public versus internal source isolation;
- actor-scoped cache/query-key policy;
- plugin-owned contract registration;
- production output-validation cost.

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
- Metric/DataTable/chart source picker;
- stable source field/column picker;
- shared page filters/state;
- contract/component constraints;
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
- source/contract/field migrations;
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

Canonical output contracts initially live in `@k-nex/ui-contracts`:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

The first POC implements the first four. The last two can follow after the counter/table/chart slice.

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

## `sales.total-potential-revenue`

Output contract:

```text
metric.scalar@1
```

Example:

```json
{
  "value": {
    "kind": "money",
    "amount": "325000.00",
    "currency": "TRY"
  },
  "comparison": {
    "mode": "percentage",
    "delta": 12.5,
    "sentiment": "positive",
    "baselineLabel": "Previous quarter"
  }
}
```

Inputs can include date range, stage IDs, owner, and branch context.

## `sales.tasks`

Output contract:

```text
table.records@1
```

Stable fields:

```text
title             text      selectable/sortable/filterable
status            text/enum selectable/sortable/filterable
dueAt             datetime  selectable/sortable/filterable
assignee          resource  selectable
opportunity       resource  selectable
potentialRevenue  money     separately permission-protected when projected
```

The source does not expose `assignee.name` or another nested Payload path as a builder field ID.

Supports bounded pagination and allowlisted sorting/filtering.

## `sales.opportunities-by-stage`

Output contract:

```text
series.category@1
```

Used by PieChart/BarChart. Aggregation happens server-side.

## `sales.revenue-over-time`

Output contract:

```text
series.time@1
```

Used by LineChart/AreaChart. Bucketing, timezone, result bounds, and rounding are source-owned.

## Plugin-owned contract proof

Implement one small Sales-only domain block/source, for example:

```text
sales.pipeline-mini-board
  → sales.pipeline-board@1
```

This proves the hybrid contract path without adding an opaque extension bag to canonical contracts.

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
6. Adds Metric bound to `sales.total-potential-revenue`.
7. Adds PieChart bound to `sales.opportunities-by-stage`.
8. Adds LineChart bound to `sales.revenue-over-time`.
9. Adds DataTable bound to `sales.tasks`.
10. Selects `title`, `status`, `dueAt`, and `assignee` field IDs.
11. Publishes role layout.
12. Opportunity/task changes invalidate active queries.
13. Metric/charts/table refetch, revalidate, and rerender.

## Security journey

1. Sales manager sees revenue source/field.
2. Staff role can see tasks but lacks revenue permission.
3. Revenue source/field is absent from actor-filtered discovery.
4. Manual request is denied server-side.
5. Manual WebSocket subscription to unauthorized scope is denied.
6. Another branch's records remain inaccessible.
7. Handler returning an undeclared field fails closed.

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
6. Same builder/runtime/output-contract/theme foundations remain unchanged.

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
Sales permissions/events/sources/contracts/blocks
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

# Data-source and output-contract scenarios

## Metric

- authorized source discovery;
- exact source schema plus `metric.scalar@1` validation;
- semantic money formatting in UI;
- loading/empty/error/forbidden states;
- realtime invalidation/refetch.

## DataTable

- actor-filtered stable field descriptors;
- selected fields persisted;
- allowlisted pagination/sort/filter;
- field-level permission;
- null versus omitted behavior;
- task mutation invalidation;
- reconnect recovery.

## Category/time charts

- source returns canonical server-aggregated series;
- PieChart enforces one-series/nonnegative constraints;
- LineChart validates ordered RFC-3339 points and bounded result size;
- no browser group-by/sum or raw record fetch.

## Shared filters

- date filter writes page state;
- metric/chart/table bind source params to state;
- state changes create validated query keys;
- invalid/cyclic bindings fail.

## Contract conformance failure

- source declares `table.records@1` but returns unknown top-level shape;
- source returns undeclared table field;
- source returns invalid scalar/currency/date;
- runtime rejects with `SOURCE_OUTPUT_INVALID` and leaks no payload.

## Descriptor/source versions

- additive optional field changes descriptor hash only;
- removing/renaming selected field requires source migration;
- source can move from `sales.tasks@1` to `@2` while remaining on `table.records@1`;
- contract major change is tested independently.

## Source disable/version migration

- disabled source gives safe unavailable state;
- layout remains stored;
- source field/version migration updates fixtures;
- publication/readiness detects incompatible references.

## Query sharing

Two blocks using the same source, validated params, selected fields, surface, and actor scope reuse one active query result.

# Deliberate failure tests

## Database abstraction regression

Attempt to add `provider.database-postgres` or `@k-nex/database-postgres`.

Expected: manifest/contracts reject; scaffold uses `@payloadcms/db-postgres`.

## Duplicate source or contract

Two plugins register the same source ID or conflicting ownership of the same plugin-contract ID.

Expected: generation fails naming both owners.

## False contract declaration

Source declares `metric.scalar@1` but its exact output schema/result is incompatible.

Expected: registration/test or execution fails closed.

## Unauthorized source

Actor requests revenue source without permission.

Expected: forbidden, no leakage.

## Unauthorized field

Actor requests protected revenue field.

Expected: discovery omits and execution rejects/omits according to contract.

## Raw nested field path

Builder/request attempts `assignee.name` or another undeclared object path.

Expected: descriptor/input validation fails.

## Opaque extension payload

Canonical result attempts unrestricted `extensions` data.

Expected: canonical contract validation fails.

## Multi-output source

One source attempts unrelated table, metric, and chart outputs.

Expected: source authoring/contract review rejects; split into separate projections.

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

## Unbounded table/series

Request unsupported page size/sort/filter or excessive series points.

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

## Sources and contracts

- Metric binds `metric.scalar@1`;
- DataTable binds `table.records@1` and stable selected fields;
- Pie/BarChart binds `series.category@1`;
- LineChart binds `series.time@1`;
- generic blocks import no Sales implementation;
- exact source schema and declared contract both validate;
- source/contract/package versions remain distinct;
- actor-filtered descriptor hash works;
- permission/field/pagination/sort/filter are server-enforced;
- missing/disabled/versioned sources fail safely;
- plugin-owned contract path works without opaque canonical extensions.

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
- canonical Puck round-trip preserves source/contract identity.

## Operations

- Cargo upgrades independently of Restaurant;
- package/source/contract/theme/migration inventory visible;
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
- source/field/contract binding requires unstable deep fork;
- domain modules leak Puck types;
- realistic layouts fail accessibility/performance.

Fallback: Craft.js through the same K-Nex contracts.

## Narrow output-contract scope if

- canonical contracts require many source-specific exceptions;
- generic blocks cannot preserve domain semantics safely;
- runtime validation/caching cost is unacceptable after measurement.

The fallback is more module-owned/domain-specific blocks, not arbitrary JSON, raw Payload paths, or builder-authored code.

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

## Phase 3 — Output contracts, Sales sources, and generic components

```text
metric.scalar/table.records/series.category/series.time schemas
source-specific contract helpers and conformance tests
defineDataSource and standard authenticated source gateway
Sales metric/table/category/time sources
actor-filtered descriptor hash and stable fields
Metric/DataTable/PieChart/LineChart
query sharing/cache identity
```

## Phase 4 — Shell, themes, builder profiles

```text
semantic primitives
fixed shell/navigation
Minimal/Neobrutalism themes
canonical document
Puck adapter
CMS/workspace profiles
source/field picker
plugin-owned contract proof
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
source/field/contract/block/theme migrations
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
  → canonical output contracts
  → Sales + source gateway
  → Metric/DataTable/chart bindings
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
- measured Payload/Puck/source/contract/realtime results;
- plugin/source/output-contract authoring guide;
- theme/builder guide;
- CLI/customer application guide;
- compatibility/migration/security report;
- deployment runbooks;
- known limitations;
- explicit go/no-go decisions for Payload, Puck, source gateway, contract catalog, committed registries, layout inheritance, and realtime topology.
