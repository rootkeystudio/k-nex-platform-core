# Module System

## Purpose

A K-Nex module is a plugin that implements reusable horizontal or domain application behavior. It can contribute Payload schema, domain services, permissions, settings, events, jobs, authenticated sources, actions, agent tools, routes, navigation, default pages, style-agnostic components, and Puck blocks.

## Foundation-program reference module

The only first-party domain module used to shape the pre-v1 plugin contract is:

```text
module.sales
```

Sales is the executable reference for the complete plugin authoring surface. Logistics, restaurant, inventory, budgeting, dispatch, driver, live-tracking, QR-menu, and other domain modules remain deferred blueprints until Gate 8.

See [Plugin Platform Hardening and the Sales Reference Module](./33-plugin-platform-hardening-and-reference-sales.md).

## Package entrypoints

```text
./manifest    side-effect-free k-nex.plugin.json
./contracts   IDs, schemas, DTOs, events, tokens, settings, descriptors
./server      domain/application/Payload handlers and policies
./browser     typed query/action clients and browser-safe hooks
./ui          K-Nex component compositions and block renderers
./migrations  deterministic helpers and readiness
./testing     fixtures and standard conformance suite
```

Server dependencies must not leak into contracts/browser/UI entrypoints. Third-party component/query/editor/protocol types remain behind K-Nex adapters.

`module.sales` is the executable package skeleton. Server registration uses `definePluginRegistration` from `@k-nex/runtime`; each phase receives only its registration operations and a capability reader that rejects services absent from the manifest-derived dependency grant. The package exports exactly the seven entrypoints above and exposes no root convenience entrypoint.

## Canonical manifest

Do not copy a new manifest shape into prose. Use:

```text
schemas/plugin-manifest.v1.schema.json
canonical plugin fixtures
```

The manifest and generated contribution inventory cover the supported categories:

```text
schema
migrations
services
permissions
settings
sources
actions
tools
events
jobs
realtime topics
components
blocks
routes
navigation
page templates
localization
health/audit
lifecycle
testing metadata
```

A module may omit optional categories. It cannot bind a contribution it did not declare or declare a required contribution without binding it.

## Dependency semantics

- **Direct plugin:** required domain model/contract.
- **Capability:** interchangeable implementation such as `realtime.gateway`.
- **Optional:** activates only when the package is explicitly installed and compatible; it never auto-installs.
- **Integration plugin:** owns substantial collaboration between independent modules.
- **Conflict/cycle:** fails resolution with an explainable path.

A single-cardinality capability with multiple candidates requires explicit selection.

## Registration

A module exports separate declarations and bindings rather than one unrestricted mutable `register()` operation.

```text
manifest       static package metadata
contracts      permissions/events/settings/source/action/tool/UI descriptors
schema         owned Payload schema contributions
behavior       services/commands/policies/endpoints/subscribers
jobs           task/workflow bindings
data-handlers  source/action/tool handlers
ui             browser clients/components/blocks/routes/navigation/pages
admin          Payload/system UI
validate       declared-versus-actual reconciliation
freeze         immutable runtime inventory
```

Composition compares actual inventory with the manifest and freezes after validation.

## Domain/application boundary

```text
domain        entities, value objects, invariants, facts
application   commands, queries, workflows, authorization orchestration
persistence   Payload/repository projections and transaction context
adapters      endpoints, hooks, jobs, sources, actions, UI
```

Not every module needs heavy DDD ceremony, but authoritative multi-step behavior must be testable outside HTTP/hooks.

## Data sources and actions

A source/action descriptor lives in contracts. Its executable handler lives in server code.

```text
sales.tasks descriptor
  → source ID/version, input/output, fields,
    permission, surface, limits, cache/realtime policy

sales.tasks handler
  → authenticated req.payload/domain query,
    record/field policy, permitted projection

sales.task.create descriptor
  → action ID/version, input/output, effect/idempotency policy

sales.task.create handler
  → application command and transaction
```

No module automatically exposes all collections.

## Browser query/action factories

Plugin UI uses platform factories over the standard gateways:

```text
source query definition
  → stable source identity, typed input/output, defaults,
    cancellation, result states, cache/invalidation identity

action mutation definition
  → stable action identity, typed input/output,
    idempotency, problem mapping, invalidation
```

A module does not introduce its own network/cache/form/table infrastructure where K-Nex provides one. Query-library types are implementation-local and are not persisted.

## UI and components

Modules import K-Nex semantic primitives, compound components, page templates, and UI contracts. They do not import customer themes or builder-engine types.

The comprehensive component direction is defined in [Headless Component System and Data Experience](./34-headless-component-system.md).

A UI contribution separates:

```text
canonical component/block descriptor
strict props schema
browser renderer
source/action binding policy
surface/audience/permission
loading/empty/error/forbidden states
Puck field/bridge metadata
```

The component renders outside Puck. Puck is only an authoring bridge.

`PluginUiContributionDescriptorSchema` is the serializable component/block authority: canonical props JSON Schema, source/action policy, surface/audience/permission, and all required fallback states. `defineUiContributionBinding` pairs it with one executable props validator and production renderer. Registration requires a descriptor plus renderer binding for both component and block inventories. `reconcilePuckBlockContribution` accepts only that same canonical block definition, so editor fields/defaults cannot replace renderer or persisted authority.

## Routes and navigation

Modules contribute route IDs with typed parameters, surface/audience, permission, and page/view references. Navigation items reference route IDs rather than unrestricted URLs.

`PluginRouteDescriptorSchema` and `PluginNavigationDescriptorSchema` validate source declarations. `resolvePluginNavigation` resolves installed targets, typed parameters, parent visibility, authentication, and both route and item permission before producing an href.

The fixed application shell owns authentication, global routing, breadcrumbs, error boundaries, and system navigation.

## Default page templates

A module may provide source-controlled immutable templates:

```text
template ID/version
owner plugin
route/surface/profile
canonical UiDocument
required sources/actions/blocks/capabilities
permission/publication policy
migration metadata
```

Installation may instantiate a template idempotently. The resulting page is customer-owned and mutable. Package upgrades never overwrite customer edits; a newer template is offered through an explicit compare/adopt operation.

`PluginPageTemplateDescriptorSchema` binds an immutable template version to its canonical `UiDocument`, typed route, profile, permission, publication policy, and exact capability/source/action/block requirements. `instantiatePluginPageTemplate` performs fail-closed preflight and atomic create-if-absent. Later versions use `comparePluginPageTemplate` and `adoptPluginPageTemplate`; adoption requires an explicit migration and optimistic customer revision, and writes only after the migrated document validates.

Sales reference pages:

```text
sales.page.overview
sales.page.tasks
sales.page.opportunities
sales.page.settings
```

## Runtime settings

Settings are plugin-owned, strict, schema-versioned records. They may configure installed behavior but cannot install packages, add schema, create executable contributions, store secret values, change required topology, or weaken authorization.

Authors declare `PluginSettingsDescriptorSchema` metadata and a strict runtime schema. `resolvePluginSettings` applies sequential version migrations, defaults, validation, and immutable output; secret-bearing fields accept only `SecretReferenceSchema` references.

## Agent tools

A module may explicitly project selected registered sources/actions as tools. Tool discovery and invocation remain actor/delegation filtered, reauthorized, budgeted, approval-aware, idempotent where required, and audited.

Raw Payload collection exposure and module-owned ambient MCP handlers are prohibited.

Browser entrypoints declare data behavior with `defineSourceQuery` and `defineActionMutation`. These immutable, query-library-neutral definitions validate input/output, use only the injected platform transport, forward cancellation, expose standard result states, derive authorization-safe stable query identities, and declare source invalidation. `serializeBrowserViewState` provides bounded canonical URL-safe state and rejects actor or authorization record scope.

## Events, jobs, and realtime

Modules classify event semantics explicitly:

```text
ephemeral hint
reconstructible invalidation
durable integration
durable workflow
```

Durable classes use the transactional outbox. Realtime topics are typed, authorized hints followed by authoritative refetch. Jobs declare retry/idempotency/timeout/concurrency behavior.

## Lifecycle

For schema-owning V1 modules:

```text
install/enable
configure
operate
disable
re-enable
reviewed package upgrade
explicit archive/export
explicit purge migration
backup/restore evidence
```

Removing the package while promising retained schema readability is not a generic V1 operation.

## Sales reference completeness

Before another domain module begins, Sales must exercise:

```text
Payload schema and customer migration
permissions and settings
sources, actions, tools
events, job, outbox, realtime topic
browser query/action factories
components and Puck blocks
routes, navigation, default pages
install/disable/re-enable/upgrade
observability and audit
localization and documentation
```

The business scope may remain small. Completeness means platform-surface coverage, not full CRM parity.

## Required plugin conformance suite

Planned canonical command:

```text
pnpm plugin:check modules/sales
```

It must cover:

- manifest schema, canonical IDs, package integrity, exact tuple;
- declared-versus-actual contribution reconciliation;
- fresh install and previous-version migration;
- settings, permission, record, and field attacks;
- source/action/tool validation and budgets;
- event/job durability and idempotency according to class;
- realtime authorization and convergence;
- browser query/action behavior;
- component runtime and Puck round-trip parity;
- default-page seed idempotency and customer-edit preservation;
- client/server/editor bundle boundaries;
- theme and accessibility matrix where UI exists;
- disable/re-enable, upgrade, purge readiness, reference scan, backup/restore;
- packed-package export/type/reproducibility checks.

A new module starts from the Sales package layout and passes the same suite. It does not add a new platform mechanism without an explicit architecture decision.
