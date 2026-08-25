# Plugin Taxonomy and Capability Resolution

## Purpose

K-Nex uses **plugin** as the umbrella term for installable, versioned K-Nex packages participating in application composition.

A plugin may add business behavior, provide replaceable infrastructure, adapt a builder engine, install a theme, connect modules, or expand a preset.

A K-Nex plugin is not necessarily a Payload plugin. It can internally contribute Payload collections, globals, endpoints, hooks, jobs, admin components, or Payload plugins while also declaring K-Nex-specific metadata.

The Payload database adapter is not a K-Nex plugin. It is selected and configured separately by the scaffold under `framework.payload.database`.

# Plugin kinds

## Module

A module provides reusable business or horizontal application behavior.

Examples:

```text
module.cms
module.sales
module.forms
module.visualization
module.logistics-core
module.logistics-dispatch
module.logistics-driver
module.live-tracking
module.restaurant-core
module.qr-menu
module.inventory
module.budgeting
```

A module can contribute:

- Payload collections, globals, fields, indexes, endpoints, hooks, jobs, access controls;
- domain/application services and commands;
- permissions and record policies;
- domain events/subscribers;
- authenticated or explicitly public APIs;
- data-source descriptors and server handlers;
- UI navigation, screens, blocks, actions, state/context definitions;
- realtime invalidation topics and stream definitions;
- migration helpers/readiness checks;
- typed client/server contracts;
- health diagnostics.

## Provider

A provider implements a genuinely replaceable infrastructure capability behind a stable K-Nex contract.

Examples:

```text
provider.realtime-websocket-local
provider.realtime-websocket-redis
provider.storage-local
provider.storage-s3
provider.email-smtp
provider.email-resend
provider.maps-mapbox
provider.queue-payload
provider.queue-redis
```

Example dependency:

```text
module.logistics-driver requires realtime.gateway@^1
```

The driver module does not import one concrete WebSocket provider.

### What is not a K-Nex provider

Payload already owns the primary database adapter abstraction. Therefore these conceptual IDs/packages are rejected:

```text
provider.database-postgres
provider.database-target-neon
@k-nex/database-postgres
database.primary
```

The scaffold installs a Payload adapter package such as `@payloadcms/db-postgres` directly.

## Builder

A builder plugin adapts a visual editing engine to canonical K-Nex block/layout/profile contracts.

Initial candidate:

```text
builder.puck
```

Domain modules export K-Nex block/source/action definitions, never Puck types. The builder translates resolved registries into editor configuration.

## Theme

A theme plugin contains executable presentation code and validated design-token/variant schemas.

Examples:

```text
theme.minimal
theme.neobrutalism
theme.glassmorphism
theme.corporate
```

Theme package installation is build-time. Selected palette/token values are runtime database records.

## Integration

An integration connects modules/capabilities without requiring either side to import the other's private implementation.

Examples:

```text
integration.sales-logistics
integration.inventory-budgeting
integration.sales-mailchimp
integration.erp-acme-legacy
```

Customer-specific integrations begin in the customer repository and are promoted only when reuse is proven.

## Preset

A preset is a CLI composition recipe, not a runtime layer.

Examples:

```text
preset.logistics
preset.restaurant
preset.corporate-cms-sales
```

A preset may select modules, providers, builder profiles, themes, Payload scaffold options, and local infrastructure defaults. The resolved application persists explicit choices.

# Identity

Every plugin has:

1. **Plugin ID** — stable product identity, e.g. `module.logistics.driver`.
2. **Package name** — registry location, e.g. `@k-nex/module-driver`.
3. **Package version** — installed artifact, e.g. `1.3.0`.

Persisted pages/layouts/audits/releases refer to stable IDs rather than package paths.

ID examples:

```text
module.sales
module.logistics.dispatch
provider.realtime.websocket-local
builder.puck
theme.neobrutalism
integration.sales-logistics
preset.logistics
```

# Static manifest

Dependency resolution must not execute plugin runtime code.

Package declaration:

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

Example manifest:

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
    "node": ">=22.0.0",
    "payloadDatabaseAdapters": ["postgres"]
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
      "version": "^1.0.0"
    },
    {
      "capability": "realtime.gateway",
      "version": "^1.0.0"
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
    "supportsUninstallPreservingData": false,
    "supportsPurge": true
  }
}
```

The compatibility field can declare tested Payload database adapters without introducing database capability providers.

# Capabilities

A capability is a versioned public contract supplied/consumed by plugins when implementation substitution matters.

Examples:

```text
cms.content
cms.visual-pages
sales.domain
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

Capabilities allow different implementations without changing consumers.

```ts
// local single-process
provides: [capability('realtime.gateway', '1.0.0')]

// Redis-backed multi-instance
provides: [
  capability('realtime.gateway', '1.0.0'),
  capability('realtime.distributed', '1.0.0'),
]
```

Capability versions describe public contract versions, not package versions.

## Cardinality

```ts
realtime.gateway      single
notifications.channel multiple
```

Multiple providers for a single capability require explicit selection or fail resolution.

# Dependencies

## Required

Missing/incompatible required plugin/capability stops plan, generation, CI, and boot.

## Optional

Activates a documented integration when present. Optional integrations use public contracts only.

## Conflict

Identifies incompatible plugin/capability/version combinations.

## Ordering

Semantic dependency edges determine deterministic registration order.

## Cycles

Required cycles fail. Extract a lower contract or integration plugin.

# Surfaces

```text
workspace
cms
public
driver
mobile
system
```

Surface declaration does not expose data automatically. Every screen/block/source/action still declares audience and authorization.

# Data-source contributions

A module can register deliberate authenticated projections.

Examples:

```text
sales.total-opportunities
sales.tasks
sales.opportunities-by-stage
```

A source descriptor declares:

```text
ID/version/owner
surface/audience
permission
input/output schema
output contract
selectable fields
pagination/sort/filter policy
cache classification
realtime invalidation metadata
```

The server handler uses authenticated Payload request context/domain services. Sources are registered through the static source registry and executed behind the standard K-Nex gateway.

Modules do not automatically expose all Payload collections.

# Recommended package exports

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

- `manifest`: static composition metadata;
- `server`: Payload/module/backend registration, source handlers, services;
- `contracts`: stable events, DTOs, service tokens, source contracts;
- `client`: browser/mobile-safe clients;
- `ui`: style-agnostic blocks/screens/headless logic/descriptors;
- `migrations`: reusable helpers/readiness;
- `testing`: fixtures/contract suites.

Server dependencies must not leak into browser exports.

# Plugin catalog

V1 catalog contains first-party or explicitly reviewed private packages.

Entry:

```json
{
  "id": "module.sales",
  "kind": "module",
  "package": "@k-nex/module-sales",
  "displayName": "Sales",
  "description": "Contacts, companies, opportunities, tasks, activities, and sales data sources.",
  "tags": ["sales", "customer-management"],
  "recommendedVersion": "1.4.2",
  "compatibleCore": ">=1.4.0 <2.0.0",
  "compatiblePayload": ">=3.0.0 <4.0.0",
  "supportedPayloadDatabases": ["postgres"],
  "trust": "first-party",
  "status": "stable"
}
```

Catalog metadata may include screenshots, license, infrastructure, migration risk, deprecation, preset membership, source/block inventory, and operational complexity.

# Resolution algorithm

```text
1. Validate k-nex.app.json.
2. Validate selected Payload framework adapter/scaffold options.
3. Expand presets into explicit plugin requests.
4. Read static manifests without executing server code.
5. Validate core/Payload/Node/selected-adapter compatibility.
6. Normalize IDs/versions.
7. Add explicitly accepted transitive requirements.
8. Resolve required capabilities to providers.
9. Detect missing requirements, conflicts, duplicate single providers, cycles.
10. Discover optional integrations.
11. Compute deterministic registration order.
12. Validate environment/infrastructure requirements.
13. Validate Payload slugs/routes and K-Nex permissions/events/jobs/blocks/sources/actions/state IDs.
14. Produce immutable resolved application graph.
15. Generate registries, Payload composition, diagnostics, and release inventory.
```

The resolver never silently installs production dependencies. Interactive mode proposes; non-interactive mode requires explicit selections/flags.

# Registration phases

```text
1. contracts     services, permissions, events, schemas, source contracts
2. providers     realtime/storage/email/etc. implementations
3. schema        Payload collections, globals, fields, indexes
4. behavior      services, commands, endpoints, access/subscribers
5. jobs          tasks/workflows/schedules
6. data-sources  descriptors and authenticated handlers
7. ui            navigation, screens, blocks, actions/state/context
8. admin         Payload admin/system integration
9. finalize      collision checks and immutable inventory
```

No undeclared dependency may appear during registration.

# Configuration boundaries

## Framework/scaffold configuration

```text
Payload database adapter
local Docker Postgres vs external URL
Next.js/Payload project template
Docker/process files
```

Stored in manifest, generated into source, requires build/deploy.

## Plugin build-time configuration

```text
installing Sales
selecting Puck
adding theme package
selecting Redis realtime provider
enabling schema-owning module
```

## Runtime configuration

```text
default currency
tracking retention
active theme tokens
low-stock threshold
published layout
notification preference
```

Runtime values cannot import packages or mutate Payload schema.

# Trust model

Plugins execute as trusted application code. V1 does not sandbox unknown marketplace packages.

Rules:

- first-party/reviewed packages only;
- install through CLI/repository changes;
- static manifest validation before executable import;
- exact versions and lockfile;
- provenance/license/vulnerability/contract/integration checks;
- release inventory of every installed plugin/source/version.

# Diagnostics

`k-nex inspect` / `doctor` show:

```text
Application: acme-cargo
Core: 1.4.2
Payload: 3.x
Payload database adapter: postgres

Plugins:
  module.cms@2.1.0
  module.sales@1.4.2
  module.logistics-driver@1.3.0
  provider.realtime-websocket-local@1.2.1
  builder.puck@0.1.0
  theme.minimal@1.0.0

Data sources:
  sales.total-opportunities@1 → metric.money@1
  sales.tasks@1 → table.records@1

Capabilities:
  realtime.gateway@1
    provider: provider.realtime-websocket-local
    consumer: module.logistics-driver
```

Errors identify owners, expected/actual contracts, stored references, and remediation.

# Boundary rules

- Core never imports business plugins.
- Plugins never import customer repositories.
- Optional integrations use public contracts.
- Providers do not redefine domain policy.
- Themes do not control authorization/business state.
- Builders serialize validated documents, not arbitrary code.
- Data sources expose deliberate projections, not raw collection/database access.
- Payload database selection is scaffold/framework configuration, not plugin resolution.
- Presets expand to explicit choices.
- Package removal never implies automatic data deletion.
