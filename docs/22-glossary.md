# Glossary

## Action

See **UI action**. A registered, schema-validated request to perform behavior. Builder documents reference stable action IDs; authoritative execution remains server-side.

## Application

One independently deployed customer product composed from K-Nex packages, customer code, configuration, themes, data, and infrastructure.

## Application manifest

`k-nex.app.json`, the declarative desired composition of a customer application. It lists plugins, providers, builder profiles, installed themes, database adapter/target selections, and project-generation options without secret values.

## Binding

A serializable, schema-validated connection among registered contexts, UI state, data sources, block input/output ports, and actions.

Examples:

```text
page state → data-source parameter
data-source result → chart input
chart-selection event → page state
button event → registered action
```

Bindings never contain arbitrary executable code, SQL, imports, or secrets.

## Binding graph

The resolved directed graph of state, context, data-source, block-port, and action nodes for one UI document. The runtime validates ownership, versions, schemas, surface/audience compatibility, permissions, required inputs, and cycles before execution/publication.

## Build manifest

A generated machine-readable inventory of the resolved application, including exact core/plugin versions, capability providers, database/provider composition, UI/data/state/theme inventory, and migration/release metadata. It is not edited manually.

## Builder

A plugin that adapts a visual editing engine to K-Nex block, layout, binding, profile, validation, and publication contracts. The initial candidate is `builder.puck`.

## Builder profile

A policy for using the builder engine on a specific surface. CMS and workspace profiles can use the same engine while exposing different palettes, audiences, data sources, state/context, actions, layout scopes, and publication workflows.

## Capability

A versioned contract provided by a plugin and consumed by another plugin, such as `database.primary`, `database.transactions`, `realtime.gateway`, `storage.objects`, or `builder.engine`. Capabilities allow provider substitution without changing consumer code.

## Catalog

The trusted list of selectable K-Nex plugins and metadata presented by the CLI. V1 catalogs only first-party or explicitly reviewed private packages.

## Composition root

The customer application location where generated registries, declarative manifest, customer TypeScript config, and final framework configuration are combined into the runnable product.

## Context

See **Runtime context**. A registered read-only value supplied by the application runtime, such as current user, branch, locale, route parameter, or CMS preview mode.

## Customer application

See **Application**. Each customer application has a separate repository, database, deployment, storage, secrets, migrations, and release cadence.

## Customer extension

Executable code in a customer repository that implements a genuine customer-specific policy, integration, action, data source, state definition, UI block, or override through documented K-Nex/module extension points.

## Customer shell

The generated repository/application scaffold that owns customer presentation, composition, extensions, migrations, and infrastructure. It consumes core and plugins as packages rather than copying their source.

## Data contract

A stable, versioned schema describing a reusable data shape consumed by UI blocks or produced by data sources.

Examples:

```text
metric.scalar@1
dataset.tabular@1
dataset.category-series@1
dataset.time-series@1
geo.feature-collection@1
```

Generic components depend on data contracts rather than domain plugin implementations.

## Database adapter plugin

A provider plugin that integrates one database family/dialect with K-Nex and the selected framework. It owns runtime adapter composition, capability claims, migration integration, health checks, and adapter contract tests.

Initial example:

```text
provider.database-postgres
@k-nex/database-postgres
```

## Database target plugin

A provider/profile plugin describing how a database adapter connects to and operates in a particular environment, such as local Docker Postgres, an external URL, or Neon. It can contribute environment schema, infrastructure generation, pooling/TLS guidance, migration connection policy, and diagnostics without redefining the database dialect.

## Data-source definition

Executable plugin code registering a stable source ID, version, input/output schema, output contract, permission/audience policy, limits, cache/sensitivity policy, realtime behavior, and resolver.

## Data-source instance

Serializable layout configuration referencing a registered data-source definition with validated parameters, mappings, and bindings. It contains no resolver function or live result records.

## Data source

A registered, schema-validated, permission-aware, normally server-executed query/projection exposed to UI blocks. Stored layouts reference data-source IDs and bounded parameters rather than raw SQL, unrestricted URLs, or copied live data.

## Design-system adapter

The implementation of semantic UI primitives—such as `Button`, `Card`, `Table`, `Chart`, and `Dialog`—provided by the selected theme/design package and customer overrides.

## Disable

Keep a plugin installed and preserve its data while gating declared UI, writes, routes, schedules, subscribers, or other behavior. Disable semantics must be explicitly supported by the plugin.

## Domain event

A versioned, past-tense fact published after a successful state change, such as `logistics.shipment.delivered`. Events are owned by the module that owns the fact.

## Domain service

Authoritative backend behavior that enforces business rules, transactions, authorization context, and events. Payload hooks or HTTP handlers adapt requests into domain services rather than becoming the only location of business logic.

## Extension slot

A documented place where a module or shell allows another plugin/customer application to add or replace behavior or UI without patching private implementation.

## Field mapping

Validated configuration that maps named fields from a registered data-source output into semantic component inputs such as chart key, label, value, series, or timestamp. V1 field mapping does not execute arbitrary expressions.

## Generated registry

A deterministic TypeScript import/registration file produced by the CLI for plugins, providers, database adapters/targets, UI contributions, data sources, data contracts, state/context, actions, themes, and framework contributions. Generated registries contain static imports and are committed in V1.

## Input port

A typed dynamic input declared by a UI block, such as `data`, `dateRange`, `selectedBranch`, or `recordId`. A port declares which static/state/context/data contracts it accepts.

## Integration plugin

A reusable package that connects two or more capabilities/modules without forcing either module to import the other's private implementation.

## Layout

A versioned structured document describing which registered blocks appear in allowed regions, their validated static properties, and their declarative bindings. Layouts never contain arbitrary executable code or live data snapshots.

## Module

A plugin that provides reusable horizontal or domain business capability, such as CMS, CRM, visualization, dispatch, inventory, or QR menu.

## Operational screen

A module-owned workflow screen whose interaction and transaction behavior remain controlled, such as a dispatch board or stock adjustment form. It may have extension slots but is not fully rebuilt by drag-and-drop in V1.

## Orphan binding

A stored binding whose source, state, context, action, contract, or compatible port is unavailable, disabled, incompatible, or removed. Orphans are preserved and reported rather than silently deleted.

## Orphan block

A stored layout block whose providing plugin/component is unavailable, disabled, incompatible, or removed. Orphans are preserved and reported; they do not automatically delete data or crash the whole page.

## Output port

A typed event/value emitted by a UI block, such as `sliceSelected`, `rowSelected`, `filterChanged`, or `submitted`. It can be connected to an allowed state write or registered action.

## Package

A concrete versioned artifact installed from a package registry, such as `@k-nex/module-crm@1.4.2`. The package name/version is distinct from the stable plugin ID.

## Platform core

The smallest stable, domain-neutral backend layer that provides contracts, plugin/capability resolution, service/permission/event/job registries, audit/health foundations, framework/provider composition, and testing support.

## Plugin

The umbrella installable K-Nex concept. Kinds include module, provider, builder, theme, integration, and preset.

## Plugin ID

The stable product identity of a plugin, such as `module.crm`, `provider.database-postgres`, or `theme.neobrutalism`, independent of package repository or package-manager location.

## Preset

A CLI composition recipe such as logistics or restaurant. It expands into explicit plugin/provider/theme selections and does not hide the final customer composition.

## Provider

A plugin that implements an infrastructure/runtime capability, such as a Postgres database adapter, Neon connection target, WebSocket realtime gateway, S3 storage, or email delivery.

## Publish

Make a validated draft revision active for its intended scope, such as a CMS page, customer/role workspace layout, or theme profile. Publication is permission-protected and audited.

## Purge

Explicit destructive removal of plugin-owned data/schema/references after dependency, retention, backup, migration, and approval checks. Uninstall does not imply purge.

## Resolved application graph

The immutable result of validating requested plugins, capabilities, providers, compatibility, conflicts, ordering, environment requirements, and contribution collisions.

## Resource selector

A permission-aware configuration-time source used by builder fields to choose a stable domain resource ID, such as a CRM pipeline, restaurant branch, warehouse, fleet, or cost center.

## Runtime configuration

Validated customer database values controlling an already installed plugin without importing new code or changing schema composition, such as active theme tokens, source defaults, or tracking retention.

## Runtime context

A registered, typed, read-only value supplied by the application/session/router/editor runtime, such as `context.current-branch`, `context.current-user.locale`, or `context.cms.preview-mode`.

## Semantic primitive

A style-agnostic UI contract expressing intent, such as `Button`, `Heading`, `Metric`, `Chart`, or `DataGrid`, which a selected design-system/theme adapter implements visually.

## Specialized store

A provider-backed store used for a narrow workload—such as Redis current positions, PostGIS geospatial history, search, analytics, or object storage—without becoming another `database.primary` provider.

## State definition

A registered schema and policy for one UI state type, including stable ID/version, allowed scopes, default, persistence, surfaces, audience, and read/write rules.

## State instance

A layout/workspace-specific instance of a state definition, such as `page.date-range`, with an optional validated default and persistence override allowed by policy.

## Style-agnostic

Independent of customer brand and visual language. It does not mean literally zero CSS; components may contain structural/accessibility styling required to function.

## Surface

An explicit user-facing context such as `workspace`, `cms`, `public`, `driver`, or `system`. Blocks, screens, actions, data sources, state/context, and bindings declare allowed surfaces/audiences.

## Theme package

Installed executable code containing token schema, palettes, semantic primitive implementations, component variants, structural CSS, validation, and migrations.

## Theme profile

Versioned customer database data selecting an installed theme and its validated adjustable token values for a surface. Theme profiles have draft/published revisions.

## UI action

A registered client-to-server operation referenced by a block. The server handler owns authorization, input validation, business transaction, rate limits, idempotency, and audit behavior.

## UI block

A stable, versioned, registered component capability that can appear in builder/layout documents. It declares surfaces, audience, static fields, input/output ports, permissions, renderer, and migrations.

## UI contribution

The navigation, routes, screens, blocks, data sources, state/context definitions, actions, slots, and migrations exported by a plugin for the K-Nex UI registry.

## UI runtime

The editor-engine-independent layer that resolves enabled UI/data/state/action registries, permissions, binding graphs, layouts, themes, orphan behavior, source/action clients, and runtime rendering.

## UI state

A typed coordination value with an explicit scope and persistence policy. It is distinct from database records, data-source results, and an unrestricted mutable global store.

## Uninstall

Remove a plugin package and active registration while normally retaining data and stored references until a separate explicit migration or purge process.

## Visualization plugin

A horizontal module that provides generic style-agnostic metric, chart, table, progress, status, or map blocks. It consumes shared data contracts and does not own domain query logic.

## Workspace

The authenticated staff application surface containing modules such as CRM, dispatch, inventory, CMS management, dashboards, reports, and system settings.