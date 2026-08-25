# Plugin Data Sources, UI Bindings, and Realtime Invalidation

## Purpose

K-Nex modules expose small, purpose-built, authenticated data sources that reusable UI components can consume through the visual builder.

The intended experience is:

```text
1. Enable the Sales module.
2. Sales registers sources such as:
     sales.total-potential-revenue
     sales.tasks
     sales.opportunities-by-stage
     sales.revenue-over-time
3. Add a Counter block and choose Sales → Total potential revenue.
4. Add a DataTable block and choose Sales → Tasks.
5. Select the visible task fields from the source descriptor.
6. Add a PieChart and choose Sales → Opportunities by stage.
7. Bind all three sources to shared page filters where allowed.
8. When Sales data changes, realtime invalidates affected queries.
9. Connected components refetch current authorized projections.
```

K-Nex does not expose Payload collections, raw database access, internal React stores, unrestricted URLs, arbitrary query builders, or live result snapshots to the editor.

A plugin deliberately defines every projection that can be discovered and executed.

## Accepted architecture

> A K-Nex module owns typed data-source descriptors and server handlers. K-Nex mounts them behind a standard authenticated gateway, validates inputs and outputs, enforces plugin permissions and record/field policy, exposes actor-filtered descriptors to the builder, and connects source invalidation to the realtime provider. Components bind to stable output contracts rather than module implementations.

Related decisions:

- [ADR-0010 — Typed data sources, UI state, and declarative bindings](./adr/0010-typed-data-source-state-binding-graph.md)
- [ADR-0012 — Hybrid output contracts](./adr/0012-hybrid-output-contracts.md)
- [Data-source output contracts](./25-output-contracts.md)

# Conceptual architecture

```text
Sales module
  ├── Payload collections and domain/query services
  ├── permissions and record policy
  ├── source descriptors
  ├── source handlers using req.payload
  ├── source/field migrations
  └── invalidation topics
          │
          ▼
K-Nex data-source registry/runtime
  ├── authenticated discovery
  ├── standard query gateway
  ├── source/input/output-contract validation
  ├── permission and record/field policy
  ├── bounded execution and observability
  ├── actor-scoped query identity/cache
  └── realtime invalidation bridge
          │
          ▼
Builder/runtime components
  ├── Counter / Metric
  ├── DataTable
  ├── PieChart / BarChart
  ├── LineChart / AreaChart
  ├── Select / Filter
  └── domain/customer-specific blocks
```

The module owns data meaning and query implementation. K-Nex owns consistent discovery, secure transport, contracts, bindings, and failure behavior.

# Core terminology

## Data source

A registered, versioned, server-executed query/projection owned by a plugin.

Examples:

```text
sales.total-potential-revenue
sales.tasks
sales.opportunities-by-stage
sales.revenue-over-time
crm.contacts
logistics.shipments-by-status
inventory.low-stock-items
restaurant.sales-by-category
```

A source is not:

- an automatically exposed Payload collection;
- a raw REST/GraphQL URL stored in a page;
- SQL or a Payload query written by an editor;
- browser-side aggregation over unrestricted records;
- a plugin's internal frontend state.

## Data-source descriptor

Browser-safe metadata used for discovery and builder configuration:

```text
stable source ID and major version
plugin ownership and display/category metadata
surface and audience
input fields and limits
one primary output contract
source-specific output schema identity/hash
available table fields or series capabilities
pagination/sort/filter policy
cache and realtime policy
```

Descriptors contain no handler implementation or secrets. Discovery is filtered by actor, plugin state, surface, audience, and field policy.

## Data-source handler

Server-only plugin code that receives validated input and authenticated Payload request context, then returns a purpose-built projection.

## Output contract

A versioned semantic result family understood by generic or domain-specific blocks.

Initial canonical catalog:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

Each source also has an exact source-specific output schema that must conform to the declared contract.

## UI state

Typed page/session/user coordination state used for filters and selections:

```text
page.filters.date-range
page.filters.selected-stage
workspace.selected-branch
```

Business data remains in authenticated sources. UI state does not become a mirror of module records.

## Runtime context

Read-only values supplied by the application/runtime:

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

## Binding

A serializable connection among registered static values, context, UI state, sources, component input/output ports, and actions.

```text
page date-range state
  → sales.total-potential-revenue.dateRange

sales.opportunities-by-stage
  → PieChart.data

PieChart.sliceSelected
  → page.filters.selected-stage
```

Bindings contain stable IDs, versions, validated parameters, and safe mappings—not executable expressions.

# Source definition

## Scalar source

Conceptual authoring API:

```ts
export const totalPotentialRevenueSource = defineMetricSource({
  id: 'sales.total-potential-revenue',
  version: 1,
  pluginId: 'module.sales',

  title: 'Total potential revenue',
  description: 'Sum of potential revenue visible to the current actor.',
  category: 'Sales',

  surfaces: ['workspace'],
  audience: ['authenticated'],
  permission: 'sales.opportunities.revenue.read',

  input: totalPotentialRevenueInputSchema,
  outputSchema: totalPotentialRevenueOutputSchema,
  contract: contractRef('metric.scalar', 1),

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

Output:

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

The source returns semantic raw values. The component/theme formats currency and locale.

## Table source

```ts
export const tasksSource = defineTableSource({
  id: 'sales.tasks',
  version: 1,
  pluginId: 'module.sales',

  title: 'Sales tasks',
  category: 'Sales',

  surfaces: ['workspace'],
  audience: ['authenticated'],
  permission: 'sales.tasks.read',

  input: paginatedTasksInputSchema,
  outputSchema: salesTaskTableOutputSchema,
  contract: contractRef('table.records', 1),

  fields: [
    tableField('title', {
      label: 'Task',
      valueType: 'text',
      nullable: false,
      defaultVisible: true,
      sortable: true,
      filterable: true,
    }),
    tableField('status', {
      label: 'Status',
      valueType: 'text',
      nullable: false,
      defaultVisible: true,
      sortable: true,
      filterable: true,
      enumOptions: taskStatusOptions,
    }),
    tableField('dueAt', {
      label: 'Due date',
      valueType: 'datetime',
      nullable: true,
      defaultVisible: true,
      sortable: true,
      filterable: true,
    }),
    tableField('assignee', {
      label: 'Assignee',
      valueType: 'resource',
      nullable: true,
      defaultVisible: true,
      sortable: false,
      filterable: false,
    }),
    tableField('potentialRevenue', {
      label: 'Potential revenue',
      valueType: 'money',
      nullable: true,
      defaultVisible: false,
      sortable: true,
      filterable: false,
      permission: 'sales.opportunities.revenue.read',
    }),
  ],

  pagination: {
    mode: 'cursor',
    defaultPageSize: 20,
    maximumPageSize: 100,
  },

  realtime: {
    mode: 'invalidate',
    topics: ['sales.tasks'],
  },

  execute: async ({ input, req, actor, services }) => {
    return services.salesQueries.listTasks({ input, req, actor })
  },
})
```

Field IDs are stable opaque identifiers. They are not object paths.

Prefer:

```text
assignee
potentialRevenue
```

Avoid:

```text
assignee.name
opportunity.financials.potentialRevenue
```

The internal Payload structure can change without changing builder field IDs.

## Category-series source

```ts
export const opportunitiesByStageSource = defineCategorySeriesSource({
  id: 'sales.opportunities-by-stage',
  version: 1,
  pluginId: 'module.sales',
  contract: contractRef('series.category', 1),
  permission: 'sales.opportunities.read',
  input: opportunitiesByStageInputSchema,
  outputSchema: opportunitiesByStageOutputSchema,
  realtime: {
    mode: 'invalidate',
    topics: ['sales.opportunities'],
  },
  execute: ({ input, req, actor, services }) =>
    services.salesQueries.opportunitiesByStage({ input, req, actor }),
})
```

The plugin aggregates on the server. It does not send all opportunities to the browser and ask the PieChart to group/sum them.

## Domain-specific source

A complex domain block can use a plugin-owned contract:

```ts
export const pipelineBoardSource = defineDataSource({
  id: 'sales.pipeline-board',
  version: 1,
  pluginId: 'module.sales',
  contract: contractRef('sales.pipeline-board', 1),
  outputSchema: pipelineBoardOutputSchema,
  // ...
})
```

This is the supported escape path when canonical contracts are insufficient. Canonical payloads do not receive an unrestricted extension bag.

# Payload access and authorization

Handlers use the authenticated request-scoped Payload instance or services that receive it.

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
    limit: input.limit,
    sort: input.sort,
    depth: 1,
    req,
    overrideAccess: false,
  })

  return projectTaskTable(result, input.select)
}
```

Required rules:

- pass request/transaction context where Payload access behavior depends on it;
- ordinary workspace sources use `overrideAccess: false`;
- source permission is checked separately from collection access where necessary;
- record-level policy is applied server-side;
- table field policy is applied server-side;
- handlers return purpose-built DTOs, not unrestricted Payload documents;
- input/result sizes are bounded;
- browser code never receives a Payload instance or direct database access;
- authoritative business rules remain in domain/application services.

## Authorization chain

For a workspace/admin source:

```text
valid Payload actor/session
+ source discovery/execution permission
+ record-level policy
+ selected field policy
+ surface/audience policy
```

The builder hiding a source or column is only UX. Manual requests are checked again at the gateway and handler boundary.

# Endpoint model

## Logical ownership

Every source belongs to and is implemented by a plugin. It is reasonable to call it a plugin-specific endpoint semantically.

## Standard gateway

Recommended V1 transport:

```text
GET  /api/k-nex/data-sources
GET  /api/k-nex/data-sources/:sourceId/descriptor
POST /api/k-nex/data-sources/:sourceId/query
```

The registry dispatches the request to the owning plugin handler.

The standard gateway centralizes:

- Payload session/token authentication;
- actor construction;
- plugin/source/version lookup;
- surface/audience and permission checks;
- input validation;
- source-specific and output-contract validation;
- rate/cost/result-size limits;
- query-key normalization;
- safe errors and correlation;
- metrics/logging/audit policy;
- cache and realtime registration;
- ownership diagnostics.

A plugin can additionally expose dedicated domain endpoints for external/mobile clients. Builder documents bind only to registered source IDs, not arbitrary URLs.

## POST for read execution

V1 consistently uses POST for source execution because filters, selected fields, pagination, sorting, and nested parameters are structured and schema-validated.

The operation remains read-only even though its transport method is POST.

# Discovery and descriptors

`GET /api/k-nex/data-sources` returns only descriptors discoverable for the current actor and editing surface.

A descriptor includes its primary contract and a deterministic actor-filtered descriptor hash.

```json
{
  "id": "sales.tasks",
  "version": 1,
  "pluginId": "module.sales",
  "title": "Sales tasks",
  "category": "Sales",
  "surfaces": ["workspace"],
  "audience": ["authenticated"],
  "contract": {
    "id": "table.records",
    "version": 1
  },
  "descriptorHash": "sha256:...",
  "fields": [
    {
      "id": "title",
      "label": "Task",
      "valueType": "text",
      "nullable": false,
      "defaultVisible": true,
      "sortable": true,
      "filterable": true
    }
  ],
  "pagination": {
    "mode": "cursor",
    "defaultPageSize": 20,
    "maximumPageSize": 100
  }
}
```

Descriptor and query data are separate:

- builder metadata can be cached independently;
- each pagination/refetch response does not repeat fields/options;
- field discovery can differ by actor;
- an additive descriptor change updates its hash without forcing a source-major migration.

# Standard success envelope

```json
{
  "schemaVersion": 1,
  "source": {
    "id": "sales.tasks",
    "version": 1
  },
  "contract": {
    "id": "table.records",
    "version": 1
  },
  "descriptorHash": "sha256:...",
  "data": {
    "rows": [],
    "pageInfo": {
      "mode": "cursor",
      "hasNextPage": false
    }
  }
}
```

The gateway validates:

```text
handler result
  → exact source output schema
  → declared output contract
  → selected/authorized field projection
  → response envelope
```

Invalid or undeclared output fails closed with `SOURCE_OUTPUT_INVALID`.

Detailed canonical shapes and versioning rules live in [Data-source output contracts](./25-output-contracts.md).

# Output-contract compatibility

Generic components declare accepted contract ranges.

```text
Counter
  accepts metric.scalar@^1

DataTable
  accepts table.records@^1

PieChart
  accepts series.category@^1
  requires exactly one series

BarChart
  accepts series.category@^1

LineChart
  accepts series.time@^1
```

The builder source picker filters candidates by:

- plugin installed/enabled state;
- actor discovery permission;
- current/target surface and audience;
- contract ID/version compatibility;
- descriptor/component constraints;
- selected field availability;
- source-version compatibility.

Domain-specific blocks can accept namespaced plugin contracts or exact source families.

# Builder bindings

## Counter

```json
{
  "id": "potential-revenue-counter",
  "type": "core.metric",
  "version": 1,
  "props": {
    "label": "Potential revenue",
    "showComparison": true
  },
  "bindings": {
    "data": {
      "kind": "data-source",
      "source": {
        "id": "sales.total-potential-revenue",
        "version": 1
      },
      "expects": {
        "contract": "metric.scalar",
        "version": 1
      },
      "params": {
        "dateRange": {
          "kind": "state",
          "state": "page.filters.date-range"
        }
      }
    }
  }
}
```

The whole metric payload binds to one component input. The layout does not separately select `value` and `currency`; their semantic relationship remains intact.

## DataTable

```json
{
  "id": "open-sales-tasks",
  "type": "core.data-table",
  "version": 1,
  "props": {
    "title": "Open sales tasks",
    "columns": ["title", "status", "dueAt", "assignee"],
    "pageSize": 20,
    "defaultSort": [
      { "field": "dueAt", "direction": "asc" }
    ]
  },
  "bindings": {
    "data": {
      "kind": "data-source",
      "source": {
        "id": "sales.tasks",
        "version": 1
      },
      "expects": {
        "contract": "table.records",
        "version": 1
      },
      "select": ["title", "status", "dueAt", "assignee"],
      "params": {
        "status": ["open", "in-progress"]
      }
    }
  }
}
```

Rules:

- selected columns are stable source field IDs;
- source rejects unknown/forbidden fields;
- runtime intersects optional selected columns with viewer permissions;
- null means an authorized selected field has no value;
- omitted means unselected or unauthorized;
- sort/filter operators remain source-declared and server-validated.

## Chart

```json
{
  "id": "opportunities-by-stage",
  "type": "visualization.pie-chart",
  "version": 1,
  "props": {
    "title": "Opportunities by stage"
  },
  "bindings": {
    "data": {
      "kind": "data-source",
      "source": {
        "id": "sales.opportunities-by-stage",
        "version": 1
      },
      "expects": {
        "contract": "series.category",
        "version": 1
      },
      "params": {
        "dateRange": {
          "kind": "state",
          "state": "page.filters.date-range"
        }
      }
    }
  }
}
```

V1 charts use server-projected canonical series. They do not group/sum arbitrary table records inside the browser.

# UI state and source parameters

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
    },
    "page.filters.selected-stage": {
      "schema": "value.string@1",
      "default": null,
      "scope": "page",
      "persistence": "none"
    }
  }
}
```

A filter changes state; sources consume validated state as input; charts/tables render source results.

```text
DateRangeFilter
  → page.filters.date-range

Counter
  → sales.total-potential-revenue(dateRange)

PieChart
  → sales.opportunities-by-stage(dateRange)
  → sliceSelected writes page.filters.selected-stage

DataTable
  → sales.tasks(dateRange, selectedStage)
```

UI state coordinates interaction. It does not bypass source authorization or become the authoritative business state.

# Public sources

Public CMS pages cannot reuse internal workspace sources merely because a component supports the same output contract.

Explicit public-safe sources use separate IDs and policies:

```text
restaurant.public-menu
logistics.public-tracking-status
sales.public-featured-services
crm.public-lead-form-options
```

They require their own:

- audience/surface declaration;
- narrow output projection;
- rate limits and abuse controls;
- public cache policy;
- privacy/consent review;
- signed-session policy where relevant.

An authenticated editor preview does not make an internal source safe to publish publicly.

# Query identity and caching

A validated source execution is identified by at least:

```text
source ID
source major version
canonical validated input
selected field IDs
surface
actor/access scope
```

Conceptual key:

```text
sales.tasks@1
+ hash(canonicalInput)
+ hash(selectedFields)
+ actorAccessScope
```

Two blocks with equivalent source/input/selection should share one active query result. Cache entries never cross authorization boundaries.

Safe V1 classifications:

```text
no-store
actor-scoped
role-scoped where record/field policy permits
public explicit opt-in
```

Internal authenticated sources default to actor-scoped or no-store.

# Realtime invalidation

## Principle

The authenticated source endpoint remains authoritative. WebSocket normally says that a query may be stale.

```text
module mutation commits
  → module event/invalidation topic
  → provider authorizes notification
  → matching query becomes stale
  → client refetches authenticated source
  → new response passes contract validation
  → component rerenders
```

This supports missed-message recovery and permission changes: reconnect/refetch current authorized state.

## Source invalidation metadata

```ts
realtime: {
  mode: 'invalidate',
  topics: [
    'sales.tasks',
    'sales.opportunities',
  ],
}
```

After a task mutation commits:

```ts
await realtime.invalidate({
  topic: 'sales.tasks',
  scope: {
    branchId: task.branchId,
    assigneeId: task.assigneeId,
  },
})
```

Conceptual client message:

```json
{
  "type": "data-source.invalidated",
  "source": "sales.tasks",
  "sourceVersion": 1,
  "topic": "sales.tasks",
  "scope": {
    "branchId": "branch-1"
  },
  "occurredAt": "2026-08-25T12:00:00Z"
}
```

The message normally carries no task rows.

## Coarse before fine

V1 can start with coarse source/topic invalidation:

```text
sales.tasks changed
```

Add branch/team/assignee/record scopes only when authorization-safe and operationally useful. Fine metadata must not reveal unauthorized record existence.

## Stream mode

Typed streams are reserved for genuine high-frequency/live projections:

```text
vehicle positions
live dispatch telemetry
import progress
active device state
```

A stream source defines:

- authenticated initial snapshot source;
- typed message schema/version;
- subscription policy;
- reducer semantics;
- reconnect/resync;
- rate/backpressure limits.

It does not silently patch `table.records@1` or chart contracts with unversioned messages.

# WebSocket security

Opening a socket does not grant topic access.

Every subscription checks:

```text
actor/session validity
source/plugin enabled state
surface/audience
required permission
record/scope policy
current customer application
```

The provider must support session expiry, permission/role changes, plugin disablement, disconnect, and subscription reauthorization.

# Registered transformations

V1 uses purpose-built sources:

```text
sales.opportunities-by-stage
  → series.category@1
```

It does not let an editor bind raw opportunities to a chart and author `group by`, `sum`, JavaScript, or SQL.

The architecture reserves future registered/versioned adapters for repeated safe needs:

```text
adapter.table-fields-to-category-series@1
```

A transformation adapter must be trusted code with:

- declared input/output contract ranges;
- schema-validated configuration;
- cost/result limits;
- deterministic behavior;
- migration/versioning;
- no arbitrary expressions, URLs, imports, joins, or browser aggregation.

Adapters become explicit binding-graph nodes, not hidden object-path strings.

# Error and component states

Stable source error codes include:

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
CONTRACT_UNSUPPORTED
DESCRIPTOR_STALE
```

Components map these to safe runtime states:

```text
loading
empty
forbidden
unavailable
error with retry
stale/reconnecting
```

Admin diagnostics can show source/plugin ownership, expected/current versions, and correlation ID without stack traces or secrets.

# Lifecycle and versioning

Source, output contract, descriptor, and package versions are independent:

```text
@k-nex/module-sales@2.7.4
sales.tasks@3
table.records@1
descriptor hash sha256:...
```

Stored layouts persist source and contract major versions plus selected field IDs.

A source migration can:

- rename/remap parameters;
- rename stable field IDs;
- update source version;
- split one projection into multiple sources;
- change declared contract;
- mark bindings for administrator review.

Additive optional fields can update descriptor hash without forcing source-major migration.

When a plugin/source is disabled or removed:

- it disappears from new discovery;
- existing bindings remain stored and are reported;
- execution returns a safe disabled/not-found error;
- subscriptions are removed;
- the page does not crash;
- no layout is silently rewritten/deleted.

# Source authoring rules

Create a source when:

- a projection is reusable across blocks/screens;
- an aggregate has stable domain meaning;
- a list needs bounded authorization-aware pagination;
- the builder needs safe configurable fields;
- invalidation can be defined;
- the projection can evolve independently of raw storage.

Avoid sources that:

- return unrestricted Payload documents;
- expose secret/internal fields;
- have unbounded result size;
- accept arbitrary selection/query expressions;
- duplicate another source without meaningful semantic/policy difference;
- bypass module services/access policy;
- encode one customer's visual design;
- combine unrelated metric/table/chart outputs into one endpoint.

# POC requirements

## Sources and blocks

```text
sales.total-potential-revenue
  → metric.scalar@1
  → Counter/Metric

sales.tasks
  → table.records@1
  → DataTable

sales.opportunities-by-stage
  → series.category@1
  → PieChart/BarChart

sales.revenue-over-time
  → series.time@1
  → LineChart
```

## Required proof

1. Builder discovery has no hard-coded Sales imports.
2. Workspace execution requires a valid Payload actor.
3. Permission, record policy, and field policy are server-enforced.
4. Source input and output are schema-validated.
5. Exact source output schema conforms to declared output contract.
6. DataTable columns come from stable field descriptors, not nested Payload paths.
7. Unauthorized fields are absent/rejected even after manual request mutation.
8. Source and contract versions are persisted independently.
9. Two equivalent block bindings reuse one active query.
10. Opportunity/task mutation invalidates and refetches authorized queries.
11. Reconnect recovers through endpoint refetch.
12. Disabled/missing source does not crash the page.
13. Public pages cannot bind internal Sales sources.
14. Invalid/undeclared source output fails closed.
15. At least one plugin-owned domain contract proves the hybrid model.
16. No arbitrary SQL, URL, JavaScript, Payload query, secret, or live record snapshot is stored in the builder document.

# Open implementation questions

The architecture and output-contract package are accepted. POC still selects:

- exact source-authoring TypeScript API;
- schema library and JSON-schema strategy;
- descriptor bundled/fetched balance;
- client query/cache implementation;
- cursor/pagination helpers;
- actor-scope key derivation;
- fine invalidation scope;
- source preview using real/redacted/fixture data;
- cell renderer registry;
- SSR/hydration policy;
- production output-validation performance;
- first registered transformation adapter, if real repeated need exists.

# Non-goals

V1 does not provide:

- automatic Payload collection exposure;
- arbitrary backend query creation;
- visual SQL or unrestricted GraphQL/REST entry;
- raw nested object-path selection;
- unrestricted client joins/aggregation;
- unauthenticated access to workspace/admin data;
- WebSocket as the only source of truth;
- opaque canonical extension payloads;
- runtime installation of executable source packages.
