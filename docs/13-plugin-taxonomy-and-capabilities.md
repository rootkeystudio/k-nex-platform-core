# Plugin Taxonomy and Capability Resolution

## Purpose

K-Nex uses **plugin** as the umbrella term for every installable, versioned package that participates in application composition. A plugin can add business behavior, provide infrastructure, supply a visual editor, install a theme, connect two capabilities, or expand a preset.

This common vocabulary allows the CLI, the application manifest, the dependency resolver, the generated runtime inventory, and the administration panel to describe the complete application with one model.

A plugin is not necessarily a Payload plugin. A K-Nex plugin may contribute one or more Payload plugins internally, but its K-Nex manifest also describes compatibility, dependencies, capabilities, surfaces, runtime requirements, migrations, and operational behavior.

## Plugin kinds

### Module

A module provides reusable business or horizontal application behavior.

Examples:

```text
module.cms
module.crm
module.forms
module.logistics-core
module.dispatch
module.driver
module.live-tracking
module.restaurant-core
module.qr-menu
module.inventory
module.budgeting
```

A module can contribute:

- Payload collections, globals, fields, indexes, endpoints, hooks, jobs, and access policies;
- domain services and commands;
- permissions;
- events and event subscribers;
- public or authenticated APIs;
- UI navigation, screens, blocks, actions, and data sources;
- migration helpers;
- health checks;
- typed server/client contracts.

### Provider

A provider implements an infrastructure capability behind a stable contract.

Examples:

```text
provider.database-postgres
provider.realtime-websocket-local
provider.realtime-websocket-redis
provider.storage-local
provider.storage-s3
provider.email-smtp
provider.maps-mapbox
provider.queue-payload
```

Business modules depend on capabilities rather than importing provider implementations. For example, the driver module requires `realtime.gateway`; it does not require one specific WebSocket package.

### Builder

A builder plugin adapts a visual editing engine to the K-Nex builder contract.

Initial example:

```text
builder.puck
```

The builder owns editor-engine integration, not business components or customer visual design. Domain modules export K-Nex UI block definitions. The builder adapter translates the resolved registry into the engine-specific configuration.

### Theme

A theme plugin contains executable presentation code and a validated design-token schema.

Examples:

```text
theme.minimal
theme.neobrutalism
theme.glassmorphism
theme.corporate
```

The package is installed at build time. Its selected palette and adjustable token values are runtime data stored in the customer database.

### Integration

An integration connects capabilities without forcing either side to know the other's private implementation.

Examples:

```text
integration.crm-logistics
integration.inventory-budgeting
integration.crm-mailchimp
integration.erp-acme-legacy
```

A reusable integration remains a package. A truly customer-specific integration begins in the customer repository as an extension.

### Preset

A preset is a named composition recipe used by the CLI. It is expanded before dependency resolution and does not create a special runtime layer.

Examples:

```text
preset.logistics
preset.restaurant
preset.corporate-cms-crm
```

A preset may select modules, providers, builder profiles, themes, development infrastructure, and recommended initial options. The generated application still lists the resulting plugins explicitly in its manifest so that the composition is inspectable and editable.

## Identity

Every plugin has three distinct identities:

1. **Plugin ID** — stable product identity, such as `module.driver`.
2. **Package name** — registry location, such as `@k-nex/module-driver`.
3. **Package version** — exact installed artifact, such as `1.3.0`.

The plugin ID must not change when a package moves between repositories or registries. A package must expose one primary plugin ID. A package containing several independently selectable plugins should normally be split.

IDs use lowercase dot-separated namespaces:

```text
module.crm
module.logistics.dispatch
provider.realtime.websocket-local
builder.puck
theme.neobrutalism
integration.crm-logistics
preset.logistics
```

Persisted data, builder documents, audit records, and release inventories refer to the stable plugin ID rather than a filesystem path.

## Static manifest

Dependency resolution must not execute arbitrary package runtime code. Every trusted plugin publishes side-effect-free metadata in a machine-readable manifest.

Suggested package declaration:

```json
{
  "name": "@k-nex/module-driver",
  "version": "1.3.0",
  "kNex": {
    "manifest": "./k-nex.plugin.json"
  },
  "exports": {
    "./manifest": "./k-nex.plugin.json",
    "./server": "./dist/server/index.js",
    "./contracts": "./dist/contracts/index.js",
    "./client": "./dist/client/index.js",
    "./ui": "./dist/ui/index.js"
  }
}
```

Example `k-nex.plugin.json`:

```json
{
  "$schema": "https://schemas.k-nex.dev/plugin/v1.json",
  "apiVersion": 1,
  "id": "module.logistics.driver",
  "kind": "module",
  "displayName": "Driver Operations",
  "version": "1.3.0",
  "package": "@k-nex/module-driver",
  "compatibility": {
    "core": ">=1.4.0 <2.0.0",
    "payload": ">=3.0.0 <4.0.0",
    "node": ">=22.0.0"
  },
  "provides": [
    {
      "capability": "logistics.driver",
      "version": "1.1.0"
    }
  ],
  "requires": [
    {
      "capability": "logistics.domain",
      "version": "^1.0.0",
      "reason": "Driver tasks reference shipments, routes, stops, and assignments."
    },
    {
      "capability": "realtime.gateway",
      "version": "^1.0.0",
      "reason": "Assignment and task updates are delivered in real time."
    }
  ],
  "optional": [
    {
      "capability": "logistics.dispatch",
      "version": "^1.0.0"
    },
    {
      "capability": "notifications.sender",
      "version": "^1.0.0"
    }
  ],
  "conflicts": [],
  "surfaces": ["workspace", "driver"],
  "environment": [
    {
      "name": "DRIVER_TOKEN_SIGNING_KEY",
      "secret": true,
      "requiredWhen": "enabled"
    }
  ],
  "data": {
    "ownsPersistentData": true,
    "supportsDisable": true,
    "supportsUninstallPreservingData": true,
    "supportsPurge": true
  }
}
```

The static manifest describes composition. Executable registration code is imported only after the graph has resolved and the package has passed trust and compatibility checks.

## Capabilities

A capability is a versioned contract supplied by one plugin and consumed by another.

Examples:

```text
cms.content
cms.visual-pages
crm.domain
logistics.domain
logistics.dispatch
logistics.driver
realtime.gateway
realtime.presence
notifications.sender
storage.objects
builder.engine
theme.runtime
ui.workspace
```

Capabilities solve two problems:

- a consumer does not depend on a concrete provider package;
- an implementation can be replaced without changing business module code.

Example providers:

```ts
// Local single-process implementation
provides: [
  capability('realtime.gateway', '1.0.0'),
]

// Redis-backed multi-instance implementation
provides: [
  capability('realtime.gateway', '1.0.0'),
  capability('realtime.distributed', '1.0.0'),
]
```

The driver module consumes the same `RealtimeGateway` service contract in either deployment.

### Capability versioning

Capability versions describe the public contract, not the package implementation version.

A package can release `2.4.1` while still providing `realtime.gateway@1.2.0`. A breaking service-contract change increments the capability major version and requires consumers to update their accepted ranges.

### Single and multiple providers

Capabilities declare cardinality in the contracts catalog:

```ts
export const realtimeGatewayCapability = defineCapability({
  id: 'realtime.gateway',
  cardinality: 'single',
})

export const notificationChannelCapability = defineCapability({
  id: 'notifications.channel',
  cardinality: 'multiple',
})
```

A single capability rejects multiple active providers unless an explicit selector chooses one. A multiple capability can aggregate several providers, such as email and push notification channels.

## Dependencies

### Required

The plugin cannot register or operate correctly without a matching plugin ID or capability provider. Missing or incompatible required dependencies stop `k-nex plan`, `k-nex generate`, CI, and application startup.

### Optional

The plugin works without the dependency but activates a documented integration when it is present. Optional behavior must use a stable public contract and must not import another package's private files.

### Conflict

A conflict identifies combinations that cannot safely coexist. Conflicts may reference a plugin ID, a capability, or a version range.

### Ordering

Dependency edges determine registration ordering. A module must not rely on incidental import order. Additional phase/order metadata is allowed only when there is no semantic dependency edge.

### Cycles

Required dependency cycles fail resolution. If two modules appear to require each other, extract a lower-level contract or create an integration plugin.

## Surfaces

Plugins declare the user-facing surfaces they may contribute to:

```text
workspace   authenticated staff application
cms         content-management editing surface
public      public website or public projection
driver      driver application
mobile      future native/mobile client contracts
system      system settings and operations
```

A surface declaration is not permission to expose data. Every screen, block, data source, and action still declares authorization and audience requirements.

## Package exports

Recommended exports for a full module:

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

Responsibilities:

- `manifest`: static composition metadata;
- `server`: registration and backend behavior;
- `contracts`: stable types, events, service tokens, DTOs;
- `client`: browser/mobile-safe typed client;
- `ui`: style-agnostic UI contributions and headless logic;
- `migrations`: reusable data helpers and readiness checks;
- `testing`: fixtures and module contract suite.

Server-only dependencies must not leak into client or UI exports.

## Plugin catalog

The CLI presents plugins from a trusted catalog. The initial catalog contains only first-party K-Nex packages.

Catalog entry:

```json
{
  "id": "module.crm",
  "kind": "module",
  "package": "@k-nex/module-crm",
  "displayName": "CRM",
  "description": "Contacts, companies, opportunities, activities, and CRM services.",
  "tags": ["sales", "customer-management"],
  "recommendedVersion": "1.4.2",
  "compatibleCore": ">=1.4.0 <2.0.0",
  "documentation": "docs/plugins/module-crm.md",
  "trust": "first-party",
  "status": "stable"
}
```

Catalog metadata can also include:

- screenshots and preview data;
- license and commercial restrictions;
- required infrastructure;
- supported databases;
- migration risk;
- deprecation/replacement information;
- preset membership;
- estimated operational complexity.

The catalog recommends packages; the package's signed/released manifest remains authoritative for exact composition metadata.

## Resolution algorithm

The CLI and core use the same resolver implementation.

```text
1. Read and validate k-nex.app.json.
2. Expand selected presets into explicit plugin requests.
3. Read static manifests for requested packages.
4. Normalize plugin IDs and versions.
5. Validate core, Payload, Node, and database compatibility.
6. Add explicitly accepted transitive requirements.
7. Resolve required capabilities to selected providers.
8. Detect missing requirements, duplicate single providers, and conflicts.
9. Discover optional integrations.
10. Detect cycles.
11. Compute deterministic phase and registration order.
12. Validate environment and infrastructure requirements.
13. Validate UI IDs, routes, Payload slugs, permissions, jobs, and events.
14. Produce an immutable resolved application graph.
15. Generate registries, diagnostics, and release inventory.
```

The resolver must not silently add or replace production dependencies. Interactive CLI mode can propose a plan and request confirmation. Non-interactive mode fails unless all selections are explicit or accepted through flags.

## Registration phases

After resolution, executable plugin code registers in deterministic phases:

```text
1. contracts     capabilities, services, permissions, events, UI schemas
2. providers     service implementations
3. schema        collections, globals, fields, indexes
4. behavior      commands, endpoints, access policies, subscribers
5. jobs          tasks, workflows, schedules
6. ui            navigation, screens, blocks, data sources, actions
7. admin         Payload admin integration and system settings
8. finalize      collision checks, inventory, immutable registry
```

No plugin can introduce a new undeclared dependency during registration.

## Configuration boundaries

Plugin configuration is split into two classes.

### Build-time configuration

Affects imports, schema, routes, registration, generated code, or infrastructure. Stored in `k-nex.app.json` and requires regenerate/build/deploy.

Examples:

```text
installing CRM
selecting Postgres provider
selecting Puck builder
adding a new theme package
enabling a collection-owning module
choosing Redis-backed realtime provider
```

### Runtime configuration

Changes behavior within an already installed plugin and is validated against a plugin-owned runtime schema. Stored in the database.

Examples:

```text
default CRM currency
tracking retention period
active theme palette
low-stock threshold
published workspace layout
notification preferences
```

Runtime configuration must not cause arbitrary package imports or database schema mutation.

## Trust model

A K-Nex plugin executes inside the customer application process and is therefore trusted application code. The initial platform does not attempt to sandbox unknown marketplace packages.

V1 rules:

- only first-party or explicitly reviewed private packages are cataloged;
- package installation occurs through CLI/repository changes, not from the runtime panel;
- static manifest validation occurs before executable import;
- package versions are exact and lockfile-controlled;
- CI runs provenance, license, vulnerability, contract, and integration checks;
- generated release inventory records every installed plugin and version.

A future third-party marketplace requires a separate security and signing design.

## Diagnostics

`k-nex inspect` and `k-nex doctor` should expose:

```text
Application: acme-cargo
Core: 1.4.2
Payload: 3.x

Resolved plugins:
  module.cms@2.1.0
  module.crm@1.4.2
  module.logistics-core@1.8.0
  module.logistics-driver@1.3.0
  provider.realtime-websocket-local@1.2.1
  builder.puck@0.1.0
  theme.minimal@1.0.0
  theme.neobrutalism@1.0.0

Capabilities:
  realtime.gateway@1.0.0
    provided by provider.realtime-websocket-local
    consumed by module.logistics-driver

  builder.engine@1.0.0
    provided by builder.puck
    consumed by module.cms and ui.workspace-customization
```

Errors must name the owning plugins, the expected contract, the actual version, and a concrete remediation plan.

## Boundary rules

- Core never imports a business plugin.
- A plugin never imports a customer repository.
- Optional integrations never use private module tables or paths.
- A provider implements a contract but does not redefine domain policy.
- A theme controls presentation but not authorization or business state.
- A builder serializes validated documents but does not execute arbitrary user code.
- A preset expands to explicit plugins and disappears from runtime behavior.
- Removing a package never implies automatic data deletion.
