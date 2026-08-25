# Module System

## Purpose

A K-Nex **module** is a plugin kind that implements reusable horizontal or domain application capability.

Examples:

```text
module.cms
module.crm
module.forms
module.logistics-core
module.logistics-dispatch
module.logistics-driver
module.logistics-live-tracking
module.restaurant-core
module.restaurant-qr-menu
module.restaurant-inventory
module.budgeting
```

A module is not merely a Payload plugin. It participates in the wider K-Nex plugin system with static metadata, dependencies, versioned capabilities, lifecycle semantics, permissions, events, jobs, UI contributions, migration helpers, and operations diagnostics.

The common plugin taxonomy, provider model, catalog, and capability resolution rules are defined in [Plugin Taxonomy and Capabilities](./13-plugin-taxonomy-and-capabilities.md). This document focuses on module authoring and boundaries.

## Module responsibilities

A full module may provide:

### Backend

- Payload collections, globals, fields, indexes, endpoints, access adapters, and internal plugins;
- domain entities, services, commands, queries, and invariants;
- permission definitions and record-level access policies;
- domain events and subscribers;
- jobs, workflows, and schedules;
- health/readiness checks;
- integration/extension points;
- runtime configuration schema;
- data migration helpers and readiness validators.

### Client contracts

- stable DTOs and schemas;
- typed API/action client;
- event/message types;
- mobile/browser-safe validation and IDs;
- capability/service interfaces intended for other plugins.

### UI

- navigation contributions;
- fixed operational screens;
- style-agnostic blocks;
- headless controllers/hooks;
- registered data sources and actions;
- realtime binding metadata;
- extension slots;
- component/layout migrations.

A backend-only module can omit UI/client exports.

## Module package shape

```text
module-crm/
├── k-nex.plugin.json
├── package.json
├── src/
│   ├── contracts/
│   ├── server/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── persistence/
│   │   ├── payload/
│   │   ├── permissions/
│   │   ├── events/
│   │   └── jobs/
│   ├── client/
│   ├── ui/
│   │   ├── blocks/
│   │   ├── screens/
│   │   ├── data-sources/
│   │   ├── actions/
│   │   └── contribution.ts
│   ├── migrations/
│   └── testing/
└── tests/
```

Recommended exports:

```json
{
  "exports": {
    "./manifest": "./k-nex.plugin.json",
    "./server": "./dist/server/index.js",
    "./contracts": "./dist/contracts/index.js",
    "./client": "./dist/client/index.js",
    "./ui": "./dist/ui/index.js",
    "./migrations": "./dist/migrations/index.js",
    "./testing": "./dist/testing/index.js"
  }
}
```

Server-only dependencies must not leak into browser/client bundles.

## Static module manifest

Example:

```json
{
  "$schema": "https://schemas.k-nex.dev/plugin/v1.json",
  "apiVersion": 1,
  "id": "module.logistics-driver",
  "kind": "module",
  "displayName": "Driver Operations",
  "version": "1.3.0",
  "package": "@k-nex/module-driver",
  "compatibility": {
    "core": ">=1.4.0 <2.0.0",
    "payload": ">=3.0.0 <4.0.0",
    "node": ">=22.0.0",
    "databases": ["postgres"]
  },
  "provides": [
    {
      "capability": "logistics.driver",
      "version": "1.1.0"
    }
  ],
  "requires": [
    {
      "plugin": "module.logistics-core",
      "version": "^1.8.0",
      "reason": "Driver tasks use logistics domain records and assignment contracts."
    },
    {
      "capability": "realtime.gateway",
      "version": "^1.0.0",
      "reason": "Driver task updates require realtime delivery."
    }
  ],
  "optional": [
    {
      "plugin": "module.logistics-dispatch",
      "version": "^1.5.0"
    },
    {
      "capability": "notifications.sender",
      "version": "^1.0.0"
    }
  ],
  "surfaces": ["workspace", "driver"],
  "data": {
    "ownsPersistentData": true,
    "supportsDisable": true,
    "supportsUninstallPreservingData": true,
    "supportsPurge": true
  }
}
```

The manifest is side-effect-free. Executable registration code is imported only after graph resolution.

## Dependency semantics

### Direct module dependency

Use when the module genuinely requires another domain model/contract.

```text
module.logistics-driver requires module.logistics-core
module.restaurant-recipe-costing requires module.restaurant-inventory
```

### Capability dependency

Use when any compatible provider/implementation can satisfy the contract.

```text
module.logistics-driver requires realtime.gateway
module.cms requires storage.objects
module.notifications requires notifications.channel (multiple providers allowed)
```

### Optional dependency

Activates a documented integration only when present. Optional behavior cannot read private tables or import private source.

When optional collaboration is substantial, create an integration plugin:

```text
module.crm
module.logistics-core
integration.crm-logistics
```

### Conflict

Reject combinations that cannot coexist or violate single-provider cardinality.

### Cycle

Required dependency cycles are errors. Extract a shared lower-level contract or integration package.

## Module registration contract

Draft executable contract:

```ts
export interface KNeXModule<TOptions = unknown> {
  manifest: ResolvedModuleManifest
  options: TOptions

  register(context: ModuleRegistrationContext):
    | void
    | Promise<void>
}
```

Registration context exposes phase-specific APIs rather than one unrestricted mutable object:

```ts
interface ModuleRegistrationContext {
  contracts: ContractRegistrationApi
  providers: ServiceRegistrationApi
  schema: PayloadSchemaContributionApi
  behavior: BehaviorRegistrationApi
  jobs: JobRegistrationApi
  ui: UiContributionRegistrationApi
  admin: AdminContributionRegistrationApi
  diagnostics: DiagnosticsApi
}
```

A module cannot register contributions outside the active phase or introduce undeclared required dependencies.

## Registration phases

```text
1. contracts
   permissions, events, capabilities, service tokens,
   action/data-source/block schemas

2. providers
   module-owned service implementations

3. schema
   collections, globals, fields, indexes

4. behavior
   commands, queries, endpoints, policies, subscribers

5. jobs
   tasks, workflows, schedules

6. ui
   navigation, screens, blocks, data sources, actions, slots

7. admin
   Payload/system settings contributions

8. finalize
   collisions, immutable inventory, readiness
```

Dependency edges and explicit contribution ordering make output deterministic. Modules must not rely on import array accidents.

## Payload contribution boundary

K-Nex modules can contribute Payload behavior through explicit categories:

```ts
export interface PayloadModuleContribution {
  collections?: OwnedContribution<CollectionConfig>[]
  globals?: OwnedContribution<GlobalConfig>[]
  endpoints?: OwnedContribution<Endpoint>[]
  plugins?: OwnedContribution<Plugin>[]
  jobs?: PayloadJobsContribution
  admin?: PayloadAdminContribution
}
```

The K-Nex adapter:

- preserves contribution ownership;
- detects duplicate collection/global slugs and endpoint routes;
- composes known function fields deliberately;
- rejects ambiguous/unmergeable contributions;
- produces diagnostic inventory;
- avoids a universal unsafe deep merge.

Business behavior should reside in domain/application services. Payload hooks adapt persistence lifecycle into those services, record events, or enqueue jobs.

## Domain design

A module owns explicit domain language and invariants.

Example module layers:

```text
domain
  entities/value objects/invariants/events

application
  commands/queries/workflows/authorization orchestration

persistence
  repositories/projections/transactions

adapters
  Payload collections/hooks/endpoints/jobs/UI actions
```

Not every module needs formal DDD ceremony, but business transactions should be testable outside HTTP/Payload hook plumbing.

## Commands, queries, and events

### Command

Requests behavior and may fail:

```text
AssignShipment
ConsumeInventory
PublishPage
ApproveBudget
```

### Query

Returns an authorized projection:

```text
ListContacts
GetDispatchBoard
GetCurrentStock
GetPublicTrackingProjection
```

### Event

Past-tense fact after successful transaction:

```text
logistics.assignment.created
inventory.movement.recorded
cms.page.published
budget.approved
```

Module event contracts are versioned and owned by the module. Subscribers must be retry/idempotency aware where durable effects occur.

## Permissions

Modules register actions/capability permissions, not roles:

```text
crm.contacts.read
crm.contacts.write
logistics.shipments.assign
restaurant.inventory.adjust
budget.approve
```

Customer applications compose role names from these keys.

Record-level access remains domain-owned and may consider branch, team, ownership, assignment, state, or public-session scope.

The same access service should support API, Payload admin/access, UI data/action, jobs, and realtime subscriptions.

## UI contribution boundary

Module UI uses K-Nex contracts, not Puck or customer theme APIs directly.

```ts
export const crmUi = defineUiContribution({
  pluginId: 'module.crm',
  navigation: [contactsNav, pipelineNav],
  screens: [contactsScreen, pipelineScreen],
  blocks: [pipelineSummaryBlock, contactTableBlock],
  dataSources: [contactsDataSource, pipelineSummaryDataSource],
  actions: [createContactAction, moveOpportunityAction],
})
```

UI rules:

- components are style-agnostic;
- server logic/secrets never enter the UI bundle;
- actions/data sources enforce server authorization;
- blocks declare surfaces/audiences/permissions/versions;
- customer themes implement semantic primitives;
- customer code can use documented override slots;
- domain module public APIs do not expose builder-engine types.

## Module configuration

Configuration expresses legitimate product variation, never customer identity.

Good:

```ts
dispatchModule({
  assignmentMode: 'manual',
  allowMultiVehicleRoutes: true,
  enforceVehicleCapacity: true,
})
```

Bad:

```ts
dispatchModule({
  isAcmeCargo: true,
})
```

Configuration categories:

### Build-time options

Affect schema, route/import, provider, UI registry, or infrastructure and live in `k-nex.app.json`.

### Runtime settings

Validated database values that do not change executable composition.

Every option schema documents default, scope, migration behavior, and whether change requires rebuild/restart.

## Runtime settings

A module can register typed settings:

```ts
export const crmRuntimeSettings = defineRuntimeSettings({
  id: 'module.crm.settings',
  schema: z.object({
    defaultCurrency: z.string().length(3),
    duplicateDetection: z.boolean(),
  }),
  defaults: {
    defaultCurrency: 'TRY',
    duplicateDetection: true,
  },
})
```

Avoid one untyped global JSON dump. Settings ownership and schema/version must remain visible.

## Module enablement and lifecycle

States remain distinct:

```text
installed and enabled
installed and disabled
uninstalled with data retained
purged
```

A module declares whether it supports disable/uninstall retention and which contributions remain active.

No module executes destructive uninstall behavior automatically. See [Plugin Lifecycle](./19-plugin-lifecycle-and-package-management.md).

## Data and migrations

A module release provides:

- schema changes;
- compatibility metadata;
- migration notes;
- data readiness checks;
- reusable deterministic migration helpers;
- fixtures from previous versions;
- destructive/rollback warnings.

The customer repository owns final migration artifacts and ordering.

## Versioning

### Package version

Semantic version of the shipped module artifact.

### Plugin/module contract version

Describes the module's public lifecycle/registration schema where needed.

### Capability versions

Version individual contracts exposed to other plugins.

### Event/action/data/block versions

Persisted or externally consumed schemas evolve explicitly.

Customer applications pin exact package versions. Modules declare compatible ranges for core, Payload, Node, database, and required capabilities/plugins.

## Trust and security

A module package executes as trusted application code. V1 accepts only first-party/reviewed packages.

Even trusted modules must follow:

- no dynamic package imports from runtime values;
- no secret values in manifests/events/builder documents;
- input/output schema validation;
- server authorization;
- public projection boundaries;
- collision ownership diagnostics;
- supply-chain/release scanning;
- audit policy for high-risk actions.

## Module testing contract

Every production module should run:

```text
static manifest/schema validation
supported core/framework/database compatibility tests
fresh install database boot
upgrade migration fixtures
permission and record-policy tests
event/job idempotency tests
UI contribution collision and permission tests
theme primitive compatibility tests when UI exists
client/server export boundary tests
module disable/re-enable behavior
uninstall/purge readiness checks
```

The platform testing package should provide a standard contract suite.

## Suggested initial modules

```text
module.cms
module.crm
module.forms
module.logistics-core
module.logistics-dispatch
module.logistics-driver
module.logistics-live-tracking
module.restaurant-core
module.restaurant-qr-menu
module.restaurant-inventory
module.budgeting
```

Foundational UI, builder, theme, realtime, database, storage, and CLI packages are plugins/packages but not necessarily modules.

## First implementation scope

The first POC should implement thin modules only to prove:

- static manifest and dependency/capability resolution;
- deterministic Payload contribution composition;
- service/permission/event/job contracts;
- one module UI navigation/block/data/action contribution;
- fixed shell and builder registry integration;
- two themes rendering shared blocks;
- customer-specific migration/deployment.

Do not begin by fully implementing every CRM, logistics, inventory, or budgeting feature before the module platform works.
