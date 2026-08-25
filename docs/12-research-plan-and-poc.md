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
conservative proven implementation packages behind K-Nex adapters
```

The goal is not to finish a production CRM, logistics suite, restaurant ERP, analytics platform, visual query builder, or broad universal contract catalog. The goal is to validate the architecture's riskiest assumptions through narrow vertical slices.

The accepted implementation package families are defined in [Technology and Package Baseline](./26-technology-package-baseline.md). A package passing its own documentation/examples is insufficient; it must also pass the K-Nex boundary, security, SSR, migration, accessibility, and customer-fixture tests below.

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

## H-015 — Implementation packages do not redefine K-Nex contracts

The selected package stack remains behind K-Nex boundaries:

```text
Zod/Ajv              validation implementation
TanStack Query       source-result cache implementation
Zustand               ephemeral UI-state implementation
React Aria           semantic primitive implementation
TanStack Table       DataTable engine implementation
Apache ECharts       chart renderer implementation
Socket.IO            realtime transport implementation
Puck                 builder implementation
```

No domain plugin public API or persisted document contains their engine-specific runtime types/configuration.

## H-016 — Conservative version policy produces reproducible customer releases

Generated customers pin one tested Node/Payload/Next/React/package tuple. New major versions do not enter customer applications until compatibility, migration, accessibility, performance, and rollback fixtures pass.

# Key research questions

## Packaging and CLI

- first-party monorepo topology;
- GitHub Packages/private registry auth;
- final npm scope;
- exact Node 24, pnpm, Payload, Next.js, React, and Postgres-adapter tuple;
- static manifest reading without runtime execution;
- deterministic generated registries;
- pnpm workspace and install-script policy;
- Turborepo task/cache boundaries;
- Changesets release behavior;
- dependency-cruiser architecture rules;
- publint/Are-the-Types-Wrong packed-package checks;
- interactive/non-interactive parity;
- plan/apply rollback;
- secret-safe environment generation.

## Payload scaffold

- exact Payload/Next project template;
- generated Postgres adapter code;
- Docker Postgres startup and external URL operation;
- request/transaction context propagation;
- type generation and migration commands;
- Payload Jobs worker/scheduler commands;
- framework upgrade boundaries.

## Module composition

- explicit contribution phases;
- collision ownership for collection slugs, routes, permissions, events, jobs, sources, contracts, actions, blocks;
- disabled schema-owning module behavior;
- server/client export separation;
- enforcement that domain plugins cannot import Puck, Socket.IO, ECharts, TanStack Query/Table, or Zustand implementation types.

## Data sources and output contracts

- exact `defineDataSource` and contract-specific helper APIs;
- descriptor/handler separation;
- standard source gateway path/method;
- Payload auth and record/field policy;
- Zod 4 schema helper restrictions;
- Zod-to-JSON-Schema generation and parity;
- Ajv 8 strict compile/reuse strategy for static artifacts;
- source-specific plus canonical output validation;
- stable table field metadata;
- pagination/sort/filter allowlists;
- source/contract versioning and migrations;
- actor-filtered descriptor hash;
- discovery behavior by surface/audience/permission;
- public versus internal source isolation;
- actor-scoped TanStack Query key/cache policy;
- plugin-owned contract registration;
- production output-validation cost.

## Realtime

- Payload-authenticated Socket.IO handshake;
- per-source/topic/scope subscription authorization;
- invalidation message format;
- TanStack Query key matching;
- reconnect, resync, and permission refresh;
- single-instance in-memory adapter;
- Redis 7 sharded adapter with ioredis for multi-instance mode;
- connection draining;
- when snapshot + typed stream is required;
- workload threshold for considering a future raw WebSocket provider.

## UI and builder

- fixed shell plus editable canvas;
- React Aria Component coverage behind K-Nex semantic primitives;
- CSS-variable/theme recipe mapping;
- Metric/DataTable/chart source picker;
- stable source field/column picker;
- TanStack Table v8 server/manual-mode adapter;
- parallel TanStack Table v9 compatibility benchmark without public API leakage;
- TanStack Virtual accessibility behavior;
- Apache ECharts adapter generated only from canonical contracts;
- ECharts ARIA/tabular fallback and injection resistance;
- React Hook Form + Zod property editor behavior;
- scoped Zustand vanilla store lifetime and SSR/hydration;
- shared page filters/state;
- contract/component constraints;
- canonical document round-trip;
- profile-specific palette/security;
- missing/disabled source fallback;
- layout inheritance/storage.

## Themes

- safe server/client token generation;
- React Aria semantic primitive recipes/overrides;
- ECharts/TanStack Table theme-token adapters;
- draft/preview/publish/rollback;
- accessibility validation;
- schema migrations without auto-publish.

## Logging, telemetry, and jobs

- Pino redaction and correlation context;
- development-only pretty transport;
- OpenTelemetry API hooks with no required exporter;
- server traces/metrics without unstable browser instrumentation;
- Payload Jobs retry/scheduling/worker topology;
- threshold that would justify an external job/queue provider.

## Testing

- Vitest unit/contract/CLI/module fixtures;
- React Testing Library semantic primitive/component tests;
- Playwright auth/builder/theme/source/realtime journeys across browser engines;
- Testcontainers PostgreSQL clean/upgrade/transaction tests;
- packed-package install fixtures;
- deliberate dependency-cruiser violations;
- newly stable major-version compatibility branch.

## Migrations and lifecycle

- plugin addition and customer migration generation;
- source/contract/field migrations;
- disable/uninstall/purge boundaries;
- stored layout/source reference scans;
- clean and previous-release upgrades;
- independent customer rollout.

# POC package scope

## First-party packages

```text
@k-nex/contracts
@k-nex/core
@k-nex/cli
@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-shell
@k-nex/ui-design-system-contracts
@k-nex/ui-data-table
@k-nex/ui-visualization-echarts
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
@k-nex/provider-realtime-socketio
```

## Framework/runtime baseline

```text
Node.js 24 LTS
Payload
Next.js/React exact Payload-supported tuple
@payloadcms/db-postgres
Payload Jobs Queue
```

There is no `@k-nex/database-postgres` package.

## Third-party implementation baseline

```text
zod@4
ajv@8
ajv-formats
@tanstack/react-query@5
zustand@5
react-aria-components
react-hook-form
@hookform/resolvers
@tanstack/react-table@8
@tanstack/react-virtual
echarts@6
socket.io@4
socket.io-client@4
@socket.io/redis-adapter
ioredis
pino
@opentelemetry/api
vitest@4
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
@playwright/test
testcontainers
@testcontainers/postgresql
commander
@inquirer/prompts
execa
semver
dependency-cruiser
publint
@arethetypeswrong/cli
```

Exact patches are selected and pinned when implementation begins. They are not floated to `latest` in generated customer applications.

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
provider.realtime.socketio
builder.puck
CMS + workspace profiles
theme.minimal (admin)
theme.neobrutalism (public)
```

## Workspace journey

1. Admin logs in.
2. React Aria-based module navigation appears in the fixed shell.
3. Admin creates opportunities and tasks.
4. Admin opens workspace builder.
5. Adds date-range filter backed by a scoped Zustand page store.
6. Adds Metric bound to `sales.total-potential-revenue`.
7. Adds PieChart bound to `sales.opportunities-by-stage` through the ECharts adapter.
8. Adds LineChart bound to `sales.revenue-over-time` through the ECharts adapter.
9. Adds DataTable bound to `sales.tasks` through the TanStack Table adapter.
10. Selects `title`, `status`, `dueAt`, and `assignee` field IDs.
11. Publishes role layout.
12. Opportunity/task changes produce Socket.IO invalidation messages.
13. TanStack Query refetches, contract validation runs, and Metric/charts/table rerender.

## Security journey

1. Sales manager sees revenue source/field.
2. Staff role can see tasks but lacks revenue permission.
3. Revenue source/field is absent from actor-filtered discovery.
4. Manual request is denied server-side.
5. Manual Socket.IO subscription to unauthorized scope is denied.
6. Another branch's records remain inaccessible.
7. Handler returning an undeclared field fails closed.
8. No client cache entry crosses actor/session scope.

## CMS journey

1. Editor composes cargo landing page.
2. Adds public content blocks and explicit public tracking form/source.
3. Internal Sales sources do not appear.
4. Draft preview requires editor authentication.
5. Public publish uses Neobrutalism theme.

## Realtime/driver journey

1. Assignment/task commits.
2. Authorized driver receives invalidation/update through the Socket.IO provider.
3. Driver fetches authoritative projection.
4. Another driver cannot subscribe/fetch.
5. Reconnect triggers resynchronization even when connection recovery is incomplete.

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
6. Same builder/runtime/output-contract/theme/package foundations remain unchanged.

# CLI scenarios

## Interactive creation

```bash
pnpm create k-nex-app client-acme-cargo-poc
```

Verify Node/PackageManager pins, Payload Postgres adapter package/config, and selected exact K-Nex/third-party packages.

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

Expected: logistics core and `realtime.gateway` provider proposed.

## Realtime topology replacement

```text
Socket.IO in-memory adapter
  → Socket.IO Redis 7 sharded adapter + ioredis
```

Driver/domain code and `realtime.gateway` contract remain unchanged; infrastructure impact is reported.

## Disable/remove/purge

Different package/schema/source/layout behavior; purge refuses without readiness/backup/confirmation.

## Stale generation

Manifest edit without generate makes CI fail.

## Secret safety

External `DATABASE_URL`, Redis credentials, and Payload secrets are written only to ignored/deployment secret stores and redacted.

# Data-source and output-contract scenarios

## Metric

- authorized source discovery;
- exact Zod source schema plus `metric.scalar@1` validation;
- semantic money formatting in UI;
- loading/empty/error/forbidden states;
- TanStack Query caching and Socket.IO invalidation/refetch.

## DataTable

- actor-filtered stable field descriptors;
- selected fields persisted;
- allowlisted pagination/sort/filter;
- field-level permission;
- null versus omitted behavior;
- TanStack Table manual/server mode;
- task mutation invalidation;
- reconnect recovery;
- optional TanStack Virtual fixture without semantic/accessibility regression.

## Category/time charts

- source returns canonical server-aggregated series;
- PieChart enforces one-series/nonnegative constraints;
- LineChart validates ordered RFC-3339 points and bounded result size;
- ECharts options are generated only inside the adapter;
- ECharts ARIA description and tabular/semantic fallback are present;
- no browser group-by/sum, raw record fetch, formatter function, or user-authored ECharts option.

## Shared filters

- date filter writes scoped Zustand page state;
- metric/chart/table bind source params to state;
- state changes create validated K-Nex/TanStack Query keys;
- SSR/request boundaries do not share stores;
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

Two blocks using the same source, validated params, selected fields, surface, and actor scope reuse one active TanStack Query result. A different actor or field-permission projection receives a different cache identity.

# Technology-package scenarios

## Zod and Ajv parity

1. Author a contract/manifest schema in Zod 4.
2. Generate JSON Schema.
3. Validate static JSON through a compiled strict Ajv 8 validator.
4. Run golden valid/invalid fixtures through both paths where semantics overlap.
5. Reject schema patterns whose generated JSON Schema cannot preserve required meaning.
6. Confirm Ajv validators compile once and are reused.

## React Aria and themes

1. Render Button, Dialog, Menu, Select/ComboBox, Tabs, and form fields through K-Nex semantic primitives.
2. Apply Minimal and Neobrutalism theme packages without component implementation branches.
3. Complete keyboard and screen-reader smoke journeys.
4. Confirm domain modules import K-Nex primitives rather than React Aria implementation when a primitive exists.

## TanStack Table v8 and v9 gate

1. V1 fixture runs on v8 through `@k-nex/ui-data-table`.
2. Parallel compatibility branch runs the same fixture against v9.
3. Compare API adaptation, TypeScript cost, bundle size, row-model performance, accessibility, and upgrade changes.
4. Keep v8 until v9 passes the new-major gate; plugin contracts remain unchanged either way.

## Socket.IO topology

1. Single-instance in-memory adapter passes auth/invalidation/reconnect tests.
2. Two application instances with Redis 7 sharded adapter receive scoped invalidations.
3. Kill/restart a connection and confirm authoritative source refetch.
4. Confirm no module imports Socket.IO types.

## Payload Jobs

1. Execute one scheduled cleanup, one retryable source projection job, and one event/outbox processing job.
2. Run worker separately from web.
3. Confirm idempotency and transaction/after-commit behavior.
4. Record measured reasons before proposing BullMQ/Temporal or another queue.

## Package integrity

1. `dependency-cruiser` rejects deliberate forbidden imports and cycles.
2. `publint` and `@arethetypeswrong/cli` pass every packed publishable package.
3. A clean generated customer installs from packed/released artifacts, not workspace source assumptions.
4. Exact dependency tuple appears in build inventory.

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

## Arbitrary query/code/library configuration

Inject SQL, raw Payload where object, arbitrary URL, JavaScript/import/secret, raw ECharts option, Socket.IO event config, TanStack column definition, or Puck-native document data into a K-Nex stored contract.

Expected: schema validation or architecture boundary failure.

## Unbounded table/series

Request unsupported page size/sort/filter or excessive series points.

Expected: input/cost limit failure.

## Missed realtime message

Disconnect during mutation, reconnect.

Expected: endpoint refetch recovers current data regardless of connection recovery outcome.

## Global Zustand store

Create module-global mutable UI state and issue concurrent SSR requests.

Expected: dependency/SSR fixture fails; store must be created per document/provider.

## Cross-actor TanStack Query cache

Attempt to hydrate/share a protected query result into another actor session.

Expected: query-key/hydration isolation test fails closed.

## Engine-type leakage

Import Puck, Socket.IO, ECharts, TanStack Query/Table, Zustand, or React Aria implementation types from a domain plugin contract export.

Expected: dependency-cruiser/package-boundary test fails.

## Premature major upgrade

Upgrade TanStack Table or another baseline-sensitive major without compatibility fixture/approval.

Expected: version-policy CI check blocks the change.

# Acceptance criteria

## Architecture/packaging

- separate customer repositories consume packages;
- no copied core;
- no K-Nex database provider package;
- deterministic Node 24/Payload/Next/React/Postgres scaffold;
- exact versions/registries match lockfile/build inventory;
- pnpm/Turborepo/Changesets workflow works;
- dependency-cruiser enforces package boundaries;
- publint/Are-the-Types-Wrong/packed-install checks pass.

## Backend and validation

- final Payload config boots;
- authenticated source handlers use `req.payload`/domain services;
- collisions identify owners;
- clean/upgrade migrations pass through real Postgres;
- transactions/access policies are testable;
- Zod and generated JSON Schema/Ajv paths agree for required fixtures;
- Ajv validators are strict, non-mutating, and compiled/reused;
- Payload Jobs worker/scheduler fixture passes.

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

## UI package boundaries

- React Aria semantic primitives work under at least two themes;
- React Hook Form property editors are server-revalidated by Zod;
- TanStack Query remains behind K-Nex source client/query-key APIs;
- Zustand is scoped and contains no business/source data;
- TanStack Table remains behind K-Nex DataTable contracts;
- ECharts remains behind canonical-series adapter and receives no user-authored raw option;
- Puck types remain inside builder adapter.

## Realtime

- Socket.IO invalidation occurs only after commit;
- authorization-scoped delivery works;
- authenticated endpoint refetch works;
- reconnect/resync works in single and Redis-backed modes;
- streams are not required for ordinary widgets;
- Socket.IO implementation types do not leak into modules.

## Builder/themes

- fixed shell and profile restrictions;
- internal sources blocked from public publish;
- same block renders across themes;
- no executable query/code/library configuration in documents;
- canonical Puck round-trip preserves source/contract identity;
- React Aria semantics remain accessible under theme changes.

## Testing and operations

- Vitest contract suites pass;
- React Testing Library semantic component tests pass;
- Playwright passes required Chromium/Firefox/WebKit journeys;
- Testcontainers proves migrations/transactions;
- Cargo upgrades independently of Restaurant;
- package/source/contract/theme/migration inventory is visible;
- backup/restore proof exists;
- Pino redaction prevents secrets in logs;
- OpenTelemetry API absence/presence does not change business behavior.

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

## Replace one baseline implementation if

- it cannot remain behind the K-Nex adapter boundary;
- measured performance/accessibility is insufficient;
- project/security support becomes unacceptable;
- Payload/Next compatibility cannot be maintained;
- a replacement passes the same contracts with lower total migration and operational risk.

Replacing one implementation does not authorize changing persisted K-Nex contracts casually.

# Research phases

## Phase 0 — Tooling/package spike

```text
monorepo decision
registry/scope proof
Node 24 and pnpm pins
Turborepo/Changesets conventions
ESLint/Prettier/dependency-cruiser rules
publint/Are-the-Types-Wrong packed-package fixture
minimal CI
hello-world publish/install
```

## Phase 1 — Manifest, CLI, graph, Payload scaffold

```text
Zod schemas and generated JSON Schema
strict compiled Ajv validators
catalog/resolver
Commander/Inquirer/Execa CLI
create-k-nex-app
plan/sync/generate/doctor
Payload Postgres generator
Docker Postgres scaffold
static registries/inventory
failure fixtures
```

Exit: two manifests generate bootable independent Payload/Postgres repos with exact package tuples.

## Phase 2 — Payload composition, access, migrations, jobs

```text
contribution phases
collision diagnostics
actor/permission foundations
domain service conventions
Payload Jobs web/worker/scheduler fixture
clean/upgrade Testcontainers migrations
Pino correlation/redaction
OpenTelemetry API hooks
```

## Phase 3 — Output contracts, Sales sources, and generic components

```text
metric.scalar/table.records/series.category/series.time schemas
source-specific contract helpers and conformance tests
defineDataSource and standard authenticated source gateway
TanStack Query source client/key factory
Sales metric/table/category/time sources
actor-filtered descriptor hash and stable fields
TanStack Table v8 DataTable adapter
ECharts visualization adapter
Metric/DataTable/PieChart/LineChart
query sharing/cache identity
```

## Phase 4 — Shell, state, themes, builder profiles

```text
React Aria semantic primitives
scoped Zustand state runtime
React Hook Form property editors
fixed shell/navigation
Minimal/Neobrutalism themes
canonical document
Puck adapter
CMS/workspace profiles
source/field picker
plugin-owned contract proof
TanStack Table v9 parallel compatibility fixture
```

## Phase 5 — Realtime and driver

```text
Socket.IO provider with in-memory adapter
Payload-authenticated subscriptions
post-commit invalidation
Redis 7 sharded adapter + ioredis experiment
reconnect/resync tests
minimal driver client
```

## Phase 6 — Lifecycle/operations

```text
disable/uninstall/purge
source/field/contract/block/theme migrations
provider topology replacement
reusable deployment
release inventory
backup/restore
independent upgrade
major-version adoption gate proof
```

# Implementation order

```text
package/runtime pins and architecture linting
  → contracts/Zod schemas/JSON Schema/Ajv
  → catalog/resolver
  → CLI + Payload Postgres scaffold
  → customer fixtures
  → Payload composition/access/migrations/jobs
  → canonical output contracts
  → Sales + source gateway + TanStack Query client
  → Metric/TanStack DataTable/ECharts chart bindings
  → Socket.IO invalidation
  → React Aria shell/Zustand state/forms/themes
  → canonical document/Puck profiles
  → logistics driver and restaurant slices
  → lifecycle/operations/major-upgrade gate
```

Do not begin with full CRM, dispatch optimization, inventory accounting, budgeting, production GPS history, visual SQL, broad database portability, marketplace work, or framework/library churn outside the accepted baseline.

# Research output

- working platform and two customer repositories;
- ADR updates;
- measured Payload/Puck/source/contract/realtime/package results;
- plugin/source/output-contract authoring guide;
- technology/package compatibility matrix;
- theme/builder guide;
- CLI/customer application guide;
- compatibility/migration/security report;
- deployment runbooks;
- known limitations;
- explicit go/no-go decisions for Payload, Puck, source gateway, contract catalog, committed registries, layout inheritance, Socket.IO topology, TanStack Table major, and baseline package boundaries.
