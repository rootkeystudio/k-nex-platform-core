# Plugin Data Sources, UI Bindings, and Realtime Invalidation

## Purpose

K-Nex modules can expose small, purpose-built, authenticated data endpoints that reusable UI components consume through the visual builder.

The intended experience is:

```text
1. Install/enable the Sales module.
2. Sales registers data sources such as:
     sales.total-opportunities
     sales.tasks
     sales.opportunities-by-stage
3. Add a Counter block to a CMS/workspace page.
4. Select Sales → Total opportunities as its data source.
5. Add a Data Table block.
6. Select Sales → Tasks and choose visible columns.
7. When Sales data changes, the realtime layer invalidates affected queries.
8. Connected components refetch and render current authorized data.
```

K-Nex does not expose module databases, Payload collections, raw React stores, or unrestricted query builders to the page editor. A module deliberately defines each projection that can be consumed.

## Accepted decision

> A K-Nex module owns and registers typed data-source handlers. The K-Nex runtime mounts them behind a standard authenticated execution API, validates inputs and outputs, enforces module permissions and record access, and exposes safe descriptors to the builder. Realtime notifications normally invalidate/refetch those sources rather than treating WebSocket messages as the authoritative state.

## Conceptual architecture

```text
Sales module
  ├── collections/domain services
  ├── permissions/access policy
  ├── data-source descriptors
  ├── data-source handlers using req.payload
  └── invalidation rules/events
          │
          ▼
K-Nex data-source registry/runtime
  ├── authenticated discovery
  ├── schema validation
  ├── permission/record policy
  ├── query execution
  ├── cache/query-key metadata
  ├── observability/audit
  └── realtime invalidation bridge
          │
          ▼
Builder/runtime components
  ├── Counter
  ├── Metric
  ├── DataTable
  ├── PieChart
  ├── BarChart
  └── custom module/customer blocks
```

The module owns the data meaning and query implementation. K-Nex owns a consistent secure transport and binding contract.

# Core terminology

## Data source

A data source is a registered, versioned, server-executed query/projection owned by a plugin.

Examples:

```text
sales.total-opportunities
sales.tasks
sales.opportunities-by-stage
crm.contacts
logistics.shipments-by-status
inventory.low-stock-items
restaurant.sales-by-category
```

A source is not:

- a raw Payload collection exposed automatically;
- an arbitrary REST/GraphQL URL stored in a layout;
- SQL written by an editor;
- a browser-side aggregation over unrestricted records;
- a module's internal React state.

## Data-source descriptor

Static/browser-safe metadata used by the registry and builder:

```text
stable ID and version
plugin ownership
display name/category/description
allowed surfaces and audiences
required permission
input schema
output contract/schema
available fields and capabilities
pagination/sort/filter policy
cache/realtime policy
sensitivity metadata
```

The descriptor contains no secret and no server implementation.

## Data-source handler

Server-only code that uses Payload and module services to produce an authorized projection.

The handler is owned by the module package and registered during application composition.

## Binding

A serializable link from a component input to a registered source, runtime context, static value, or UI state.

Example:

```text
Counter.value
  ← sales.total-opportunities.value
```

## UI state

Page/session/user state used for filters and component coordination:

```text
page.filters.date-range
page.filters.selected-stage
workspace.selected-branch
```

Module business data does not live in UI state. It is fetched from registered module data sources.

## Runtime context

Read-only values supplied by the application:

```text
context.current-user
context.current-role
context.current-branch
context.route.params
context.route.query
context.cms.locale
context.cms.preview-mode
context.workspace.page-id
```

# Source definition contract

Conceptual TypeScript API:

```ts
export const totalOpportunitiesSource = defineDataSource({
  id: 'sales.total-opportunities',
  version: 1,
  pluginId: 'module.sales',

  title: 'Total potential revenue',
  description: 'Sum of potential revenue for opportunities visible to the current actor.',
  category: 'Sales',

  surfaces: ['workspace'],
  audience: ['authenticated'],
  permission: 'sales.opportunities.read',

  input: totalOpportunitiesInputSchema,
  output: scalarMoneyOutputSchema,
  outputContract: 'metric.money@1',

  cache: {
    mode: 'actor-scoped',
    staleTimeMs: 30_000,
  },

  realtime: {
    mode: 'invalidate',
    topics: ['sales.opportunities'],
  },

  execute: async ({ input, req, actor, services }) => {
    return services.salesQueries.totalPotentialRevenue({
      input,
      req,
      actor,
    })
  },
})
```

A table source:

```ts
export const tasksSource = defineDataSource({
  id: 'sales.tasks',
  version: 1,
  pluginId: 'module.sales',

  title: 'Sales tasks',
  category: 'Sales',

  surfaces: ['workspace'],
  audience: ['authenticated'],
  permission: 'sales.tasks.read',

  input: paginatedTasksInputSchema,
  output: taskTableOutputSchema,
  outputContract: 'table.records@1',

  fields: [
    field('title', {
      label: 'Task',
      type: 'text',
      defaultVisible: true,
      sortable: true,
      filterable: true,
    }),
    field('status', {
      label: 'Status',
      type: 'enum',
      options: taskStatusOptions,
      defaultVisible: true,
      sortable: true,
      filterable: true,
    }),
    field('dueAt', {
      label: 'Due date',
      type: 'datetime',
      defaultVisible: true,
      sortable: true,
      filterable: true,
    }),
    field('assignee.name', {
      label: 'Assignee',
      type: 'text',
      defaultVisible: true,
      sortable: false,
      filterable: false,
    }),
    field('potentialRevenue', {
      label: 'Potential revenue',
      type: 'money',
      defaultVisible: false,
      sortable: true,
      filterable: false,
      permission: 'sales.opportunities.revenue.read',
    }),
  ],

  pagination: {
    mode: 'page',
    maximumPageSize: 100,
    defaultPageSize: 20,
  },

  realtime: {
    mode: 'invalidate',
    topics: ['sales.tasks'],
  },

  execute: async ({ input, req, actor, services }) => {
    return services.salesQueries.listTasks({
      input,
      req,
      actor,
    })
  },
})
```

The exact API is provisional, but ownership, schema, authentication, output contract, and invalidation metadata are architectural requirements.

# Payload access

Handlers use the authenticated Payload request instance or module services that receive it.

Example:

```ts
export async function listTasks({
  input,
  req,
}: {
  input: ListTasksInput
  req: PayloadRequest
}) {
  const result = await req.payload.find({
    collection: 'sales-tasks',
    where: buildAuthorizedTaskWhere({
      input,
      actor: req.user,
    }),
    page: input.page,
    limit: input.limit,
    sort: input.sort,
    depth: 1,
    req,
    overrideAccess: false,
  })

  return projectTaskTable(result)
}
```

Rules:

- pass the request when Payload access behavior depends on it;
- ordinary UI data sources use `overrideAccess: false`;
- permissions and record-level policies are enforced server-side;
- handlers return purpose-built DTOs/projections;
- browser code never receives a raw Payload instance or direct database access;
- module business rules remain in services, not generic UI components.

# Endpoint model

## Logical ownership

Every source belongs to a plugin and is implemented by that plugin. It is reasonable to describe this as the plugin's own endpoint.

## Standard runtime mount

The recommended V1 transport is a uniform K-Nex gateway:

```text
GET  /api/k-nex/data-sources
POST /api/k-nex/data-sources/:sourceId/query
GET  /api/k-nex/data-sources/:sourceId/descriptor
```

The registry dispatches the request to the owning plugin handler.

Example:

```http
POST /api/k-nex/data-sources/sales.total-opportunities/query
Content-Type: application/json
Cookie: authenticated Payload session

{
  "dateRange": {
    "preset": "this-quarter"
  }
}
```

Response:

```json
{
  "source": "sales.total-opportunities",
  "version": 1,
  "data": {
    "value": 325000,
    "currency": "TRY"
  },
  "meta": {
    "generatedAt": "2026-08-25T12:00:00.000Z"
  }
}
```

The standardized route gives K-Nex one place for:

- Payload session authentication;
- actor construction;
- permission checks;
- input/output schema validation;
- rate and cost limits;
- request correlation;
- caching policy;
- audit/metrics/logging;
- safe error normalization;
- query-key computation;
- source ownership diagnostics.

A plugin may also register a dedicated domain endpoint where a non-builder client requires it, but builder bindings should use the source registry rather than arbitrary URLs.

## GET versus POST

Simple sources can eventually support GET. V1 can consistently use POST for execution because filters, pagination, sorting, and nested parameters can be structured and schema-validated without placing sensitive query state in URLs.

Source execution remains read-only even when transported with POST.

# Authentication and authorization

## Default policy

Workspace, CMS-admin, system, and driver data sources require an authenticated actor appropriate to their surface.

For an admin/workspace source:

```text
valid Payload admin/user session
+ source permission
+ record-level access policy
+ field-level sensitivity policy
```

The builder palette only shows sources the current editor is allowed to discover. Execution checks authorization again. Hiding a source in the browser is never the security boundary.

## Discovery policy

`GET /api/k-nex/data-sources` returns only descriptors allowed for the current actor, surface, and editing profile.

An editor may have permission to design a page using a source while the eventual viewer has narrower access. Publication/preview must therefore validate the target surface and audience separately.

## Public sources

Public CMS pages never reuse an internal workspace source merely because a component can bind to it.

Explicit public sources use separate IDs and narrow projections:

```text
sales.public-featured-opportunities
restaurant.public-menu
logistics.public-tracking-status
crm.public-lead-form-options
```

Public sources require their own:

- anonymous/signed-session policy;
- rate limits;
- anti-abuse rules;
- cache policy;
- projection schema;
- privacy review.

## Field-level policy

A user may be allowed to list tasks but not see revenue or another sensitive field.

Field metadata can declare permissions. The runtime removes unauthorized fields from discovery and rejects layouts/bindings that request them.

The server projection also omits them. Builder configuration is not trusted as the enforcement mechanism.

# Output contracts

Generic components need predictable data shapes.

Initial contracts can include:

```text
metric.number@1
metric.money@1
metric.percentage@1
list.records@1
table.records@1
series.category@1
series.time@1
series.multi-category@1
geo.features@1
```

## Counter example

Source output:

```json
{
  "value": 325000,
  "currency": "TRY"
}
```

Component binding:

```json
{
  "type": "core.counter",
  "version": 1,
  "props": {
    "label": "Potential revenue"
  },
  "bindings": {
    "value": {
      "kind": "data-source",
      "source": "sales.total-opportunities",
      "sourceVersion": 1,
      "select": "value"
    },
    "currency": {
      "kind": "data-source",
      "source": "sales.total-opportunities",
      "sourceVersion": 1,
      "select": "currency"
    }
  }
}
```

A runtime may execute one source once and satisfy both selections.

## Data table example

Layout configuration:

```json
{
  "type": "core.data-table",
  "version": 1,
  "props": {
    "title": "Open sales tasks",
    "pageSize": 20,
    "columns": [
      { "field": "title", "visible": true },
      { "field": "status", "visible": true },
      { "field": "dueAt", "visible": true },
      { "field": "assignee.name", "visible": true }
    ],
    "defaultSort": [
      { "field": "dueAt", "direction": "asc" }
    ]
  },
  "bindings": {
    "rows": {
      "kind": "data-source",
      "source": "sales.tasks",
      "sourceVersion": 1,
      "params": {
        "status": ["open", "in-progress"]
      }
    }
  }
}
```

The builder's column picker is generated from the source descriptor. It cannot request an arbitrary object path that the source did not declare.

The table sends only allowlisted pagination, sorting, and filter input to the source handler.

# Source parameters and UI state

Example page state:

```json
{
  "states": {
    "page.filters.date-range": {
      "schema": "value.date-range@1",
      "default": {
        "preset": "last-30-days"
      },
      "scope": "page",
      "persistence": "url"
    }
  }
}
```

Date filter block:

```json
{
  "id": "date-filter",
  "type": "core.date-range-filter",
  "bindings": {
    "value": {
      "kind": "state",
      "state": "page.filters.date-range",
      "mode": "two-way"
    }
  }
}
```

Counter source parameter:

```json
{
  "source": "sales.total-opportunities",
  "params": {
    "dateRange": {
      "kind": "state",
      "state": "page.filters.date-range"
    }
  }
}
```

State coordinates filters and selections; it does not replace the source endpoint.

# Builder source picker

The source picker groups descriptors by plugin and category:

```text
Sales
  Total potential revenue
  Tasks
  Opportunities by stage

CRM
  Contacts
  New leads

Logistics
  Shipments by status
  Delayed shipments
```

The picker filters candidates using:

- installed/enabled plugin state;
- current builder profile/surface;
- target audience;
- editor discovery permission;
- component input contract compatibility;
- field-level authorization;
- source version compatibility.

A Counter should not show `table.records@1` sources unless a safe scalar field selection is explicitly supported. A Pie Chart should prefer `series.category@1`. A Data Table should prefer `table.records@1` or an explicitly mappable record list.

# Realtime model

## Principle

The normal source of truth is the authenticated data-source endpoint. WebSocket messages notify clients that cached data is stale.

```text
module mutation commits
  → module/domain event occurs
  → affected source tags are invalidated
  → authorized subscribed clients receive invalidation
  → client refetches source through authenticated endpoint
  → component rerenders
```

This keeps reconnection and missed-message recovery simple: refetch the authoritative projection.

## Source invalidation metadata

A source declares topics/tags that affect it:

```ts
realtime: {
  mode: 'invalidate',
  topics: [
    'sales.tasks',
    'sales.opportunities',
  ],
}
```

After a task mutation:

```ts
await realtime.invalidate({
  topic: 'sales.tasks',
  scope: {
    branchId: task.branchId,
    assigneeId: task.assigneeId,
  },
})
```

The realtime service resolves which connected query subscriptions may be affected.

## Client query identity

A source execution is identified by:

```text
source ID
source version
validated parameters
actor/access scope
surface
```

Conceptual key:

```text
sales.tasks@1 + hash(params) + actor-scope
```

Actor scope must never be shared across authorization boundaries.

## Invalidation message

Conceptual WebSocket message:

```json
{
  "type": "data-source.invalidated",
  "source": "sales.tasks",
  "sourceVersion": 1,
  "topic": "sales.tasks",
  "scope": {
    "branchId": "branch-1"
  },
  "occurredAt": "2026-08-25T12:00:00.000Z"
}
```

The message normally does not contain task records. The client decides which matching active queries to refetch.

## Fine versus coarse invalidation

V1 can begin with coarse source/topic invalidation:

```text
sales.tasks changed
```

It may later add safe scope metadata:

```text
branch
authorized team
record ID
assignee
organization
```

Overly granular invalidation must not leak the existence of unauthorized records.

## Stream mode

Actual data streaming is reserved for sources that genuinely require incremental updates:

```text
vehicle positions
live dispatch telemetry
long-running import progress
active device status
```

A stream-capable source defines:

- authenticated initial snapshot endpoint;
- typed message schema;
- subscription authorization;
- reducer/version semantics;
- reconnect/resync behavior;
- rate/backpressure limits.

Generic task tables, counters, and ordinary charts should use invalidation/refetch first.

# WebSocket security

## Authentication

The realtime connection must authenticate an actor using a supported Payload session/token flow. Opening a socket does not grant access to all module topics.

## Subscription authorization

Each source/topic subscription is checked against:

```text
source descriptor audience/surface
required permission
record/scope policy
current plugin state
current actor/customer application
```

A user who can read their own tasks cannot subscribe to all task changes globally.

## Reauthorization

Permissions, role assignment, session expiry, or plugin enablement can change after connection. The provider must support disconnect, subscription refresh, or reauthorization policy.

## Browser trust

A user can modify client code and manually request any source ID. The server must still reject unauthorized discovery, execution, fields, and realtime subscriptions.

# Caching

Source descriptors define cache classification:

```text
no-store
actor-scoped
role-scoped
public
short-lived
```

V1 safety rules:

- internal authenticated sources default to actor-scoped or no-store;
- cache keys include validated parameters and authorization scope;
- field-level projections cannot share cache entries with broader projections;
- public sources opt into public caching explicitly;
- realtime invalidation is an optimization, not the only expiry mechanism;
- sensitive results never enter static builder documents.

# Error behavior

Standard source errors:

```text
SOURCE_NOT_FOUND
SOURCE_DISABLED
SOURCE_VERSION_UNSUPPORTED
SOURCE_INPUT_INVALID
SOURCE_OUTPUT_INVALID
SOURCE_FORBIDDEN
SOURCE_FIELD_FORBIDDEN
SOURCE_RATE_LIMITED
SOURCE_COST_LIMIT_EXCEEDED
SOURCE_EXECUTION_FAILED
```

The user-facing component receives a safe state:

```text
loading
empty
forbidden
unavailable
error with retry
stale/reconnecting
```

Admin diagnostics can show source/plugin ownership and correlation ID without exposing secret/internal stack data.

# Source lifecycle and versioning

A source has a stable ID and explicit contract version.

```text
sales.tasks@1
sales.tasks@2
```

Compatible additive metadata changes can remain within one version. Breaking input/output/field semantics require a new version and migration strategy.

Stored layouts record source ID/version and selected fields.

When a source changes:

- source migration can rename/remap parameters or fields;
- deprecated fields remain readable for a transition period where feasible;
- the CLI/doctor scans stored documents for incompatible references;
- publication fails when required bindings cannot resolve;
- runtime shows a safe unavailable state rather than crashing the whole page.

# Plugin disable and removal

If Sales is disabled:

- its source descriptors are unavailable for new selection;
- existing bindings are reported as unresolved/disabled;
- execution returns `SOURCE_DISABLED`;
- source subscriptions are removed;
- layout data is retained;
- the page remains renderable with a safe placeholder.

Disabling or removing a plugin never silently rewrites customer layouts.

# Generic visualization and table components

Generic components should live outside domain plugins and consume contracts.

Examples:

```text
core.counter
core.metric
core.data-table
visualization.pie-chart
visualization.bar-chart
visualization.line-chart
visualization.area-chart
```

A generic component does not import the Sales module. It knows only:

- accepted output contracts;
- selectable fields;
- formatting options;
- component events;
- design-system primitives;
- theme tokens.

Domain-specific components can still bind directly to their module source when richer behavior is needed.

# Server aggregation versus browser aggregation

Plugins should expose purpose-built aggregate sources:

```text
sales.total-opportunities
sales.opportunities-by-stage
restaurant.sales-by-category
```

Avoid sending all opportunities/orders to the browser merely to calculate a sum or group.

Reasons:

- minimizes sensitive data exposure;
- preserves server authorization;
- reduces transfer and rendering cost;
- centralizes business calculation semantics;
- enables database-side aggregation;
- produces stable cache/invalidation contracts.

V1 does not include an arbitrary visual SQL/query builder.

# Source authoring guidelines

A module author should create a source when:

- a projection is useful to multiple blocks/screens;
- a metric/aggregate has stable domain meaning;
- a list needs bounded permission-aware pagination;
- builder users need a safe configurable view;
- realtime invalidation can be defined;
- the source can be versioned independently of raw storage shape.

Avoid sources that:

- return entire unrestricted documents;
- expose secret/internal fields;
- duplicate a source without meaningful policy/contract difference;
- have unbounded result size;
- accept arbitrary field/query expressions;
- bypass module services and access policy;
- encode one customer's presentation choices.

# POC scenarios

## Counter

1. Sales registers `sales.total-opportunities`.
2. Builder adds `core.counter`.
3. Source picker shows the metric to an authorized admin.
4. Counter binds to `value` and `currency`.
5. Another role without revenue permission cannot discover or execute it.
6. Opportunity update commits.
7. Realtime invalidation arrives.
8. Counter refetches and changes.

## Task table

1. Sales registers `sales.tasks` with field metadata.
2. Builder adds `core.data-table`.
3. Editor chooses title, status, due date, and assignee columns.
4. Table requests paginated rows with allowlisted sort/filter.
5. Unauthorized revenue column is absent or rejected.
6. Task mutation emits `sales.tasks` invalidation.
7. Active table query refetches.
8. Reconnection still recovers current rows through the endpoint.

## Shared filters

1. Page has date-range UI state.
2. Counter and chart use it as source input.
3. State change invalidates only affected query keys.
4. Invalid input fails before handler execution.

## Security mutation

1. User manually changes layout/network request to another source/field.
2. Server denies execution.
3. User manually subscribes to a forbidden realtime scope.
4. Server denies subscription and sends no data-bearing message.

# POC acceptance criteria

1. A module registers at least one scalar and one paginated table source.
2. The builder discovers compatible sources without hard-coded Sales imports.
3. Source execution requires valid Payload authentication for workspace sources.
4. Permission and record-level access are enforced server-side.
5. DataTable columns come from declared metadata and selected columns persist in layout JSON.
6. Sorting/filtering/pagination use allowlisted source input.
7. Counter/chart/table bind through stable source IDs and versions.
8. Opportunity/task mutations produce authorized source invalidation.
9. Components refetch through the endpoint and recover after reconnect.
10. Unauthorized source/field/subscription manipulation fails.
11. A disabled source does not crash the page.
12. Public pages cannot bind internal Sales sources.
13. No arbitrary SQL, URL, JavaScript, Payload query, or secret is stored in the builder document.

# Open implementation questions

The architecture is accepted; these details require POC evidence:

- exact `defineDataSource` TypeScript API;
- one generic query route versus generated per-source routes;
- whether source descriptors are bundled, fetched, or both;
- output contract library and field-schema representation;
- actor-scoped cache implementation;
- source query-key normalization;
- fine-grained invalidation scope without metadata leakage;
- client cache/query library;
- subscription multiplexing protocol;
- table field formatting and custom cell-renderer registry;
- source preview with real, redacted, or fixture data;
- source/version migration tooling;
- SSR and hydration behavior for CMS/public sources.

## Current recommendations

```text
transport
  one standard authenticated K-Nex query gateway

ownership
  handler and descriptor remain plugin-owned

authorization
  Payload session + permission + record/field policy

ordinary realtime
  invalidation/refetch

high-frequency realtime
  explicit snapshot + typed stream contract

tables
  source-declared fields + allowlisted columns/sort/filter/pagination

builder storage
  source IDs, versions, parameters, selected fields, and bindings only
```

# Non-goals

V1 does not provide:

- automatic exposure of every Payload collection;
- arbitrary user-created backend queries;
- SQL/GraphQL/REST URL entry in the builder;
- unrestricted client-side joins/aggregation;
- unauthenticated access to admin data sources;
- WebSocket as the only authoritative data store;
- raw module state sharing;
- runtime installation of executable source packages.
