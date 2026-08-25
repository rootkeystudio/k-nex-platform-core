# Module System

## Purpose

A K-Nex module is a plugin that implements reusable horizontal or domain application behavior. It can contribute Payload schema, domain services, permissions, events, jobs, authenticated sources, actions, fixed screens, and style-agnostic blocks.

Canonical examples:

```text
module.cms
module.sales
module.forms
module.visualization
module.logistics.core
module.logistics.dispatch
module.logistics.driver
module.logistics.live-tracking
module.restaurant.core
module.restaurant.qr-menu
module.inventory
module.budgeting
```

## Package entrypoints

```text
./manifest    side-effect-free k-nex.plugin.json
./contracts   IDs, schemas, DTOs, events, tokens
./server      domain/application/Payload handlers and policies
./browser     typed clients and browser-safe hooks
./ui          React renderers and semantic UI contributions
./migrations  deterministic helpers and readiness
./testing     fixtures and standard contract suite
```

Server dependencies must not leak into contracts/browser/UI entrypoints.

## Canonical manifest

Do not copy a new manifest shape into prose. Use:

```text
schemas/plugin-manifest.v1.schema.json
fixtures/plugin-manifests/module.logistics.driver.json
```

Key V1 properties:

```json
{
  "id": "module.logistics.driver",
  "kind": "module",
  "package": "@k-nex/module-logistics-driver",
  "compatibility": {
    "payloadDatabaseAdapters": ["postgres"]
  },
  "requires": [
    { "plugin": "module.logistics.core", "version": "^1.0.0" },
    { "capability": "realtime.gateway", "version": "^1.0.0" }
  ],
  "lifecycle": {
    "ownsPayloadSchema": true,
    "ownsPersistentData": true,
    "disable": "supported",
    "uninstall": "unsupported",
    "purge": "supported"
  }
}
```

The compatibility field describes tested Payload adapters; it is not a K-Nex persistence capability.

## Dependency semantics

- **Direct plugin:** required domain model/contract, for example Driver → Logistics Core.
- **Capability:** interchangeable implementation, for example Driver → `realtime.gateway`.
- **Optional:** activates only when the optional package is explicitly installed and compatible; it never auto-installs.
- **Integration plugin:** owns substantial collaboration between independent modules.
- **Conflict/cycle:** fails resolution with an explainable path.

A single-cardinality capability with multiple candidates requires explicit selection.

## Registration

A module exports separate declarations/bindings rather than one unrestricted mutable `register()` operation.

```text
manifest       static package metadata
contracts      permissions/events/schemas/source/action/block descriptors
schema         owned Payload schema contributions
behavior       services/commands/policies/endpoints/subscribers
jobs           task/workflow bindings
data-handlers  server handlers bound to declared source IDs
ui             browser clients/renderers/navigation/screens
admin          Payload/system UI
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

## Data sources

A source descriptor lives in contracts/UI metadata. Its executable handler lives in server code.

```text
sales.tasks descriptor
  → source ID/version, input, output contract, fields,
    permission, surface, limits, cache/realtime policy

sales.tasks handler
  → authenticated req.payload/domain query,
    record/field policy, permitted projection
```

No module automatically exposes all collections.

## UI

Modules import K-Nex semantic primitives and UI contracts, not customer themes or builder/engine types. Domain blocks can be shared across themes. Authority-bearing public and workspace blocks/sources/actions have separate IDs.

## Runtime settings

Settings are plugin-owned, schema-versioned, and stored in typed records/globals. They may change behavior only within installed code. Settings cannot dynamically import packages, add Payload schema, or change required process topology.

## Lifecycle

For schema-owning V1 modules:

```text
install/enable
configure
operate
disable
re-enable
explicit archive/export project
explicit purge migration
```

Removing the package while promising retained schema readability is not a V1 generic operation. A future plugin-specific experiment may introduce a compatibility package, but it must be evidenced and cannot silently expand the base lifecycle contract.

## Required module contract suite

- manifest schema and canonical ID checks;
- exact supported core/Payload/Node/Postgres tuple;
- fresh install and previous-version migration fixture;
- permission/record/field tests;
- source-specific and output-contract validation;
- event/job durability and idempotency according to class;
- declared-versus-actual contribution inventory;
- client/server bundle boundary;
- theme/semantic primitive compatibility when UI exists;
- disable/re-enable behavior;
- purge readiness and stored-reference scan;
- packed-package export/type checks.
