# System Architecture

## High-level model

K-Nex separates reusable platform capabilities from customer-specific product delivery.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Trusted K-Nex package ecosystem                                  │
│                                                                  │
│  core/contracts/testing                                          │
│  modules        CMS, CRM, logistics, restaurant, inventory       │
│  providers      Postgres, realtime, storage, email               │
│  builders       Puck adapter                                     │
│  themes         Minimal, Neobrutalism, Glassmorphism             │
│  integrations   CRM-logistics, inventory-budgeting, external API │
│  presets        logistics, restaurant, corporate                 │
└──────────────────────────────┬───────────────────────────────────┘
                               │ trusted catalog + static manifests
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ create-k-nex-app / k-nex CLI                                     │
│                                                                  │
│  validate application manifest                                   │
│  resolve dependencies and capabilities                           │
│  select providers                                                 │
│  install exact package versions                                  │
│  generate static registries                                      │
│  prepare Docker/environment/infrastructure files                  │
│  report schema, data, UI, theme, and security impact              │
└──────────────────────────────┬───────────────────────────────────┘
                               │ generated/reviewed repository
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Customer application repository                                  │
│                                                                  │
│  k-nex.app.json + k-nex.config.ts                                │
│  Payload/backend composition                                     │
│  fixed application shell                                         │
│  module UI contributions                                         │
│  CMS/workspace builder profiles                                  │
│  installed theme packages + customer profiles                    │
│  customer extensions and overrides                               │
│  final migrations, tests, Docker, deployment                     │
└──────────────────────────────┬───────────────────────────────────┘
                               │ build immutable release
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Independent customer environment                                 │
│                                                                  │
│  application / worker / optional realtime processes              │
│  customer Postgres                                               │
│  customer storage                                                │
│  optional Redis/specialized providers                            │
│  customer secrets, domain, backups, monitoring                   │
│  runtime CMS/layout/theme/plugin configuration                   │
└──────────────────────────────────────────────────────────────────┘
```

## Architectural goals

- Reuse tested backend and UI capability without copying platform source.
- Preserve complete customer-level design and deployment independence.
- Fail invalid compositions before framework boot or production migration.
- Keep provider/engine implementations replaceable behind versioned contracts.
- Make application composition inspectable in source control and release inventory.
- Allow runtime content/layout/theme configuration without runtime executable package installation.
- Keep security authorization server-owned across UI, APIs, jobs, and realtime.

## Layers

### 1. Contracts layer

Stable, low-dependency TypeScript and serializable contracts:

```text
plugin manifests and plugin kinds
capability definitions and service tokens
dependency/compatibility declarations
permission definitions and actor context
event/job/action/data-source envelopes
UI blocks/screens/navigation/layout documents
theme token/primitive contracts
framework contribution metadata
errors and diagnostics
```

This layer should not import Payload, Puck, customer code, or concrete provider implementations except in explicit adapter packages.

Suggested packages:

```text
@k-nex/contracts
@k-nex/ui-contracts
@k-nex/ui-design-system-contracts
```

### 2. Platform core

The core implements domain-neutral cross-cutting behavior:

- application/plugin graph validation;
- capability and typed service registry;
- deterministic registration phases;
- authentication/actor integration;
- permission registry and access helpers;
- event/job/audit/health/observability foundations;
- framework contribution composition;
- immutable release/plugin inventory;
- contract-test utilities.

Core does not know what a shipment, contact, menu item, dashboard design, or customer theme is.

### 3. Plugin packages

All installable capabilities share one lifecycle/manifest model.

#### Modules

Business/horizontal behavior and optional UI contributions.

#### Providers

Concrete infrastructure implementations behind capabilities.

#### Builders

Visual editor adapters behind `builder.engine`.

#### Themes

Executable design-system packages with runtime profile schemas.

#### Integrations

Bridges between modules/providers or external services.

#### Presets

CLI recipes expanded into explicit selected plugins.

See [Plugin taxonomy and capabilities](./13-plugin-taxonomy-and-capabilities.md).

### 4. CLI/compiler layer

`create-k-nex-app` and `k-nex` transform desired composition into a valid customer repository.

Inputs:

```text
trusted catalog
k-nex.app.json
static plugin manifests
package registry and lockfile
k-nex.config.ts
CLI flags/answers
```

Outputs:

```text
package and lockfile changes
static plugin/provider/UI/theme registries
final Payload contribution imports
environment schema and .env.example
Docker/Docker Compose files
build/release inventory
migration and orphan diagnostics
```

The CLI and core share resolver contracts so CI/startup validation cannot disagree with project generation.

### 5. Customer application composition

The customer repository is the final product composition root.

It owns:

- exact plugin versions and enabled state;
- provider/builder/theme package selection;
- customer roles and policies;
- customer extensions, integrations, blocks, and UI overrides;
- public/application routes and optional driver/mobile apps;
- brand assets/fonts and theme profiles;
- final Payload configuration and migrations;
- infrastructure and release process.

It does not own copied/modified core source.

### 6. Framework adapter layer

Payload is the provisional first backend/application host.

K-Nex adapters mediate:

```text
collection/global/field/index contributions
endpoints and access policies
jobs/workflows
admin/system contributions
version/draft storage
migration/type generation integration
```

K-Nex must not rely on an unrestricted generic deep merge of arbitrary Payload config. Contribution types and registration phases should be explicit enough to detect collisions and compose functions safely.

### 7. UI composition layer

The UI system has distinct packages:

```text
ui-contracts       engine-independent definitions
ui-runtime         registry, permissions, layout resolution, data/actions
ui-shell           fixed sidebar/topbar/router/system hosts
builder-puck       provisional editor engine adapter
theme packages     semantic primitive/design implementations
```

Enabled modules contribute navigation, fixed screens, blocks, data sources, actions, realtime metadata, and extension slots.

### 8. Runtime data/configuration layer

Runtime customer database stores:

```text
business records
CMS content and versions
builder documents and layout revisions
theme profiles and revisions
plugin runtime settings
jobs/audit/events/outbox as configured
```

Runtime data can select only installed/static registry IDs. It cannot import npm packages or execute arbitrary code.

### 9. Runtime infrastructure

Default V1 topology:

```text
web application
worker
Postgres
object storage
optional realtime/Redis/specialized stores
```

Every customer environment is isolated and independently released.

## Repository topology

The architectural boundary is the package, not necessarily the Git repository.

Recommended initial implementation topology remains an open decision, with a current preference for a first-party monorepo while contracts stabilize:

```text
k-nex-platform/
├── packages/
│   ├── contracts/
│   ├── core/
│   ├── cli/
│   ├── testing/
│   ├── ui-contracts/
│   ├── ui-runtime/
│   ├── ui-shell/
│   ├── builder-puck/
│   └── theme-*/
├── modules/
│   ├── cms/
│   ├── crm/
│   ├── logistics-core/
│   └── ...
├── presets/
├── examples/
└── docs/
```

Packages may later move to dedicated repositories without changing stable plugin IDs or package contracts.

Customer repositories always remain separate:

```text
client-acme-cargo
client-mamma-restaurant
```

## Dependency direction

Primary direction:

```text
customer application
        ↓
presets / integrations / modules / providers / themes / builder
        ↓
platform and UI runtime contracts
        ↓
low-dependency contracts
```

Core never imports a business module. Domain modules do not import customer applications. Theme packages do not own authorization/business logic. Builder adapters do not own domain data policy.

### Allowed collaboration

- public service/capability contract;
- domain event;
- registered UI data source/action;
- documented extension slot;
- dedicated integration plugin;
- customer extension consuming public contracts.

### Forbidden coupling

- core importing CRM/logistics;
- module reading another module's private table;
- optional module imported through private source paths;
- theme changing server authorization;
- builder data naming a package import or server function;
- customer identity checks inside shared packages;
- runtime database value choosing an executable package path.

## Composition lifecycle

A customer application build follows:

```text
1. Read/validate k-nex.app.json.
2. Load trusted catalog/static plugin manifests.
3. Expand presets into explicit requests.
4. Validate core/Payload/Node/database compatibility.
5. Resolve required dependencies and capability providers.
6. Detect conflicts, cycles, duplicate providers, and disabled dependency problems.
7. Install/verify exact packages and lockfile.
8. Import trusted plugin registration entry points.
9. Register contracts/providers/schema/behavior/jobs/UI/admin in phases.
10. Detect duplicate slugs, routes, permissions, events, jobs, actions, blocks, navigation IDs.
11. Merge explicit Payload contributions.
12. Build UI/theme/static registries and immutable inventory.
13. Compose customer TypeScript extensions/overrides.
14. Generate Payload types and customer-owned migration artifacts.
15. Run clean/upgrade/security/UI/theme tests.
16. Build and deploy one customer release.
```

The resolved graph is immutable during runtime.

## Build-time and runtime separation

### Build-time

- package install/remove/version;
- provider/builder/theme package availability;
- schema and import changes;
- generated registries;
- customer code/overrides;
- infrastructure topology.

### Runtime

- CMS content;
- published workspace layouts;
- active installed theme profile/tokens;
- validated plugin settings/features that do not alter composition;
- business data.

This boundary prevents runtime configuration from becoming an unsafe code loader.

## UI architecture

```text
resolved plugin graph
       ↓
UI contribution registry
       ↓
permission and surface filtering
       ↓
fixed shell + fixed operational screens + resolved layouts
       ↓
semantic design primitives
       ↓
selected installed theme + runtime profile
```

### Fixed shell

Stable route/auth/system boundaries. Module menus fill known regions.

### Operational screens

Module-owned, transaction-focused, extension-slot aware.

### Composable pages

CMS, dashboards, overviews, reports, role/user workspaces through builder profiles.

### Data/action boundary

Builder layouts reference registered server data sources/actions; authorization and transactions remain on the server.

## Theme architecture

```text
static generated theme registry
       ↓
selected published DB theme profile
       ↓
theme schema validation/migration
       ↓
CSS variables + semantic primitive adapter
       ↓
CMS/workspace render
```

Admin and public profiles are independent. A new theme requires deployment; adjusting an installed theme profile does not.

## Data architecture

Postgres is the supported V1 production/local default. Plugins own domain schema intent; customer applications own final migration history.

High-volume/specialized domains can use provider contracts behind modules:

```text
current position store
position history store
search index
object storage
realtime backplane
```

Payload documents remain appropriate for business/control data; specialized storage should not be forced through ordinary CRUD when workload contradicts it.

## Security architecture

Security controls apply at:

```text
package/catalog trust
CLI and source generation
plugin registration/collisions
authentication/actor context
permissions and record policy
UI data sources/actions
builder/theme validation
public projections
WebSocket subscriptions
jobs/events/files
customer deployment/infrastructure
```

UI visibility is not authorization. See [Security and trust boundaries](./20-security-and-trust-boundaries.md).

## Operational inventory without SaaS tenancy

Each release exposes non-secret inventory:

```text
application ID
commit/image digest
core/framework versions
plugin package versions and enabled state
capability providers
builder/theme packages
migration revision
```

A separate private fleet repository/tool can aggregate this for security upgrades without joining customer runtime databases.

## Primary architecture hypotheses to validate

1. Payload can host deterministic plugin contributions without deep forks.
2. Puck can implement the K-Nex canonical CMS/workspace builder model behind an adapter.
3. Semantic module UI can render across significantly different theme packages.
4. Manifest/CLI generation remains deterministic and reviewable.
5. Customer-owned migrations work across independent plugin combinations.
6. Disabled/uninstalled schema-owning plugins can preserve data safely.
7. Local and distributed realtime providers satisfy one capability contract.

These hypotheses have explicit POC acceptance/rejection criteria in [Research Plan](./12-research-plan-and-poc.md) and [Decision Register](./21-decision-register.md).
