# Glossary

## Action

See **UI action**. A registered, schema-validated request to perform behavior. Builder documents reference stable action IDs; authoritative execution remains server-side.

## Application

One independently deployed customer product composed from Payload, K-Nex packages, customer code, configuration, themes, data, and infrastructure.

## Application manifest

`k-nex.app.json`, the declarative desired composition of a customer application. It lists application identity, Payload framework/scaffold choices, K-Nex plugins/providers, builder profiles, themes, and local/deployment options without secret values.

## Binding

A serializable, schema-validated connection among registered runtime context, UI state, data sources, block ports, registered adapters, and actions.

Examples:

```text
page state → source parameter
data-source result → component input
chart selection → page state
button event → registered action
```

Bindings never contain arbitrary executable code, Payload queries, SQL, imports, secrets, unrestricted URLs, or raw object-path expressions.

## Binding graph

The resolved directed graph of context/state/source/adapter/block/action nodes for one UI document. The runtime validates ownership, versions, schemas, surfaces, permissions, required inputs, and cycles.

## Build manifest

Generated machine-readable inventory of exact Payload/K-Nex versions, selected Payload adapter, plugins/providers, UI/source/contract/action/state/theme inventory, and release/migration metadata.

## Builder

A plugin adapting a visual editor to K-Nex block/layout/binding/profile/publication contracts. Initial candidate: `builder.puck`.

## Builder profile

Policy for using the builder on a surface. CMS and workspace profiles expose different palettes, audiences, sources, actions, state, themes, scopes, and publication workflows.

## Canonical output contract

K-Nex-owned versioned semantic result shape understood by generic components.

Initial catalog:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

A source-specific schema must validate against the declared canonical contract.

## Capability

A versioned contract provided/consumed by K-Nex plugins where implementation substitution matters, such as `realtime.gateway`, `storage.objects`, `email.delivery`, or `builder.engine`.

Payload's primary database adapter is not a K-Nex capability.

## Catalog

Trusted list of selectable K-Nex packages presented by the CLI. V1 contains first-party or explicitly reviewed private packages.

## Category series

Canonical category-based chart result `series.category@1`. It contains stable categories and one or more numeric series with measure metadata. Pie/BarChart components can impose stricter constraints than the shared contract.

## Composition root

Customer application location where generated registries, manifest, customer TypeScript config, and final Payload configuration become the runnable product.

## Contract conformance

Requirement that a data-source result validate against both its exact source-specific output schema and its declared canonical or plugin-owned output contract.

Metadata assertion alone does not create compatibility.

## Contract version

Major version of an output contract's shared semantic shape, independent from source version and npm package version.

## Customer application

See **Application**. It has a separate repository, database, deployment, storage, secrets, migrations, and release cadence.

## Customer extension

Executable code in a customer repository implementing a real customer-specific policy, integration, source, output contract, action, block, or override through documented contracts.

## Customer shell

Generated customer repository/application scaffold. It owns composition, presentation, extensions, migrations, and infrastructure while consuming shared packages.

## Data source

A plugin-owned, registered, schema-validated, permission-aware server query/projection exposed to UI blocks.

Examples:

```text
sales.total-potential-revenue
sales.tasks
sales.opportunities-by-stage
```

Stored layouts reference source IDs, source/contract versions, parameters, and selected stable fields—not raw collection access, SQL, or live records.

## Data-source descriptor

Actor-filtered browser-safe metadata for a source:

```text
ID/version/owner
title/category
surfaces/audience
input schema and limits
primary output contract
source-specific schema/hash
stable fields
pagination/sort/filter rules
cache/realtime policy
```

Descriptors are discovered separately from paginated/query result data.

## Descriptor hash

Deterministic hash of the actor-filtered source descriptor. It changes for nonbreaking discovery changes, such as a newly available field, without necessarily changing the source major version.

Stored layouts do not use the descriptor hash as their persisted source version.

## Data-source handler

Server-only plugin code implementing a source. It uses authenticated Payload request context and/or module domain services and returns a bounded projection.

## Data-source gateway

Recommended standard K-Nex transport that authenticates, validates, authorizes, observes, and dispatches source requests to plugin-owned handlers.

Conceptual route:

```text
POST /api/k-nex/data-sources/:sourceId/query
```

## Data-source instance

Serializable layout binding selecting one registered source with validated parameters, selected stable field IDs, and expected output-contract identity/version.

## Design-system adapter

Implementation of semantic primitives such as `Button`, `Card`, `DataTable`, `Chart`, and `Dialog`, supplied by the chosen theme/design layer and customer overrides.

## Disable

Keep a plugin installed and its data/schema available while gating declared navigation, sources, actions, writes, jobs, routes, and subscribers.

## Domain event

Versioned past-tense business fact published after successful state change, such as `sales.task.completed` or `logistics.shipment.delivered`.

## Domain service

Authoritative backend behavior enforcing business rules, transactions, actor context, and events. Payload hooks/endpoints adapt into services.

## Extension slot

Documented place where another plugin/customer app can add or replace behavior/UI without patching private implementation.

## Field metadata

Source-declared information for a stable field ID:

```text
ID and label
semantic value type
nullability
default visibility
sort/filter capability
enum/options metadata
permission/sensitivity
```

Field IDs are opaque stable identifiers, not nested Payload object paths.

## Field selection

Serializable allowlisted stable source field IDs selected for a component, such as DataTable visible columns.

```text
title
status
dueAt
assignee
```

A field selection cannot request undeclared/private paths such as `assignee.passwordHash`.

## Generated registry

Deterministic static TypeScript import/registration file produced by the CLI for plugins, providers, Payload contributions, UI, sources, output contracts, actions, state/context, themes, and builder adapters.

## Hybrid output-contract model

Architecture in which generic components consume a small catalog of canonical K-Nex contracts while domain-specific components can consume namespaced plugin-owned contracts.

Canonical payloads do not receive an unrestricted extension bag.

## Input port

Typed dynamic input declared by a block, such as `data`, `dateRange`, or `recordId`. A port declares accepted source/output-contract version ranges and optional constraints.

## Invalidation

Realtime notification that one or more source query results may be stale. The client normally refetches the authenticated source endpoint.

## Integration plugin

Reusable package connecting modules/capabilities without forcing private implementation imports.

## Layout

Versioned structured document describing registered blocks, props, regions, and declarative bindings. It contains no arbitrary executable code or result snapshots.

## Measure descriptor

Semantic metadata attached to chart series values, such as number, money/currency, percentage scale, duration unit, or another bounded numeric unit.

## Metric scalar

Canonical metric result `metric.scalar@1`. It carries one discriminated semantic value—such as number, decimal, money, percentage, duration, or text—plus optional comparison and `asOf` metadata.

## Module

Plugin providing reusable horizontal/domain behavior, such as CMS, Sales, Visualization, Dispatch, Inventory, or QR Menu.

## Null versus omitted

For selected authorized fields, `null` means the value is known to be absent. An omitted field means it was unselected or unauthorized. Canonical table handling must not conflate these states.

## One primary projection

Rule that one data source declares exactly one business output contract. Separate metric, table, and chart sources can share underlying domain query services.

Pagination/transport metadata does not count as a second business projection.

## Opaque extension bag

Unrestricted structure such as `extensions: Record<string, unknown>` added to a canonical payload. Rejected because it bypasses contract compatibility, security review, and migrations.

Use a plugin-owned contract or another source instead.

## Operational screen

Module-owned workflow screen such as dispatch board or stock adjustment. It may expose extension slots but is not fully arbitrary drag-and-drop in V1.

## Options list

Canonical choice result `options.list@1`, used for selects, filters, and resource pickers. Option keys are stable values; labels can be localized/presentational.

## Orphan binding

Stored binding whose source/state/context/action/field/contract/compatible port is unavailable or incompatible. Preserved and reported rather than silently deleted.

## Orphan block

Stored block whose plugin/component is unavailable or incompatible. It does not crash the whole page.

## Output contract

Versioned semantic result shape declared by a data source and accepted by component input ports. It can be canonical K-Nex-owned or namespaced/plugin-owned.

## Output port

Typed event/value emitted by a block, such as `rowSelected`, `sliceSelected`, or `filterChanged`.

## Package

Concrete versioned registry artifact such as `@k-nex/module-sales@1.4.2`. Distinct from stable plugin/source/contract IDs.

## Payload database adapter

Framework dependency selected during scaffold generation, such as `@payloadcms/db-postgres`. Payload owns adapter integration, persistence APIs, transactions, and migration integration.

It is not a K-Nex provider plugin.

## Payload request context

Authenticated/request-scoped context passed to module handlers/services, commonly exposing `req.payload`, actor/session information, locale, transaction/access behavior, and request metadata.

## Platform core

Small domain-neutral layer providing contracts, plugin/capability resolution, registries, permissions/events/jobs/audit foundations, Payload composition support, and testing utilities.

## Plugin

Umbrella installable K-Nex concept. Kinds: module, provider, builder, theme, integration, preset.

## Plugin ID

Stable product identity such as `module.sales`, `provider.realtime-websocket-local`, or `theme.neobrutalism`, independent of package location.

## Plugin-owned output contract

Namespaced semantic result shape defined by a plugin for a domain-specific component.

Examples:

```text
sales.pipeline-board@1
logistics.dispatch-board@1
```

Generic components do not automatically consume plugin-owned contracts.

## Preset

CLI composition recipe expanded into explicit framework/plugin/provider/theme choices.

## Provider

K-Nex plugin implementing a genuinely replaceable infrastructure/runtime capability such as realtime, object storage, email, queue, or maps.

The Payload database adapter is not a K-Nex provider.

## Public data source

Explicitly anonymous/signed-session-safe source with narrow projection, rate limits, privacy/abuse policy, and public caching rules. Internal workspace sources are never public merely because a public block supports the same output contract.

## Publish

Activate a validated draft revision for a CMS page, workspace layout, or theme profile. Permission-protected and audited.

## Purge

Explicit destructive removal of plugin-owned data/schema/references after dependency, retention, backup, migration, and approval checks.

## Query key

Runtime identity for one source execution, generally including source ID/version, canonical validated input, selected stable field IDs, actor/access scope, and surface. Used for caching and invalidation.

## Record summary

Canonical compact-record result `record.summary@1`, used by cards, headers, related-record panels, and selection previews.

## Registered adapter

Trusted, versioned, schema-aware transformation node that converts one accepted contract into another using bounded declarative configuration.

Future example:

```text
adapter.table-fields-to-category-series@1
```

It is not arbitrary JavaScript, SQL, visual query code, or an unrestricted expression.

## Resolved application graph

Immutable result of validating requested plugins, replaceable capabilities/providers, Payload compatibility, conflicts, ordering, environment requirements, and contribution collisions.

## Runtime configuration

Validated customer database values controlling installed code without importing packages or changing schema composition.

## Runtime context

Registered typed read-only value supplied by application/session/router/editor, such as current branch, user, route parameter, locale, or preview mode.

## Scalar value

Discriminated semantic value used by canonical contracts, such as text, number, integer, decimal, boolean, date, datetime, money, percentage, duration, or resource reference.

Formatting is applied by runtime locale/design-system/theme rather than returned as a customer-formatted string.

## Semantic primitive

Style-agnostic UI contract expressing intent, such as `Button`, `Metric`, `DataTable`, or `Card`, implemented by a selected design/theme adapter.

## Source major version

Persisted major version of one source's inputs, stable field IDs, semantics, and declared output contract. Independent from contract major version and npm package version.

## Source-specific output schema

Exact result schema for one source. It narrows/specializes the declared contract and must pass contract conformance validation.

## State definition

Registered schema/policy for UI coordination state: ID/version, scope, default, persistence, surface, audience, and write rules.

## State instance

Page/workspace-specific state such as `page.filters.date-range`.

## Stream source

Source with authenticated initial snapshot plus typed incremental realtime messages and reconnect/resync behavior. Reserved for true live projections.

## Style-agnostic

Independent from customer brand/visual language. Structural/accessibility CSS required for function is allowed.

## Surface

Explicit context such as `workspace`, `cms`, `public`, `driver`, or `system`.

## Table records

Canonical tabular result `table.records@1`, containing stable row keys, optional resource references, values keyed by declared stable field IDs, and explicit pagination metadata.

## Theme package

Installed executable presentation code containing token schema, palettes, semantic primitive recipes/overrides, structural CSS, validation, and migrations.

## Theme profile

Versioned database record selecting an installed theme and adjustable validated values for a surface.

## Time series

Canonical time-indexed chart result `series.time@1`, containing timezone, interval, ordered timestamped points, and measure metadata.

## Transport envelope

Standard success wrapper around source data containing envelope schema version, source ID/version, output-contract ID/version, descriptor hash, and validated contract payload.

## UI action

Registered client-to-server operation whose server handler owns authorization, validation, transaction, rate limits, idempotency, and audit.

## UI block

Stable versioned component capability usable in builder documents. Declares surfaces, audience, props, ports, permissions, renderer, and migrations.

## UI contribution

Plugin-exported navigation, routes, screens, blocks, sources, output contracts, actions, state/context, slots, and migrations.

## UI runtime

Editor-independent layer resolving registries, permissions, contracts, bindings, layouts, themes, source/action clients, invalidation, and safe orphan behavior.

## UI state

Typed filter/selection/coordination value with explicit scope/persistence. Distinct from business records and source results.

## Uninstall

Remove plugin package/active registration while retaining data/references unless explicitly migrated or purged.

## Visualization plugin

Horizontal module providing generic Counter, Metric, chart, table, status, or map blocks that consume shared output contracts rather than domain query logic.

## Workspace

Authenticated staff surface containing modules, dashboards, reports, CMS management, and system settings.
