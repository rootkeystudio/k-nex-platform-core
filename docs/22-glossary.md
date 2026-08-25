# Glossary

## Application

One independently deployed customer product composed from K-Nex packages, customer code, configuration, themes, data, and infrastructure.

## Application manifest

`k-nex.app.json`, the declarative desired composition of a customer application. It lists plugins, providers, builder profiles, installed themes, and project-generation options without secret values.

## Build manifest

A generated machine-readable inventory of the resolved application, including exact core/plugin versions, capability providers, UI/theme inventory, and migration/release metadata. It is not edited manually.

## Builder

A plugin that adapts a visual editing engine to K-Nex block, layout, profile, validation, and publication contracts. The initial candidate is `builder.puck`.

## Builder profile

A policy for using the builder engine on a specific type of surface. CMS and workspace profiles can use the same engine while exposing different palettes, audiences, data sources, actions, layout scopes, and publication workflows.

## Capability

A versioned contract provided by a plugin and consumed by another plugin, such as `realtime.gateway`, `storage.objects`, or `builder.engine`. Capabilities allow provider substitution without changing consumer code.

## Catalog

The trusted list of selectable K-Nex plugins and metadata presented by the CLI. V1 catalogs only first-party or explicitly reviewed private packages.

## Composition root

The customer application location where the generated registries, declarative manifest, customer TypeScript config, and final framework configuration are combined into the runnable product.

## Customer application

See **Application**. Each customer application has a separate repository, database, deployment, storage, secrets, migrations, and release cadence.

## Customer extension

Executable code in a customer repository that implements a genuine customer-specific policy, integration, action, UI block, or override through documented K-Nex/module extension points.

## Customer shell

The generated repository/application scaffold that owns customer presentation, composition, extensions, migrations, and infrastructure. It consumes core and modules as packages rather than copying their source.

## Data source

A registered, schema-validated, permission-aware server query exposed to UI blocks. Stored layouts reference data-source IDs and bounded parameters rather than raw SQL, unrestricted URLs, or copied live data.

## Design-system adapter

The implementation of semantic UI primitives—such as `Button`, `Card`, `Table`, and `Dialog`—provided by the selected theme/design package and customer overrides.

## Disable

Keep a plugin installed and preserve its data while gating declared UI, writes, routes, schedules, subscribers, or other behavior. Disable semantics must be explicitly supported by the plugin.

## Domain event

A versioned, past-tense fact published after a successful state change, such as `logistics.shipment.delivered`. Events are owned by the module that owns the fact.

## Domain service

Authoritative backend behavior that enforces business rules, transactions, authorization context, and events. Payload hooks or HTTP handlers adapt requests into domain services rather than becoming the only location of business logic.

## Extension slot

A documented place where a module or shell allows another plugin/customer application to add or replace behavior or UI without patching private implementation.

## Generated registry

A deterministic TypeScript import/registration file produced by the CLI for plugins, providers, UI contributions, themes, and framework contributions. Generated registries contain static imports and are committed in V1.

## Integration plugin

A reusable package that connects two or more capabilities/modules without forcing either module to import the other's private implementation.

## Layout

A versioned structured document describing which registered blocks appear in allowed regions and with which validated properties. Layouts never contain arbitrary executable code.

## Module

A plugin that provides reusable horizontal or domain business capability, such as CMS, CRM, dispatch, inventory, or QR menu.

## Operational screen

A module-owned workflow screen whose interaction and transaction behavior remain controlled, such as a dispatch board or stock adjustment form. It may have extension slots but is not fully rebuilt by drag-and-drop in V1.

## Orphan block

A stored layout block whose providing plugin/component is unavailable, disabled, incompatible, or removed. Orphans are preserved and reported; they do not automatically delete data or crash the whole page.

## Package

A concrete versioned artifact installed from a package registry, such as `@k-nex/module-crm@1.4.2`. The package name/version is distinct from the stable plugin ID.

## Platform core

The smallest stable, domain-neutral backend layer that provides contracts, module resolution, service/permission/event/job registries, audit/health foundations, framework composition, and testing support.

## Plugin

The umbrella installable K-Nex concept. Kinds include module, provider, builder, theme, integration, and preset.

## Plugin ID

The stable product identity of a plugin, such as `module.crm` or `theme.neobrutalism`, independent of package repository or package-manager location.

## Preset

A CLI composition recipe such as logistics or restaurant. It expands into explicit plugin/provider/theme selections and does not hide the final customer composition.

## Provider

A plugin that implements an infrastructure capability, such as Postgres database, WebSocket realtime, S3 storage, or email delivery.

## Publish

Make a validated draft revision active for its intended scope, such as a CMS page, customer/role workspace layout, or theme profile. Publication is permission-protected and audited.

## Purge

Explicit destructive removal of plugin-owned data/schema after dependency, reference, retention, backup, migration, and approval checks. Uninstall does not imply purge.

## Resolved application graph

The immutable result of validating requested plugins, capabilities, providers, compatibility, conflicts, ordering, environment requirements, and contribution collisions.

## Runtime configuration

Validated customer database values controlling an already installed plugin without importing new code or changing schema composition, such as active theme tokens or tracking retention.

## Semantic primitive

A style-agnostic UI contract expressing intent, such as `Button`, `Heading`, `Metric`, or `DataGrid`, which a selected design-system/theme adapter implements visually.

## Style-agnostic

Independent of customer brand and visual language. It does not mean literally zero CSS; components may contain structural/accessibility styling required to function.

## Surface

An explicit user-facing context such as `workspace`, `cms`, `public`, `driver`, or `system`. Blocks/screens/actions/data sources declare allowed surfaces and audiences.

## Theme package

Installed executable code containing token schema, palettes, semantic primitive implementations, component variants, structural CSS, validation, and migrations.

## Theme profile

Versioned customer database data selecting an installed theme and its validated adjustable token values for a surface. Theme profiles have draft/published revisions.

## Uninstall

Remove a plugin package and active registration while normally retaining data until a separate explicit purge process.

## UI action

A registered client-to-server operation referenced by a block. The server handler owns authorization, input validation, business transaction, rate limits, idempotency, and audit behavior.

## UI block

A stable, versioned, registered component capability that can appear in builder/layout documents. It declares surfaces, audience, fields, permissions, data/action bindings, renderer, and migrations.

## UI contribution

The navigation, routes, screens, blocks, data sources, actions, slots, and migrations exported by a plugin for the K-Nex UI registry.

## UI runtime

The engine-independent layer that resolves the enabled UI registry, permissions, layouts, data/actions, themes, orphan behavior, and runtime rendering.

## Workspace

The authenticated staff application surface containing modules such as CRM, dispatch, inventory, CMS management, dashboards, and system settings.
