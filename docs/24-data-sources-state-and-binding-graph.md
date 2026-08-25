# Data Sources, UI State, and the Binding Graph

## Purpose

K-Nex should allow reusable, style-agnostic UI components to consume data exposed by any enabled plugin without hard-coding one backend endpoint, database query, or module implementation into the component.

The target editing experience is:

```text
1. Add a Pie Chart block.
2. Choose an available data source exposed by an enabled plugin.
3. Map source fields to label/value/series inputs.
4. Bind source parameters to static values, route context, or page state.
5. Optionally connect chart selection to another state or registered action.
6. Render through the selected theme and design-system adapter.
```

Example sources can include:

```text
CRM opportunities grouped by stage
restaurant sales grouped by menu category
inventory value grouped by warehouse
shipments grouped by delivery status
budget actual versus planned
live vehicles grouped by delay state
```

This capability turns the builder into a controlled application-composition system rather than only a static page editor.

The design must remain secure, typed, deterministic, permission-aware, versioned, and independent from the selected visual-editor engine.

## Decision summary

> Enabled plugins can expose typed data sources, typed UI state definitions, registered actions, block input/output ports, and safe binding metadata. Stored layouts connect these registered contracts declaratively. They never contain arbitrary JavaScript, SQL, imports, server functions, or secret values.

V1 intentionally supports:

- plugin-defined server data sources;
- plugin-defined read-only runtime context values;
- page-scoped typed state;
- static and state-bound data-source parameters;
- field mapping into generic visualization components;
- registered component events that update state or invoke registered actions;
- permission-, surface-, and audience-aware source discovery;
- optional realtime invalidation/stream contracts;
- deterministic graph validation and cycle prevention.

V1 intentionally does not support:

- arbitrary user-authored query code;
- direct browser database access;
- arbitrary JavaScript expressions;
- arbitrary SQL/GraphQL/REST URLs stored in layouts;
- unrestricted joins across plugins;
- unbounded client-side aggregation of sensitive records;
- user-created executable plugins from the admin panel.

## Canonical terminology

The word “state” is useful but ambiguous. K-Nex separates five concepts.

### Data source

A registered, usually server-executed query that returns an authorized projection.

```text
crm.opportunities.by-stage
inventory.stock-value.by-warehouse
logistics.shipments.by-status
restaurant.sales.by-category
```

A data source owns input/output schemas, permission policy, surface/audience policy, execution, limits, caching, sensitivity metadata, and versioning.

### Runtime context

A read-only value supplied by the application runtime.

Examples:

```text
context.current-user
context.current-role
context.current-branch
context.route.params
context.route.query
context.cms.locale
context.cms.preview-mode
context.workspace.page-id
context.theme.surface
```

Runtime context is not user-authored global state and cannot be overwritten by a block unless an explicit contract allows it.

### UI state

A typed value that coordinates components within an allowed scope.

Examples:

```text
page.filters.date-range
page.filters.pipeline-id
page.filters.selected-stage
workspace.selected-branch
component.expanded-row
```

A state definition owns schema, default, scope, persistence, read/write policy, and versioning.

### Binding

A serializable connection from one registered value or event to another registered input.

Examples:

```text
page date-range state → data-source period input
data-source rows → pie-chart data input
pie-chart slice-selection event → selected-stage state
selected-stage state → opportunities-table filter input
button click → registered export action
```

### Action

A registered, schema-validated request to perform behavior. The browser references an action ID; authoritative execution and authorization remain server-side.

```text
crm.opportunity.create
logistics.shipment.assign
inventory.stock.adjust
report.export.csv
```

## High-level architecture

```text
enabled plugins
   │
   ├── data-source definitions
   ├── state definitions
   ├── runtime-context definitions
   ├── action definitions
   ├── UI blocks with typed ports
   └── migrations
          │
          ▼
.k-nex/generated/ui-registry.ts
.k-nex/generated/data-source-registry.ts
.k-nex/generated/state-registry.ts
.k-nex/generated/action-registry.ts
          │
          ▼
K-Nex UI runtime
   ├── permission/audience filtering
   ├── binding graph validation
   ├── server query client
   ├── state store and persistence adapters
   ├── realtime invalidation/subscription client
   ├── action client
   └── renderer/theme binding
          │
          ▼
CMS or workspace builder profile
```

Puck or another editor adapter consumes the K-Nex registries. Domain plugins never import Puck types.

## Suggested packages

```text
@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-data-sources
@k-nex/ui-state
@k-nex/ui-bindings
@k-nex/ui-actions
@k-nex/module-visualization
@k-nex/builder-puck
@k-nex/ui-testing
```

These can initially live in one monorepo and may be consolidated into fewer publishable packages. The important boundary is conceptual and API-level.

## Data-source definition

Conceptual contract:

```ts
export interface UiDataSourceDefinition<
  TInput,
  TOutput,
> {
  id: string
  version: number
  pluginId: string

  title: string
  description?: string
  category?: string

  surfaces: readonly UiSurface[]
  audiences: readonly UiAudience[]

  permission?: string
  recordPolicy?: string

  inputSchema: Schema<TInput>
  outputSchema: Schema<TOutput>
  outputContract: DataContractReference

  execution: 'server' | 'client-context'

  limits: {
    maximumRows?: number
    maximumBytes?: number
    maximumExecutionMs?: number
    pagination?: 'none' | 'cursor' | 'offset'
  }

  cache: UiDataSourceCachePolicy
  sensitivity: UiDataSensitivity

  realtime?: UiRealtimeDataPolicy

  execute?: UiDataSourceExecutor<TInput, TOutput>
}
```

Example CRM source:

```ts
export const opportunitiesByStage = defineUiDataSource({
  id: 'crm.opportunities.by-stage',
  version: 1,
  pluginId: 'module.crm',

  title: 'Opportunities by stage',
  category: 'CRM',

  surfaces: ['workspace'],
  audiences: ['authenticated'],
  permission: 'crm.opportunities.read',

  input: z.object({
    pipelineId: z.string().optional(),
    dateRange: dateRangeSchema,
    branchId: z.string().optional(),
  }),

  outputContract: contract('dataset.category-series', 1),

  output: categorySeriesSchema,

  limits: {
    maximumRows: 100,
    maximumBytes: 128_000,
    maximumExecutionMs: 5_000,
    pagination: 'none',
  },

  cache: {
    classification: 'actor-and-input-scoped',
    maximumAgeSeconds: 30,
  },

  sensitivity: {
    classification: 'internal',
    containsPersonalData: false,
  },

  execute: async ({ input, actor, services }) => {
    return services.crmQueries.opportunitiesByStage({
      input,
      actor,
    })
  },
})
```

Example public restaurant source:

```ts
export const publicMenuCategories = defineUiDataSource({
  id: 'restaurant.public-menu.categories',
  version: 1,
  pluginId: 'module.qr-menu',
  title: 'Published menu categories',
  surfaces: ['public', 'cms'],
  audiences: ['anonymous', 'authenticated-editor'],
  permission: undefined,
  input: z.object({
    locale: localeSchema,
    branchSlug: z.string(),
  }),
  outputContract: contract('restaurant.public-menu-category-list', 1),
  output: publicMenuCategoryListSchema,
  limits: {
    maximumRows: 200,
    maximumBytes: 512_000,
    maximumExecutionMs: 3_000,
    pagination: 'none',
  },
  cache: {
    classification: 'public',
    maximumAgeSeconds: 60,
    tags: ['restaurant-menu'],
  },
  sensitivity: {
    classification: 'public',
    containsPersonalData: false,
  },
})
```

## Data contracts

A data source returns a typed output contract. Generic components consume shared contracts; domain components may consume domain-specific contracts.

Initial generic contracts can include:

```text
metric.scalar@1
dataset.tabular@1
dataset.category-series@1
dataset.multi-category-series@1
dataset.time-series@1
dataset.key-value@1
record.list@1
geo.feature-collection@1
status.summary@1
```

### Scalar metric

```ts
interface ScalarMetricV1 {
  value: number | string
  label?: string
  unit?: string
  comparison?: {
    value: number
    direction: 'up' | 'down' | 'same'
    label?: string
  }
}
```

### Category series

```ts
interface CategorySeriesV1 {
  rows: Array<{
    key: string
    label: string
    value: number
    colorRole?: string
    metadata?: Record<string, JsonValue>
  }>
}
```

### Time series

```ts
interface TimeSeriesV1 {
  series: Array<{
    key: string
    label: string
    points: Array<{
      at: string
      value: number
    }>
  }>
}
```

### Tabular dataset

```ts
interface TabularDatasetV1 {
  columns: Array<{
    key: string
    label: string
    type: 'string' | 'number' | 'boolean' | 'date' | 'datetime'
    sensitivity?: 'public' | 'internal' | 'personal' | 'restricted'
  }>
  rows: Array<Record<string, JsonValue>>
  page?: {
    nextCursor?: string
    total?: number
  }
}
```

Shared data contracts make generic visualization blocks possible without allowing arbitrary queries.

## Visualization plugin

A horizontal first-party plugin can provide style-agnostic visualization blocks:

```text
plugin ID: module.visualization
package:   @k-nex/module-visualization
```

Possible blocks:

```text
visualization.metric
visualization.pie-chart
visualization.bar-chart
visualization.line-chart
visualization.area-chart
visualization.data-table
visualization.status-list
visualization.progress
visualization.geo-map
```

The plugin owns:

- generic semantic renderers;
- accepted data contracts;
- field mapping configuration;
- accessible labels and empty/error/loading behavior;
- chart interaction events;
- theme semantic roles;
- versioned block schemas;
- no domain query logic.

Example pie-chart definition:

```ts
export const pieChartBlock = defineUiBlock({
  id: 'visualization.pie-chart',
  version: 1,
  pluginId: 'module.visualization',
  title: 'Pie chart',
  category: 'Data visualization',
  surfaces: ['workspace', 'cms', 'public'],

  props: {
    title: field.text(),
    legend: field.boolean({ default: true }),
    valueFormat: field.enum({
      values: ['number', 'currency', 'percent'],
    }),
  },

  inputs: {
    data: port.data({
      required: true,
      accepts: [
        contract('dataset.category-series', 1),
        contract('dataset.tabular', 1),
      ],
    }),
  },

  outputs: {
    sliceSelected: port.event({
      schema: z.object({
        key: z.string(),
        label: z.string(),
        value: z.number(),
      }),
    }),
  },

  renderer: PieChart,
})
```

The same chart can render CRM, inventory, logistics, or restaurant data as long as the selected data source emits a compatible contract or a validated mapping produces one.

## Block input and output ports

Blocks declare ports separately from ordinary static properties.

```ts
interface UiBlockDefinition {
  id: string
  version: number
  props: UiFieldDefinitions
  inputs?: Record<string, UiInputPortDefinition>
  outputs?: Record<string, UiOutputPortDefinition>
}
```

### Static property

Stored directly in the layout:

```text
chart title
legend enabled
visual density
empty-state message
```

### Input port

Receives dynamic data or state:

```text
data
selected branch
selected date range
record ID
locale
```

### Output/event port

Emits a typed user interaction:

```text
slice selected
row selected
filter changed
button clicked
map marker selected
form submitted
```

The binding editor connects only compatible source and destination schemas.

## State definition

Conceptual contract:

```ts
export interface UiStateDefinition<TValue> {
  id: string
  version: number
  pluginId: string
  title: string

  schema: Schema<TValue>
  defaultValue?: TValue

  scopes: readonly UiStateScope[]
  persistence: UiStatePersistence

  surfaces: readonly UiSurface[]
  audiences: readonly UiAudience[]

  readableBy?: UiStatePolicy
  writableBy?: UiStatePolicy

  migration?: UiStateMigrationReference[]
}
```

Example:

```ts
export const pageDateRangeState = defineUiState({
  id: 'ui.filters.date-range',
  version: 1,
  pluginId: 'ui-foundation',
  title: 'Date range',
  schema: dateRangeSchema,
  defaultValue: {
    mode: 'relative',
    value: 'last-30-days',
  },
  scopes: ['page'],
  persistence: 'layout-or-user-preference',
  surfaces: ['workspace'],
  audiences: ['authenticated'],
})
```

Plugin-specific state:

```ts
export const selectedPipelineState = defineUiState({
  id: 'crm.filters.selected-pipeline',
  version: 1,
  pluginId: 'module.crm',
  title: 'Selected CRM pipeline',
  schema: z.string().nullable(),
  defaultValue: null,
  scopes: ['page', 'workspace'],
  persistence: 'user-preference',
  surfaces: ['workspace'],
  audiences: ['authenticated'],
})
```

## State scopes

Initial scopes:

| Scope | Meaning | Typical lifetime |
|---|---|---|
| `component` | private to one block instance | render/session |
| `page` | shared among blocks on one page | page session or persisted layout default |
| `workspace` | shared among pages within an authenticated workspace shell | session/user preference |
| `route` | derived from route path/query | navigation lifetime; usually read-only adapter |
| `session` | application session value | current login/session |
| `user-preference` | explicitly persisted per user | across sessions |
| `cms-preview` | current editor/preview context | editor session |

V1 should prioritize:

```text
component
page
route/read-only context
session/read-only context
user-preference for approved filters/layouts
```

A broad mutable application-global store is not part of the builder contract.

## State persistence

State definitions choose one persistence policy:

```text
none                  ephemeral only
url                   encoded into approved route/query fields
session               browser/session storage through runtime adapter
user-preference       server-stored per user
layout-default        default stored in published layout
layout-or-user        published default with personal override
```

Sensitive values must not be persisted into URLs or public layout documents.

Persisting a filter default is different from persisting live data. Layout/state storage records configuration values, never data-source result sets unless a block deliberately owns static CMS content.

## Runtime context definitions

Runtime contexts are registered read-only values.

```ts
export const currentBranchContext = defineUiContext({
  id: 'context.current-branch',
  version: 1,
  schema: z.string().nullable(),
  surfaces: ['workspace'],
  resolve: ({ actor, session }) =>
    session.selectedBranchId ?? actor.defaultBranchId ?? null,
})
```

Other examples:

```text
context.current-user.id
context.current-user.locale
context.current-role.ids
context.current-branch
context.route.params.shipmentId
context.route.query.search
context.cms.locale
context.cms.page-slug
context.cms.preview-mode
context.public.signed-session-id
```

A layout can bind to context IDs and declared paths, not arbitrary global objects.

## Binding kinds

V1 binding kinds:

```text
static
context
state
data-source
component-event
set-state
action
resource-reference
```

Potential later kinds:

```text
safe-transform-pipeline
derived-state
expression language with strict sandbox/schema
workflow trigger
```

Arbitrary JavaScript is not a binding kind.

## Stored layout example

The following page coordinates four blocks:

- a date-range picker;
- a CRM pie chart;
- a selected-stage state;
- an opportunity table filtered by that state.

```json
{
  "schemaVersion": 2,
  "pageId": "workspace.sales-overview",
  "state": {
    "definitions": [
      {
        "id": "page.date-range",
        "type": "ui.filters.date-range",
        "version": 1,
        "default": {
          "mode": "relative",
          "value": "last-30-days"
        }
      },
      {
        "id": "page.selected-stage",
        "type": "crm.filters.selected-stage",
        "version": 1,
        "default": null
      }
    ]
  },
  "regions": {
    "main": [
      {
        "id": "date-filter",
        "type": "ui.date-range-filter",
        "version": 1,
        "props": {
          "label": "Period"
        },
        "bindings": {
          "value": {
            "kind": "state",
            "state": "page.date-range"
          },
          "changed": {
            "kind": "set-state",
            "state": "page.date-range",
            "value": {
              "kind": "event-path",
              "path": "value"
            }
          }
        }
      },
      {
        "id": "stage-chart",
        "type": "visualization.pie-chart",
        "version": 1,
        "props": {
          "title": "Opportunities by stage",
          "legend": true,
          "valueFormat": "currency"
        },
        "bindings": {
          "data": {
            "kind": "data-source",
            "source": "crm.opportunities.by-stage",
            "sourceVersion": 1,
            "params": {
              "dateRange": {
                "kind": "state",
                "state": "page.date-range"
              },
              "branchId": {
                "kind": "context",
                "context": "context.current-branch"
              }
            },
            "mapping": {
              "label": "label",
              "value": "value",
              "key": "key"
            }
          },
          "sliceSelected": {
            "kind": "set-state",
            "state": "page.selected-stage",
            "value": {
              "kind": "event-path",
              "path": "key"
            }
          }
        }
      },
      {
        "id": "opportunity-table",
        "type": "crm.opportunity-table",
        "version": 1,
        "props": {
          "pageSize": 20
        },
        "bindings": {
          "data": {
            "kind": "data-source",
            "source": "crm.opportunities.list",
            "sourceVersion": 2,
            "params": {
              "dateRange": {
                "kind": "state",
                "state": "page.date-range"
              },
              "stageId": {
                "kind": "state",
                "state": "page.selected-stage"
              },
              "branchId": {
                "kind": "context",
                "context": "context.current-branch"
              }
            }
          }
        }
      }
    ]
  }
}
```

This document stores references and validated configuration only. It stores neither opportunity records nor executable query code.

## Builder data-source selection UX

When an editor selects the `visualization.pie-chart` block, the property panel can show:

```text
Data source
  CRM
    Opportunities by stage
    Opportunities by owner
    Leads by source

  Logistics
    Shipments by status
    Delayed shipments by branch

  Restaurant
    Sales by category
    Orders by channel

  Inventory
    Stock value by warehouse
```

The list is filtered by:

- enabled plugins;
- source version compatibility;
- block input contract compatibility;
- current builder profile/surface;
- current editor's permission to preview/configure the source;
- public versus authenticated audience;
- customer policy;
- source deprecation status.

After selection, the editor is generated from the source input schema:

```text
Pipeline       [choose resource]
Date range     [static | bind to state]
Branch         [current branch | choose | bind to context]
Currency       [TRY]
```

For a tabular source, the block can request field mapping:

```text
Label field    stageLabel
Value field    totalValue
Key field      stageId
```

The editor never asks for SQL, endpoint URLs, tokens, or JavaScript.

## Resource selectors

A plugin can register a resource-selector contract for configuration-time choices.

Examples:

```text
crm.pipeline
crm.owner
restaurant.branch
inventory.warehouse
logistics.fleet
budget.cost-center
```

A field declared as:

```ts
field.resource({ resource: 'crm.pipeline' })
```

uses a registered, permission-aware selector data source. The stored layout contains the selected stable resource ID, not a copied record.

Selectors are separate from render-time data sources but follow the same authorization and projection rules.

## Static values versus bindings

Every bindable input defines whether it accepts:

```text
static value only
state/context only
data-source only
static or state/context
data-source plus mapping
```

Example:

```ts
inputs: {
  branchId: port.value({
    schema: z.string().nullable(),
    accepts: ['static', 'context', 'state'],
  }),
  data: port.data({
    accepts: [contract('dataset.category-series', 1)],
  }),
}
```

The editor must not present invalid connection types.

## Field mapping

Generic components need a controlled way to map source output fields.

V1 allows:

```text
select field
rename semantic role
choose label/value/key/series/time fields
format number/date/currency
supply static fallback
```

V1 should not perform arbitrary user-defined functions.

Example mapping:

```json
{
  "mapping": {
    "key": "stageId",
    "label": "stageName",
    "value": "opportunityCount"
  }
}
```

The runtime validates the mapping against the registered output schema before publication and again when loading a document after upgrades.

## Safe transformations

There is value in allowing reusable transformations, but unrestricted transformations become a hidden programming/query language.

### V1 decision

Use plugin-defined, pre-aggregated data sources plus field mapping. Do not ship a generic visual SQL/query builder in V1.

This means a CRM plugin should expose:

```text
crm.opportunities.by-stage
crm.opportunities.by-owner
crm.revenue.time-series
```

rather than exposing all raw opportunity rows and asking the browser to aggregate them.

### Future safe transform registry

A later first-party plugin can provide server-executed, allowlisted operators:

```text
select
rename
filter on declared fields
sort
limit
group
count
sum
average
minimum
maximum
date bucket
coalesce
```

Each operator must define:

- input/output schemas;
- cost and row limits;
- allowed sensitivity classifications;
- server/client execution policy;
- deterministic serialization;
- versioning;
- authorization inheritance;
- cycle/dependency behavior.

A transform graph must not widen the original data-source authorization or cache scope.

## Binding graph

A resolved page becomes a directed graph.

Node kinds:

```text
state
context
data-source execution
block input
block output/event
action invocation
```

Edge examples:

```text
state → source parameter
context → source parameter
source result → block input
block event → state write
block event → action input
state → block input
```

The graph resolver must:

1. verify every referenced ID exists;
2. verify source/destination schema compatibility;
3. verify surface and audience compatibility;
4. verify data-source/action permission requirements;
5. reject prohibited public-to-private connections;
6. detect synchronous cycles;
7. validate required inputs;
8. calculate execution/invalidation dependencies;
9. record deprecation/migration warnings;
10. produce a deterministic runtime plan.

## Cycle policy

The following cycle is unsafe:

```text
state A changes
  → source X executes
  → component event immediately writes state A
  → source X executes forever
```

V1 rejects binding graphs with direct or derived synchronous cycles.

User events can legitimately update state that re-runs a query. The distinction is that the write originates from an explicit user interaction, not from every render/result emission.

State writes should use equality checks and transaction/batching so an unchanged value does not trigger another execution.

## Execution model

### Server data sources

Default for plugin/domain data.

```text
browser sends source ID + validated input
server resolves registered source
server checks actor/surface/audience/record policy
server executes bounded query/projection
server validates output
server applies safe cache policy
browser receives projection only
```

The browser never chooses a handler import or raw endpoint.

### Client-context sources

Allowed only for non-sensitive runtime values such as viewport size, local theme preference, or already-authorized session context.

They cannot claim server permissions or access server secrets.

### Server rendering

Public/CMS pages may execute public-safe data sources during server rendering. Workspace pages may use authenticated server rendering where the framework/session model supports it.

Every source declares whether it supports:

```text
server render
client fetch
preview render
public cache
realtime updates
```

## Authorization

Data-source discovery in the builder is not authorization.

Every execution performs server-side checks using:

```text
actor identity
permission key
record/domain policy
surface
audience
customer/application context
public signed-session context where relevant
input bounds
```

A user can manually call the network endpoint even when the UI hides a source, so the endpoint must reject unauthorized execution.

A source should return a purpose-specific projection, not unrestricted database documents.

## Public CMS sources

A source used by a public page must explicitly allow the `public` surface and an anonymous or signed public audience.

Examples:

```text
restaurant.public-menu
cms.published-posts
logistics.public-tracking.summary
crm.public-event-list
```

Public source requirements:

```text
narrow projection
rate limits
bounded input
safe cache classification
no internal permission inheritance
privacy/consent review
abuse resistance
signed short-lived lookup session where necessary
no hidden internal fields
```

An authenticated editor preview does not make an internal workspace source safe for public publication.

The builder must block publication when a public layout references a non-public source.

## Data sensitivity

Definitions can classify outputs and fields:

```text
public
internal
personal
restricted
financial
location
health-sensitive
```

The policy influences:

- eligible surfaces;
- preview behavior;
- client/server transform allowance;
- cache scope;
- logging/redaction;
- export actions;
- realtime delivery;
- builder sample-data display;
- audit requirements.

Example:

```ts
sensitivity: {
  classification: 'personal',
  containsPersonalData: true,
  fields: {
    email: 'personal',
    phone: 'personal',
  },
}
```

Preview panels should use redacted or sampled data when the editor lacks permission to view full results.

## Caching

A data source declares one of the initial cache classifications:

```text
none
public
application-scoped
actor-scoped
actor-and-input-scoped
signed-session-scoped
```

Cache keys include every authorization-relevant dimension.

Incorrect:

```text
crm.contacts + input only
```

Correct when actor-scoped:

```text
application ID
actor ID or policy scope
permission/policy version where required
source ID/version
normalized validated input
```

Sensitive actor-scoped results must never be served from a public/shared cache.

## Realtime data sources

A data source can declare realtime behavior without coupling domain plugins to one WebSocket package.

Two initial patterns:

### Invalidation

```text
initial snapshot from ordinary server data source
realtime event indicates relevant data changed
client invalidates/refetches source
```

Example:

```ts
realtime: {
  mode: 'invalidate',
  capability: 'realtime.gateway',
  topics: ['crm.opportunity.changed'],
}
```

### Stream/projection

```text
initial snapshot
authorized subscription provides typed incremental updates
runtime merges through source-owned reducer
```

Example:

```ts
realtime: {
  mode: 'stream',
  capability: 'realtime.gateway',
  channel: 'logistics.live-positions',
  messageSchema: livePositionMessageSchema,
  reduce: reduceLivePositions,
}
```

V1 should prefer invalidation for ordinary dashboards and use streams only for genuine realtime experiences such as live maps.

The source/plugin owns channel authorization and message semantics. The visualization component only consumes the resulting data contract.

## Actions and event bindings

A component output event can invoke a registered action.

Example export button:

```json
{
  "id": "export-button",
  "type": "ui.button",
  "version": 1,
  "props": {
    "label": "Export current view"
  },
  "bindings": {
    "clicked": {
      "kind": "action",
      "action": "crm.opportunities.export",
      "params": {
        "dateRange": {
          "kind": "state",
          "state": "page.date-range"
        },
        "stageId": {
          "kind": "state",
          "state": "page.selected-stage"
        }
      }
    }
  }
}
```

The server action independently validates input, permission, record policy, idempotency, rate limits, audit requirements, and job execution.

Builder documents cannot bind directly to internal domain service method names.

## Loading, empty, error, and stale states

Every dynamic block must handle:

```text
loading
empty result
permission denied
invalid binding
source unavailable
source timeout
partial/stale realtime connection
deprecated source
orphan source after plugin removal
```

The block can use default semantic renderers from the design system. Customer themes style them without changing security or retry behavior.

A single failed widget should not crash the entire page unless the page policy marks it critical.

## Source instances versus source definitions

A source definition is executable code registered by a plugin.

A source instance is serializable configuration stored in a layout.

Definition:

```text
crm.opportunities.by-stage@1
```

Instance:

```json
{
  "source": "crm.opportunities.by-stage",
  "sourceVersion": 1,
  "params": {
    "pipelineId": "enterprise",
    "dateRange": {
      "kind": "state",
      "state": "page.date-range"
    }
  }
}
```

The database stores instances/references, never the resolver function.

## Versioning

Every persisted contract carries a stable ID and schema version:

```text
block ID/version
data-source ID/version
data-contract ID/version
state-definition ID/version
action ID/version where persisted
binding-document schema version
```

Breaking changes require deterministic migration or parallel registration.

Example source migration:

```ts
registerDataSourceMigration({
  sourceId: 'crm.opportunities.by-stage',
  from: 1,
  to: 2,
  migrateInstance: instance => ({
    ...instance,
    params: {
      ...instance.params,
      currencyMode: 'application-default',
    },
  }),
})
```

Output-contract changes can require a block mapping migration even when source input is unchanged.

## Deprecation and removal

Lifecycle:

```text
active
deprecated
migration-available
removed
```

A deprecated source:

- remains executable for existing layouts;
- is hidden or marked in the new-source picker;
- identifies replacement and migration;
- appears in readiness diagnostics.

Before source removal:

```text
scan draft/published CMS pages
scan customer/role/user workspace layouts
scan saved report definitions
scan theme preview fixtures if applicable
migrate or remove every reference
verify no compatible older customer app still requires it
```

Uninstalling a plugin does not automatically delete layout references.

## Plugin removal behavior

When a layout references a source from a disabled or missing plugin:

- page resolution reports an orphan binding;
- normal users receive a safe unavailable/empty fallback according to page policy;
- administrators see source ID, plugin owner, expected version, and remediation;
- publication of a newly invalid public page is blocked;
- existing published behavior follows configured fail-safe policy;
- purge requires explicit reference cleanup/migration.

## Generated registries

The CLI generates static registries:

```text
.k-nex/generated/
├── ui-registry.ts
├── data-source-registry.ts
├── data-contract-registry.ts
├── state-registry.ts
├── context-registry.ts
├── action-registry.ts
└── binding-inventory.json
```

Example generated imports:

```ts
import { crmUiContribution } from '@k-nex/module-crm/ui'
import { logisticsUiContribution } from '@k-nex/module-logistics/ui'
import { visualizationContribution } from '@k-nex/module-visualization/ui'

export const uiRegistry = composeUiRegistry([
  crmUiContribution,
  logisticsUiContribution,
  visualizationContribution,
])
```

No runtime database value determines an import path.

## CLI and diagnostics

Proposed commands:

```bash
k-nex ui sources
k-nex ui states
k-nex ui actions
k-nex ui bindings:check
k-nex ui references <plugin-or-source-id>
k-nex ui migrate
k-nex doctor
```

`k-nex doctor` checks:

```text
duplicate IDs
missing plugin ownership
schema/version conflicts
unresolved source references
incompatible block/source contracts
invalid field mappings
public/private surface violations
permission metadata omissions
unbounded source limits
binding cycles
missing realtime capability
orphan states/actions
stale generated registries
pending layout migrations
```

## Builder editor panels

A useful V1 property/editor layout:

```text
Content
  static text and component settings

Data
  source picker
  source parameters
  state/context bindings
  field mapping
  sample/preview

Interactions
  output events
  set-state bindings
  registered action bindings

Visibility
  surface/audience constraints
  role/permission-aware display policy where allowed

Advanced diagnostics
  contract versions
  cache/realtime behavior
  deprecation warnings
```

Editors should be able to understand where a value comes from without reading JSON.

## Preview behavior

Builder preview executes the same source contract through a preview context.

Rules:

- editor identity and permission are preserved;
- public preview does not silently upgrade to internal output;
- sample/redacted data can be used for restricted sources;
- destructive actions are disabled or require a dedicated safe preview mode;
- realtime preview subscriptions are bounded and cleaned up;
- source errors are visible with developer/admin diagnostics but safe user messaging;
- preview never prints secrets or unrestricted internal responses.

## CMS usage

The same binding architecture supports public CMS pages, with a narrower source/action registry.

Examples:

```text
published blog list
restaurant menu
branch selector
public tracking lookup
lead form
event schedule
inventory availability projection approved for public display
```

CMS profile policy can decide whether a block is:

```text
static content only
public data-bound
editor-preview only
authenticated portal only
```

The renderer uses the public theme. The source/action authorization remains independent of styling.

## Workspace usage

Workspace profiles can use authenticated sources, page state, user preferences, actions, and realtime providers.

Examples:

```text
sales dashboard with shared date/pipeline filters
logistics operations overview with live map
inventory dashboard with warehouse selector
budget dashboard with cost-center state
role-specific executive summary
personal dashboard with user-persisted widgets
```

Operational transaction screens remain module-owned in V1, but can reuse the same data-source/action/state contracts internally.

## Example: logistics operations dashboard

```text
DateRangeFilter
   └── writes page.filters.date-range

BranchSelector
   └── writes workspace.selected-branch

ShipmentStatusBarChart
   └── data: logistics.shipments.by-status
       params:
         dateRange ← page.filters.date-range
         branchId  ← workspace.selected-branch
   └── barSelected → page.filters.shipment-status

DelayedShipmentTable
   └── data: logistics.shipments.list
       params:
         branchId ← workspace.selected-branch
         status   ← page.filters.shipment-status

LiveFleetMap
   └── data: logistics.live-fleet.snapshot
   └── realtime: logistics.live-fleet.stream
   └── markerSelected → page.selected-shipment
```

## Example: restaurant dashboard

```text
BranchSelector
   └── writes workspace.selected-branch

SalesByCategoryPieChart
   └── data: restaurant.sales.by-category
       params:
         branchId  ← workspace.selected-branch
         dateRange ← page.filters.date-range

LowStockTable
   └── data: inventory.low-stock-items
       params:
         warehouseId ← inventory.context.branch-warehouse

BudgetMetric
   └── data: budget.variance.metric
       params:
         costCenter ← page.filters.cost-center
```

## Example: public CMS page

```text
BranchSelector
   └── writes page.public-branch

MenuCategoryGrid
   └── data: restaurant.public-menu.categories
       params:
         branchSlug ← page.public-branch
         locale     ← context.cms.locale

ReservationForm
   └── action: restaurant.public-reservation.submit
```

Every source/action in this page must be explicitly public-safe.

## Testing strategy

### Contract tests

Every data source passes:

```text
input validation
output validation
permission denial
record-policy filtering
surface/audience rejection
row/byte/time limits
cache-key classification
sensitivity metadata
error normalization
version fixture compatibility
```

Every state definition passes:

```text
schema/default validation
scope enforcement
persistence policy
write-policy enforcement
migration fixture
```

Every block passes:

```text
accepted contract validation
field mapping validation
loading/empty/error/accessibility states
event output schema
multiple themes
server/client render where supported
```

### Graph fixtures

Maintain fixtures for:

```text
valid static dashboard
valid cross-component filter graph
public CMS data binding
realtime invalidation
realtime stream
missing source
orphan state
version migration
permission denial
public/private violation
direct cycle
indirect cycle
schema mismatch
```

### Customer fixtures

At minimum:

```text
cargo customer:
  logistics + CRM + visualization + realtime

restaurant customer:
  CMS + QR menu + inventory + budget + visualization
```

The same visualization blocks should render different plugin data through different themes.

## POC acceptance criteria

The binding architecture is accepted for implementation when the POC proves:

1. CRM and logistics plugins register independent typed data sources;
2. a generic pie/bar chart can select either source without importing those modules;
3. the builder filters the source picker by output-contract compatibility;
4. a date-range component writes page state and triggers source re-execution;
5. chart selection writes a typed state consumed by a table source;
6. invalid schema connections are rejected before publication;
7. an unauthorized source remains inaccessible even when called manually;
8. a public CMS page cannot publish with an internal workspace source;
9. one source supports realtime invalidation through `realtime.gateway`;
10. a missing/disabled plugin produces an orphan diagnostic without crashing the whole page;
11. stored JSON contains no executable function, SQL, endpoint credential, package import, or result snapshot;
12. the same stored layout renders through two different installed theme packages;
13. data-source/block/state version migrations preserve fixture behavior;
14. direct and indirect binding cycles are detected deterministically;
15. `k-nex doctor` reports all unresolved references and contract mismatches.

## Open implementation questions

The architecture direction is accepted; the POC must settle:

- whether state management uses a small custom store or an existing headless library behind K-Nex contracts;
- exact schema technology exposed in public package contracts;
- how source output schemas expose selectable field metadata safely;
- whether source preview samples are live, redacted, generated, or plugin-provided fixtures;
- whether user-preference state is stored in one central collection or plugin-owned stores;
- exact binding-graph serialization and normalization order;
- how server-rendered CMS pages hydrate state-bound data without duplicate execution;
- whether safe transformations are part of V1.1 or a separate plugin;
- how realtime stream reducers are versioned and tested;
- maximum graph/source complexity and cost budgeting;
- how role/customer layout inheritance interacts with state-definition overrides;
- whether generic tables/charts live in `module.visualization` or a foundational UI package.

## Non-goals

This system is not intended to become, in V1:

- a no-code arbitrary database query product;
- a replacement for domain APIs and services;
- an unrestricted workflow programming language;
- a browser-side analytics warehouse;
- a place to paste SQL, JavaScript, GraphQL, or arbitrary URLs;
- a way to bypass plugin/module permissions;
- a guarantee that every source can bind to every component;
- a runtime marketplace for executable data connectors;
- a mechanism for storing live customer records inside layout JSON.
