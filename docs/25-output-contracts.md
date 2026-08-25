# Data-Source Output Contracts

## Purpose

K-Nex data sources are owned by plugins, but reusable builder components must be able to consume their results without importing those plugins or understanding their internal Payload collections.

An output contract is the stable semantic boundary between:

```text
plugin-owned query/projection
        ↓
K-Nex source gateway and runtime
        ↓
generic or domain-specific UI component
```

Examples:

```text
sales.total-potential-revenue
  → metric.scalar@1
  → Counter / Metric block

sales.tasks
  → table.records@1
  → DataTable block

sales.opportunities-by-stage
  → series.category@1
  → PieChart / BarChart block

sales.revenue-over-time
  → series.time@1
  → LineChart / AreaChart block
```

The contract system must provide enough structure for automatic source discovery, builder compatibility checks, runtime validation, formatting, migration, caching, and safe failure behavior without becoming a visual SQL language or a universal domain model.

## Accepted decision package

The reviewed V1 direction is:

```text
1. Hybrid canonical/plugin-owned contract model.
2. One data source has one primary projection contract.
3. Table rows use stable declared field IDs, not raw nested object paths.
4. Metrics use one discriminated metric.scalar contract.
5. Charts consume canonical series contracts first; future transforms are registered/versioned adapters.
6. Source descriptors are separate from query responses.
7. Successful source executions use one standard response envelope.
8. Source versions and output-contract versions evolve independently.
9. Initial catalog: metric.scalar, table.records, series.category,
   series.time, options.list, and record.summary.
```

The first POC must implement the first four contracts. `options.list@1` and `record.summary@1` are accepted members of the initial catalog but can follow after the core counter/table/chart slice is proven.

# Four distinct schemas

Do not collapse the following concepts into one schema.

## Data-source descriptor

Browser-safe metadata used for discovery and builder configuration:

```text
source identity and owner
source major version
display/category metadata
surface and audience
input fields and limits
primary output contract
source-specific output schema identity/hash
available table fields or series capabilities
pagination/sort/filter behavior
cache and realtime policy
```

Descriptors are returned only after authentication/surface/discovery policy has been applied. A descriptor can be actor-specific when field visibility differs by permission.

## Canonical output contract

A K-Nex-owned semantic family understood by reusable components:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

A contract defines the common shape and semantics, not one plugin's exact field list.

## Source-specific output schema

The exact result schema for one source. It narrows and specializes its declared contract.

For example, `sales.tasks@1` implements `table.records@1`, but its source-specific schema defines the allowed field IDs, enum values, nullability, and row projection.

The source-specific schema must pass the canonical contract validator. Merely declaring a contract ID is insufficient.

## Transport envelope

The uniform success wrapper returned by the K-Nex query gateway. It carries source and contract identity around the contract payload.

These four layers evolve for different reasons and are versioned or hashed independently.

# Hybrid contract model

## Canonical K-Nex contracts

Canonical contracts are used when multiple unrelated plugins should feed the same generic component.

Examples:

```text
sales.tasks                    → table.records@1
crm.contacts                   → table.records@1
logistics.shipments            → table.records@1
inventory.low-stock-items      → table.records@1

sales.opportunities-by-stage   → series.category@1
logistics.shipments-by-status  → series.category@1
restaurant.sales-by-category   → series.category@1
```

The generic table/chart imports only K-Nex UI contracts.

## Plugin-owned contracts

A plugin can define a namespaced contract when the data shape and interaction are intentionally domain-specific.

Examples:

```text
sales.pipeline-board@1
logistics.dispatch-board@1
inventory.stock-ledger@1
```

A domain-specific block can accept that contract or an exact source ID. Generic components do not automatically consume it.

## No opaque extension bag

Canonical payloads must not contain an unrestricted `extensions: Record<string, unknown>` escape hatch.

An opaque extension bag would:

- bypass contract compatibility;
- make security review and output validation incomplete;
- cause generic components to depend on undocumented plugin data;
- create hidden migration coupling;
- eventually become arbitrary JSON transport.

When canonical data is insufficient, define a plugin-owned contract or a second purpose-built source.

## Reserved namespaces

K-Nex reserves the canonical top-level contract namespaces:

```text
metric.*
table.*
series.*
options.*
record.*
```

Plugin-owned contracts use a plugin/domain namespace:

```text
sales.*
logistics.*
restaurant.*
inventory.*
customer-acme.*
```

# One source, one primary projection

Each data source exposes exactly one primary output contract.

Preferred:

```text
sales.tasks
  → table.records@1

sales.tasks-open-count
  → metric.scalar@1

sales.tasks-by-status
  → series.category@1
```

Avoid:

```text
sales.tasks
  → rows + count + byStatus + overdueCount + arbitrary named outputs
```

A multi-output source tends to become an implicit query language and creates unclear permissions, cache keys, invalidation, payload size, and component coupling.

Plugins can share the underlying query/domain service:

```ts
salesQueries.listTasks(...)
salesQueries.countTasks(...)
salesQueries.groupTasksByStatus(...)
```

The builder-facing projections remain separate and purpose-specific.

Standard pagination metadata, descriptor identity, and transport metadata are not considered additional business projections.

# Contract identity and versioning

A contract reference is stored as an ID plus a major version:

```json
{
  "id": "table.records",
  "version": 1
}
```

Shorthand documentation form:

```text
table.records@1
```

A source also has a separate major version:

```json
{
  "id": "sales.tasks",
  "version": 3,
  "contract": {
    "id": "table.records",
    "version": 1
  }
}
```

A source can evolve from `sales.tasks@1` to `sales.tasks@3` while continuing to implement `table.records@1`.

## Contract major version changes

Increment the output-contract major version when the shared semantic shape changes incompatibly, including:

- removing or renaming a required contract member;
- changing a member's semantic meaning;
- changing required null/missing behavior;
- changing numeric/date serialization;
- changing pagination or series semantics incompatibly.

Additive optional members can remain within the same major when all consumers must ignore unknown optional members.

## Source major version changes

Increment the source major version when persisted builder bindings can break, including:

- removing or renaming an input parameter;
- removing or renaming a stable field ID;
- changing a field's semantic type;
- changing pagination/filter behavior incompatibly;
- changing the source's meaning or authorization expectation;
- changing to an incompatible output contract.

Adding a new optional field, filter, or sort option does not necessarily require a source-major bump. It changes the descriptor hash.

## Descriptor hash

Every actor-filtered descriptor receives a deterministic hash:

```text
sha256:<digest>
```

The hash changes when nonbreaking discovery metadata changes, such as a newly available field or filter.

Stored layouts persist source/contract major versions and selected stable IDs, not the descriptor hash. Query responses return the current descriptor hash so the runtime can detect a stale editor/runtime view and refresh metadata.

## Package version is separate

The npm package version, source version, and contract version are different concepts:

```text
@k-nex/module-sales@2.7.4
sales.tasks@3
table.records@1
```

Do not use the package version as a persisted binding version.

# Contract conformance

A source must not gain compatibility by metadata assertion alone.

Preferred authoring APIs:

```ts
defineMetricSource(...)
defineTableSource(...)
defineCategorySeriesSource(...)
defineTimeSeriesSource(...)
defineOptionsSource(...)
defineRecordSummarySource(...)
```

These helpers should infer TypeScript types and compose the canonical runtime validator.

Conceptual generic form:

```ts
defineDataSource({
  id: 'sales.tasks',
  version: 1,
  contract: contractRef('table.records', 1),
  outputSchema: salesTaskTableSchema,
  execute: async context => { /* ... */ },
})
```

Validation sequence:

```text
handler result
  → source-specific output-schema validation
  → canonical contract validation
  → authorization/selected-field projection validation
  → response envelope serialization
```

A mismatch fails closed with `SOURCE_OUTPUT_INVALID`. Undeclared data must not be silently forwarded.

Contract tests should run in plugin CI and application integration tests. Runtime validation remains enabled for bounded V1 sources; result-size limits keep the cost controlled.

# Shared semantic value types

Canonical contracts exchange semantic raw values rather than already formatted customer strings.

Do:

```json
{
  "kind": "money",
  "amount": "325000.00",
  "currency": "TRY"
}
```

Avoid:

```json
{
  "value": "₺325.000,00"
}
```

Formatting belongs to the viewer locale, semantic primitive, and selected theme.

Conceptual V1 value family:

```ts
type ScalarValueV1 =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number; unit?: string }
  | { kind: 'integer'; value: number; unit?: string }
  | { kind: 'decimal'; value: string; unit?: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'datetime'; value: string }
  | { kind: 'money'; amount: string; currency: string }
  | { kind: 'percentage'; value: number; scale: 'fraction' | 'percent' }
  | {
      kind: 'duration'
      value: number
      unit: 'millisecond' | 'second' | 'minute' | 'hour' | 'day'
    }
  | {
      kind: 'resource'
      id: string
      label: string
      resourceType?: string
      href?: string
    }
```

Rules:

- numeric JSON values must be finite;
- decimal and money amounts use canonical decimal strings when exact decimal meaning matters;
- dates use `YYYY-MM-DD`;
- datetimes use RFC-3339 strings with an offset or `Z`;
- currency uses an uppercase ISO-style code supported by the application;
- `resource.href` is generated/validated by trusted code, never an unrestricted user URL;
- nullability is declared by the field/source schema rather than represented as another scalar kind.

# `metric.scalar@1`

## Purpose

A single semantic metric contract powers counters, KPI cards, progress summaries, and compact dashboard values without creating one contract per unit.

Conceptual shape:

```ts
interface MetricScalarV1 {
  value:
    | Extract<ScalarValueV1, { kind: 'text' }>
    | Extract<ScalarValueV1, { kind: 'number' }>
    | Extract<ScalarValueV1, { kind: 'integer' }>
    | Extract<ScalarValueV1, { kind: 'decimal' }>
    | Extract<ScalarValueV1, { kind: 'money' }>
    | Extract<ScalarValueV1, { kind: 'percentage' }>
    | Extract<ScalarValueV1, { kind: 'duration' }>

  comparison?: {
    mode: 'absolute' | 'percentage'
    delta: number
    sentiment: 'positive' | 'negative' | 'neutral' | 'warning'
    baselineLabel?: string
  }

  asOf?: string
}
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
  },
  "asOf": "2026-08-25T12:00:00Z"
}
```

The source supplies sentiment because an upward movement is not always good. The component must not infer that `delta > 0` means positive.

The block owns presentation properties such as title, label placement, icon, compact/large variant, and whether comparison is displayed.

# `table.records@1`

## Purpose

A permission-aware, paginated, generic tabular projection with stable declared field IDs.

## Descriptor fields

Table field metadata lives in the descriptor, not in every query response.

Conceptual definition:

```ts
interface TableFieldDescriptorV1 {
  id: string
  label: string
  valueType: ScalarValueV1['kind']
  nullable: boolean
  defaultVisible: boolean
  sortable: boolean
  filterable: boolean
  enumOptions?: readonly {
    key: string
    label: string
  }[]
}
```

The server-side source definition can additionally contain permissions, sensitivity, filter schema, sort implementation, and renderer hints. Actor-facing discovery returns only fields the actor is allowed to use.

Field IDs are opaque stable identifiers. They are not object paths.

Prefer:

```text
assignee
potentialRevenue
dueAt
```

Avoid:

```text
assignee.name
opportunity.financials.potentialRevenue
```

The projection can internally read any Payload structure, but the public source field ID remains stable across storage refactors.

## Result shape

```ts
interface TableRecordsV1 {
  rows: readonly {
    key: string
    resource?: {
      id: string
      resourceType: string
      label?: string
    }
    values: Readonly<Record<string, ScalarValueV1 | null>>
  }[]

  pageInfo:
    | { mode: 'none' }
    | {
        mode: 'cursor'
        endCursor?: string
        hasNextPage: boolean
        totalCount?: number
      }
    | {
        mode: 'offset'
        page: number
        pageSize: number
        totalCount?: number
      }
}
```

Example:

```json
{
  "rows": [
    {
      "key": "task-1",
      "resource": {
        "id": "task-1",
        "resourceType": "sales.task",
        "label": "Call customer"
      },
      "values": {
        "title": {
          "kind": "text",
          "value": "Call customer"
        },
        "status": {
          "kind": "text",
          "value": "open"
        },
        "dueAt": {
          "kind": "datetime",
          "value": "2026-08-30T09:00:00Z"
        },
        "assignee": {
          "kind": "resource",
          "id": "user-1",
          "resourceType": "user",
          "label": "Ali"
        },
        "potentialRevenue": {
          "kind": "money",
          "amount": "125000.00",
          "currency": "TRY"
        }
      }
    }
  ],
  "pageInfo": {
    "mode": "cursor",
    "endCursor": "opaque-cursor",
    "hasNextPage": true,
    "totalCount": 154
  }
}
```

## Selection and authorization

The layout stores selected field IDs. The query requests only allowed selected fields where supported.

```json
{
  "source": {
    "id": "sales.tasks",
    "version": 1
  },
  "select": ["title", "status", "dueAt", "assignee"]
}
```

Rules:

- the runtime intersects requested fields with the actor-filtered descriptor;
- the source rejects unknown or forbidden fields;
- the response rejects undeclared fields;
- a selected nullable field appears with `null` when its value is known to be absent;
- an unauthorized/unselected field is omitted entirely;
- field omission is never treated as `null`;
- sort and filter fields are separately allowlisted and validated;
- a customer layout can include an optional field unavailable to a lower-permission viewer; the viewer receives the remaining authorized columns;
- a block whose required field/source permission is missing renders a forbidden/unavailable state rather than inventing data.

## Table metadata is not a metric source

`pageInfo.totalCount` exists to support pagination UX. A standalone KPI counter should use a dedicated `metric.scalar@1` source instead of binding to incidental table metadata.

# `series.category@1`

## Purpose

Category-based numeric series for pie, bar, stacked bar, and similar charts.

Conceptual shape:

```ts
interface MeasureDescriptorV1 {
  kind: 'number' | 'money' | 'percentage' | 'duration'
  unit?: string
  currency?: string
  percentageScale?: 'fraction' | 'percent'
  durationUnit?: 'millisecond' | 'second' | 'minute' | 'hour' | 'day'
}

interface CategorySeriesV1 {
  categories: readonly {
    key: string
    label: string
  }[]

  series: readonly {
    key: string
    label: string
    measure: MeasureDescriptorV1
    points: readonly {
      categoryKey: string
      value: number | null
    }[]
  }[]
}
```

Example:

```json
{
  "categories": [
    { "key": "new", "label": "New" },
    { "key": "qualified", "label": "Qualified" },
    { "key": "won", "label": "Won" }
  ],
  "series": [
    {
      "key": "potentialRevenue",
      "label": "Potential revenue",
      "measure": {
        "kind": "money",
        "currency": "TRY"
      },
      "points": [
        { "categoryKey": "new", "value": 80000 },
        { "categoryKey": "qualified", "value": 125000 },
        { "categoryKey": "won", "value": 240000 }
      ]
    }
  ]
}
```

Chart-series values are finite visualization numbers. Sources perform aggregation and appropriate rounding server-side. Exact accounting/export data should use a table or domain-specific contract.

Component constraints are stricter than the shared contract where needed:

```text
PieChart
  accepts series.category@1
  requires exactly one numeric series
  rejects negative values unless explicitly supported

BarChart
  accepts series.category@1
  can accept one or more series
```

The builder filters by contract first and validates component-specific constraints during preview/publication.

# `series.time@1`

## Purpose

Time-indexed numeric series for line, area, trend, and telemetry charts.

Conceptual shape:

```ts
interface TimeSeriesV1 {
  timezone: string
  interval:
    | 'irregular'
    | 'minute'
    | 'hour'
    | 'day'
    | 'week'
    | 'month'
    | 'quarter'
    | 'year'

  series: readonly {
    key: string
    label: string
    measure: MeasureDescriptorV1
    points: readonly {
      at: string
      value: number | null
    }[]
  }[]
}
```

Rules:

- timestamps are RFC-3339;
- timezone is an IANA name or `UTC` according to the contract validator;
- points are ordered ascending by time;
- duplicate timestamps for one series are rejected unless a future contract explicitly supports them;
- downsampling/bucketing occurs in the source, not the generic chart;
- result size is bounded by source policy.

# `options.list@1`

## Purpose

Typed choices for selects, filters, relation pickers, and builder resource fields.

Conceptual shape:

```ts
interface OptionsListV1 {
  items: readonly {
    key: string
    label: string
    description?: string
    disabled?: boolean
    groupKey?: string
    resource?: {
      id: string
      resourceType: string
    }
  }[]

  pageInfo?:
    | { mode: 'none' }
    | {
        mode: 'cursor'
        endCursor?: string
        hasNextPage: boolean
      }
}
```

Option keys are stable values, not localized labels. Public and internal option sources remain separate when their projections or permissions differ.

# `record.summary@1`

## Purpose

A compact semantic record projection for cards, headers, related-record panels, and selection previews.

Conceptual shape:

```ts
interface RecordSummaryV1 {
  key: string
  resource?: {
    id: string
    resourceType: string
  }
  title: string
  subtitle?: string
  fields: readonly {
    fieldId: string
    value: ScalarValueV1 | null
  }[]
}
```

Field descriptors remain in the source descriptor. Actions are not embedded executable callbacks; a block can separately bind registered action IDs.

# Descriptor and response separation

## Discovery

Recommended authenticated discovery:

```text
GET /api/k-nex/data-sources
GET /api/k-nex/data-sources/:sourceId/descriptor
```

Descriptor example:

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

The descriptor endpoint is not a public schema dump. It is filtered by plugin state, surface, audience, discovery permission, and field policy.

## Query response

Recommended success envelope:

```ts
interface DataSourceSuccessV1<TData> {
  schemaVersion: 1
  source: {
    id: string
    version: number
  }
  contract: {
    id: string
    version: number
  }
  descriptorHash: string
  data: TData
  meta?: {
    asOf?: string
  }
}
```

Example:

```json
{
  "schemaVersion": 1,
  "source": {
    "id": "sales.total-potential-revenue",
    "version": 1
  },
  "contract": {
    "id": "metric.scalar",
    "version": 1
  },
  "descriptorHash": "sha256:...",
  "data": {
    "value": {
      "kind": "money",
      "amount": "325000.00",
      "currency": "TRY"
    }
  }
}
```

The response does not repeat field descriptors on every page/refetch.

Cache validators, request IDs, correlation IDs, rate-limit status, and HTTP caching policy should normally use headers and server logs rather than expanding every payload.

## Errors

Errors use a standard non-success problem shape and stable codes such as:

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

A safe correlation ID can be returned. Internal stack traces, query details, and secrets are never returned.

# Component compatibility

A component input port declares contract ranges and optional structural constraints.

Conceptual example:

```ts
defineBlock({
  id: 'visualization.pie-chart',
  inputs: {
    data: {
      contracts: [contractRange('series.category', '^1')],
      constraints: {
        minimumSeries: 1,
        maximumSeries: 1,
      },
    },
  },
})
```

Compatibility resolution:

```text
1. Source plugin is installed/enabled.
2. Source is discoverable for editor and target surface/audience.
3. Source contract ID/version satisfies the input-port range.
4. Source descriptor satisfies static component constraints.
5. Stored parameters and selected fields validate.
6. Preview/output satisfies runtime constraints.
7. Publication readiness passes.
```

Domain-specific blocks can accept a plugin-owned contract or exact source family.

# Registered adapters, not arbitrary mapping

The architecture reserves a controlled adapter layer for future repeated needs, but V1 charts consume canonical series sources directly.

Preferred V1:

```text
sales.opportunities-by-stage
  → series.category@1
  → PieChart
```

Not V1:

```text
sales.raw-opportunities
  → user writes group-by/sum/expression in builder
  → PieChart
```

A future adapter must be trusted, registered, versioned, schema-aware, bounded, and declaratively configured:

```text
adapter.table-fields-to-category-series@1
```

It can permit safe operations such as selecting already-aggregated fields or renaming labels. It must not accept arbitrary JavaScript, SQL, unrestricted expressions, joins, or unbounded browser aggregation.

Adapters are explicit graph nodes with their own compatibility and migration behavior. They are not hidden `select: "a.b.c"` strings.

# Query inputs

Output contracts do not force every plugin to share one input schema. Each source owns its input semantics.

K-Nex helpers can standardize common controls:

```text
selected field IDs
cursor/offset pagination
allowlisted sort
allowlisted filter operators
search term limits
date-range input
resource selectors
```

The runtime canonicalizes validated input before computing query identity.

A query-cache key includes at least:

```text
source ID
source major version
canonical validated input
selected field IDs
surface
actor/access scope
```

Two blocks using the same source and equivalent inputs should share one active query result. Cache entries never cross authorization scopes.

# Realtime interaction

Output contracts describe snapshots. Ordinary realtime behavior invalidates source queries rather than mutating contract payloads from arbitrary messages.

```text
module mutation commits
  → module invalidation topic/scope
  → authorized WebSocket signal
  → matching source query becomes stale
  → authenticated gateway refetch
  → new output-contract payload validates
  → components rerender
```

High-frequency stream sources define a separate typed snapshot/message/reducer contract. They do not silently overload `table.records@1` or `series.time@1` with unversioned patches.

# Security invariants

- Descriptors are authentication/surface/permission filtered.
- Query execution rechecks authorization regardless of discovery visibility.
- Source input is schema-validated and bounded.
- Source output passes source-specific and canonical validation.
- Table fields are stable allowlisted IDs, not arbitrary object paths.
- Unauthorized fields are neither described nor returned.
- Public pages bind only to explicit public-safe sources/contracts.
- Canonical payloads contain no unrestricted URLs, executable code, SQL, imports, secrets, or opaque extension bags.
- Cache keys and invalidation subscriptions include authorization-relevant scope.
- Invalid output fails closed rather than leaking undeclared data.
- Result sizes are bounded by source policy.

# Lifecycle and migrations

## Source evolution

A plugin source migration can:

- rename/remap source parameters;
- rename selected field IDs;
- update source major version references;
- update the declared contract reference;
- split one old source into purpose-built new sources;
- mark incompatible blocks/bindings as requiring administrator review.

## Contract evolution

A canonical contract migration is owned by K-Nex UI contracts and is rarer. Components and sources declare supported major ranges.

A plugin-owned contract migration is owned by the plugin that defines the contract.

## Deprecation lifecycle

```text
active
  selectable and executable

deprecated
  existing bindings execute; new selection warns or is blocked

migrating
  replacement and deterministic migration are supplied

removed
  allowed only after readiness finds no unresolved published references
```

Plugin disable/removal preserves stored source and contract references for diagnostics. Pages render safe unavailable/forbidden states instead of crashing.

# Initial package boundary

Canonical contract definitions, validators, TypeScript types, authoring helpers, and contract test utilities should initially live under the UI contract foundation rather than creating many tiny packages:

```text
@k-nex/ui-contracts
  ├── contracts
  │   ├── metric-scalar-v1
  │   ├── table-records-v1
  │   ├── category-series-v1
  │   ├── time-series-v1
  │   ├── options-list-v1
  │   └── record-summary-v1
  ├── data-source helpers
  ├── block input-port helpers
  └── contract testing
```

A separate package can be extracted later if release cadence or client/server bundle boundaries justify it.

Generic blocks remain in an optional horizontal UI/visualization module rather than platform core:

```text
module.visualization
  counter / metric
  data table
  pie / bar / line / area charts
```

# POC requirements

## Required sources

```text
sales.total-potential-revenue
  → metric.scalar@1

sales.tasks
  → table.records@1

sales.opportunities-by-stage
  → series.category@1

sales.revenue-over-time
  → series.time@1
```

## Required components

```text
Counter or Metric
DataTable
PieChart or BarChart
LineChart
```

## Required tests

1. Source-specific output schema conforms to the declared canonical contract.
2. A handler returning an undeclared field or invalid scalar fails with `SOURCE_OUTPUT_INVALID`.
3. Counter discovers only compatible metric sources.
4. DataTable discovers only compatible table sources and displays actor-authorized fields.
5. Nested/raw Payload paths cannot be selected as table fields.
6. PieChart rejects a multi-series or negative-value payload when its constraints disallow it.
7. Two blocks sharing one source/input reuse one active query result.
8. Source and contract versions are persisted independently.
9. An additive field changes descriptor hash without forcing a source-major migration.
10. Removing/renaming a selected field requires a source migration/readiness failure.
11. A lower-permission viewer receives no restricted field descriptor or value.
12. Public publication rejects an internal source.
13. WebSocket invalidation refetches and revalidates the source response.
14. Disabled/missing source renders a safe unavailable state.
15. At least one plugin-owned contract and domain block prove the hybrid model without an opaque extension bag.
16. Contract fixtures round-trip through the Puck adapter without changing source/contract identity.

# Implementation details intentionally left for POC

The architecture is accepted; the following library/API choices remain provisional:

- schema library and JSON-schema export strategy;
- exact `defineMetricSource` / `defineTableSource` TypeScript signatures;
- descriptor bundling versus authenticated fetch balance;
- client query/cache library;
- exact cursor encoding and pagination helper;
- locale/formatter implementation;
- table filter operator catalog;
- custom cell-renderer registry;
- production output-validation performance measurements;
- HTTP header conventions and error/problem implementation;
- SSR/hydration policy for CMS/public sources;
- first registered transformation adapter, if repeated need proves it.

# Rejected approaches

## Arbitrary source JSON plus manual field paths

Rejected because compatibility, authorization, migration, and builder UX become fragile.

## One source with many unrelated named outputs

Rejected because it creates implicit query negotiation, unclear cache/permission behavior, and over-fetching.

## Raw nested Payload documents in generic tables

Rejected because storage paths become public contracts and sensitive fields can leak.

## One metric contract per unit

Rejected for V1 in favor of the discriminated `metric.scalar@1` value family.

## Repeat descriptors in every query response

Rejected because descriptors are actor-filtered discovery metadata and should be cached separately.

## Version only the source or only the contract

Rejected because source semantics and shared component payload semantics evolve independently.

## Arbitrary chart expressions or visual SQL

Rejected for V1. Plugins expose purpose-built aggregate sources; future transformation adapters remain trusted, registered, versioned, and bounded.

# Non-goals

V1 output contracts do not provide:

- a universal representation of every domain object;
- automatic exposure of Payload collections;
- arbitrary joins, group-by, formulas, or user code;
- a GraphQL replacement;
- exact accounting/export semantics through chart series;
- client-side authorization;
- unrestricted extension metadata;
- automatic compatibility merely because two JSON values look similar.
