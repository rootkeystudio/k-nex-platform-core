# Glossary

## Action

See **UI action**. A registered, schema-validated request to perform behavior. Builder documents reference stable action IDs; authoritative execution remains server-side.

## Application

One independently deployed customer product composed from Payload, K-Nex packages, customer code, configuration, themes, data, and infrastructure.

## Application manifest

`k-nex.app.json`, the declarative desired composition of a customer application. It lists application identity, Payload framework/scaffold choices, K-Nex plugins/providers, builder profiles, themes, and local/deployment options without secret values.

## Binding

A serializable, schema-validated connection among registered runtime context, UI state, data sources, block ports, and actions.

Examples:

```text
page state → source parameter
data-source field → Counter value
data-source rows → DataTable
chart selection → page state
button event → registered action
```

Bindings never contain arbitrary executable code, Payload queries, SQL, imports, secrets, or unrestricted URLs.

## Binding graph

The resolved directed graph of context/state/source/block/action nodes for one UI document. The runtime validates ownership, versions, schemas, surfaces, permissions, required inputs, and cycles.

## Build manifest

Generated machine-readable inventory of exact Payload/K-Nex versions, selected Payload adapter, plugins/providers, UI/source/action/state/theme inventory, and release/migration metadata.

## Builder

A plugin adapting a visual editor to K-Nex block/layout/binding/profile/publication contracts. Initial candidate: `builder.puck`.

## Builder profile

Policy for using the builder on a surface. CMS and workspace profiles expose different palettes, audiences, sources, actions, state, themes, scopes, and publication workflows.

## Capability

A versioned contract provided/consumed by K-Nex plugins where implementation substitution matters, such as `realtime.gateway`, `storage.objects`, `email.delivery`, or `builder.engine`.

Payload's primary database adapter is not a K-Nex capability.

## Catalog

Trusted list of selectable K-Nex packages presented by the CLI. V1 contains first-party or explicitly reviewed private packages.

## Composition root

Customer application location where generated registries, manifest, customer TypeScript config, and final Payload configuration become the runnable product.

## Customer application

See **Application**. It has a separate repository, database, deployment, storage, secrets, migrations, and release cadence.

## Customer extension

Executable code in a customer repository implementing a real customer-specific policy, integration, source, action, block, or override through documented contracts.

## Customer shell

Generated customer repository/application scaffold. It owns composition, presentation, extensions, migrations, and infrastructure while consuming shared packages.

## Data contract

Stable versioned schema describing a reusable source result/component input.

Examples:

```text
metric.number@1
metric.money@1
table.records@1
series.category@1
series.time@1
geo.features@1
```

Generic components depend on data contracts, not domain implementations.

## Data source

A plugin-owned, registered, schema-validated, permission-aware server query/projection exposed to UI blocks.

Examples:

```text
sales.total-opportunities
sales.tasks
sales.opportunities-by-stage
```

Stored layouts reference source IDs, versions, parameters, and selected fields—not raw collection access, SQL, or live records.

## Data-source descriptor

Browser-safe/static metadata for a source:

```text
ID/version/owner
title/category
surfaces/audience
permission
input/output contract
fields
pagination/sort/filter rules
cache/realtime policy
```

## Data-source handler

Server-only plugin code implementing a source. It uses authenticated Payload request context and/or module domain services and returns a bounded projection.

## Data-source gateway

Recommended standard K-Nex transport that authenticates, validates, authorizes, observes, and dispatches source requests to plugin-owned handlers.

Conceptual route:

```text
POST /api/k-nex/data-sources/:sourceId/query
```

## Data-source instance

Serializable layout binding selecting one registered source with validated parameters, field selections, and mappings.

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

Source-declared information describing an output field:

```text
path/ID
label
type
selectability
default visibility
sort/filter capability
formatting
permission/sensitivity
```

Used by DataTable column pickers and generic visualizations.

## Field mapping

Validated mapping from declared source fields to semantic component inputs such as `label`, `value`, `series`, or `timestamp`. It executes no arbitrary expression.

## Generated registry

Deterministic static TypeScript import/registration file produced by the CLI for plugins, providers, Payload contributions, UI, sources, actions, state/context, themes, and builder adapters.

## Input port

Typed dynamic input declared by a block, such as `value`, `rows`, `data`, `dateRange`, or `recordId`.

## Invalidation

Realtime notification that one or more source query results may be stale. The client normally refetches the authenticated source endpoint.

## Integration plugin

Reusable package connecting modules/capabilities without forcing private implementation imports.

## Layout

Versioned structured document describing registered blocks, props, regions, and declarative bindings. It contains no arbitrary executable code or result snapshots.

## Module

Plugin providing reusable horizontal/domain behavior, such as CMS, Sales, Visualization, Dispatch, Inventory, or QR Menu.

## Operational screen

Module-owned workflow screen such as dispatch board or stock adjustment. It may expose extension slots but is not fully arbitrary drag-and-drop in V1.

## Orphan binding

Stored binding whose source/state/context/action/field/compatible port is unavailable or incompatible. Preserved and reported rather than silently deleted.

## Orphan block

Stored block whose plugin/component is unavailable or incompatible. It does not crash the whole page.

## Output port

Typed event/value emitted by a block, such as `rowSelected`, `sliceSelected`, or `filterChanged`.

## Package

Concrete versioned registry artifact such as `@k-nex/module-sales@1.4.2`. Distinct from stable plugin ID.

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

## Preset

CLI composition recipe expanded into explicit framework/plugin/provider/theme choices.

## Provider

K-Nex plugin implementing a genuinely replaceable infrastructure/runtime capability such as realtime, object storage, email, queue, or maps.

The Payload database adapter is not a K-Nex provider.

## Public data source

Explicitly anonymous/signed-session-safe source with narrow projection, rate limits, privacy/abuse policy, and public caching rules. Internal workspace sources are never public merely because a public block could technically bind to them.

## Publish

Activate a validated draft revision for a CMS page, workspace layout, or theme profile. Permission-protected and audited.

## Purge

Explicit destructive removal of plugin-owned data/schema/references after dependency, retention, backup, migration, and approval checks.

## Query key

Runtime identity for one source execution, generally including source ID/version, validated parameters, actor/access scope, and surface. Used for caching and invalidation.

## Resolved application graph

Immutable result of validating requested plugins, replaceable capabilities/providers, Payload compatibility, conflicts, ordering, environment requirements, and contribution collisions.

## Runtime configuration

Validated customer database values controlling installed code without importing packages or changing schema composition.

## Runtime context

Registered typed read-only value supplied by application/session/router/editor, such as current branch, user, route parameter, locale, or preview mode.

## Semantic primitive

Style-agnostic UI contract expressing intent, such as `Button`, `Metric`, `DataTable`, or `Card`, implemented by a selected design/theme adapter.

## Source field selection

Serializable list of declared fields chosen for a block, such as DataTable visible columns. It cannot select undeclared/private object paths.

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

## Theme package

Installed executable presentation code containing token schema, palettes, semantic primitive recipes/overrides, structural CSS, validation, and migrations.

## Theme profile

Versioned database record selecting an installed theme and adjustable validated values for a surface.

## UI action

Registered client-to-server operation whose server handler owns authorization, validation, transaction, rate limits, idempotency, and audit.

## UI block

Stable versioned component capability usable in builder documents. Declares surfaces, audience, props, ports, permissions, renderer, and migrations.

## UI contribution

Plugin-exported navigation, routes, screens, blocks, sources, actions, state/context, slots, and migrations.

## UI runtime

Editor-independent layer resolving registries, permissions, bindings, layouts, themes, source/action clients, invalidation, and safe orphan behavior.

## UI state

Typed filter/selection/coordination value with explicit scope/persistence. Distinct from business records and source results.

## Uninstall

Remove plugin package/active registration while retaining data/references unless explicitly migrated or purged.

## Visualization plugin

Horizontal module providing generic Counter, Metric, chart, table, status, or map blocks that consume shared source contracts rather than domain query logic.

## Workspace

Authenticated staff surface containing modules, dashboards, reports, CMS management, and system settings.
